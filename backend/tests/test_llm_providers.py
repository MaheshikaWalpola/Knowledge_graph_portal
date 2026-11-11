"""
Unit tests for the AI provider dispatch: Kiste model names stay on Kiste, "anthropic/..." and "openai/..." go to
the cloud SDKs with the right parameters, and failures become errors the UI can show.
The SDK packages are replaced by fakes, so no network and no API keys are needed.
"""

import sys
import types
import unittest
from unittest.mock import patch

from services import llm_providers
from services.llm_providers import (
    split_model, json_text, cloud_providers, call_anthropic, call_openai, LLMProviderError, KisteConnectionError,
)
from services.local_llm_service import LocalLLMService


MESSAGES = [
    {"role": "system", "content": "You are a SHACL generator."},
    {"role": "user", "content": "Write a shape."},
]


def fake_sdk(name: str, create):
    """A stand-in for the anthropic / openai package: exception classes plus a client whose create() is `create`."""
    module = types.ModuleType(name)
    for exc in ("AuthenticationError", "RateLimitError", "APIStatusError", "APIConnectionError"):
        setattr(module, exc, type(exc, (Exception,), {}))
    calls = []

    def recording_create(**kwargs):
        calls.append(kwargs)
        return create(**kwargs)

    if name == "anthropic":
        client = types.SimpleNamespace(messages=types.SimpleNamespace(create=recording_create))
        module.Anthropic = lambda **kw: client
    else:
        client = types.SimpleNamespace(chat=types.SimpleNamespace(completions=types.SimpleNamespace(create=recording_create)))
        module.OpenAI = lambda **kw: client
    module.calls = calls
    return module


def claude_reply(text, stop_reason="end_turn"):
    block = types.SimpleNamespace(type="text", text=text)
    return lambda **kw: types.SimpleNamespace(content=[block], stop_reason=stop_reason, stop_details=None)


def openai_reply(text):
    msg = types.SimpleNamespace(content=text)
    return lambda **kw: types.SimpleNamespace(choices=[types.SimpleNamespace(message=msg)])


class TestModelRouting(unittest.TestCase):

    def test_split_model(self):
        self.assertEqual(split_model("Qwen3.6-35B-A3B-MLX-8bit"), ("kiste", "Qwen3.6-35B-A3B-MLX-8bit"))
        self.assertEqual(split_model("anthropic/claude-opus-5-5"), ("anthropic", "claude-opus-5-5"))
        self.assertEqual(split_model("openai/gpt-5.5"), ("openai", "gpt-5.5"))
        self.assertEqual(split_model(None), ("kiste", None))

    def test_json_text_strips_fences_and_chatter(self):
        self.assertEqual(json_text('```json\n{"a": 1}\n```'), '{"a": 1}')
        self.assertEqual(json_text('Here is the result:\n{"a": 1}\nHope this helps.'), '{"a": 1}')
        self.assertEqual(json_text('[1, 2]'), '[1, 2]')
        self.assertEqual(json_text('no json here'), 'no json here')

    def test_cloud_providers_listed_only_with_key(self):
        with patch.dict("os.environ", {"ANTHROPIC_API_KEY": "", "OPENAI_API_KEY": ""}):
            self.assertEqual(cloud_providers(), [])
        with patch.dict("os.environ", {"ANTHROPIC_API_KEY": "k", "OPENAI_API_KEY": ""}):
            providers = cloud_providers()
            self.assertEqual([p["id"] for p in providers], ["anthropic"])
            self.assertIn("anthropic/claude-opus-5-5", [m["id"] for m in providers[0]["models"]])
        with patch.dict("os.environ", {"OPENAI_API_KEY": "k", "OPENAI_MODELS": "gpt-5.5, gpt-9-test"}):
            openai = next(p for p in cloud_providers() if p["id"] == "openai")
            self.assertEqual([m["id"] for m in openai["models"]], ["openai/gpt-5.5", "openai/gpt-9-test"])
            self.assertEqual(openai["models"][0]["label"], "GPT-5.5")  # known model keeps its metadata

    def test_dispatcher_routes_by_prefix(self):
        service = LocalLLMService()
        with patch.object(llm_providers, "call_anthropic", return_value='```json\n{"ok": 1}\n```') as claude, \
             patch("services.local_llm_service.call_anthropic", claude), \
             patch("services.local_llm_service.call_openai", return_value="openai text") as gpt, \
             patch.object(LocalLLMService, "_call_kiste_server", return_value="kiste text") as kiste:
            self.assertEqual(service._call_kiste(MESSAGES, json_mode=True, model_override="anthropic/claude-opus-5-5"), '{"ok": 1}')
            self.assertEqual(service._call_kiste(MESSAGES, model_override="openai/gpt-5.5"), "openai text")
            self.assertEqual(service._call_kiste(MESSAGES, model_override="Qwen3.6-35B-A3B-MLX-8bit"), "kiste text")
            self.assertEqual(service._call_kiste(MESSAGES), "kiste text")
            self.assertEqual(claude.call_args.args[0], "claude-opus-5-5")
            self.assertEqual(gpt.call_args.args[0], "gpt-5.5")
            self.assertEqual([c.args[3] for c in kiste.call_args_list], ["Qwen3.6-35B-A3B-MLX-8bit", None])
        with self.assertRaises(KisteConnectionError):
            service._call_kiste(MESSAGES, model_override="gemini/pro")


class TestAnthropic(unittest.TestCase):

    def test_request_shape(self):
        sdk = fake_sdk("anthropic", claude_reply("inst:Shape a sh:NodeShape ."))
        with patch.dict(sys.modules, {"anthropic": sdk}), patch.dict("os.environ", {"ANTHROPIC_API_KEY": "k"}):
            text = call_anthropic("claude-opus-5-5", MESSAGES, json_mode=True, reasoning_effort="low")
        self.assertEqual(text, "inst:Shape a sh:NodeShape .")
        call = sdk.calls[0]
        self.assertEqual(call["model"], "claude-opus-5-5")
        self.assertEqual(call["messages"], [{"role": "user", "content": "Write a shape."}])
        self.assertTrue(call["system"].startswith("You are a SHACL generator."))
        self.assertIn("single JSON object", call["system"])  # JSON mode is a system instruction for Claude
        self.assertEqual(call["output_config"], {"effort": "low"})
        self.assertNotIn("temperature", call)
        self.assertNotIn("thinking", call)  # adaptive thinking is the model default

    def test_missing_key_and_refusal(self):
        sdk = fake_sdk("anthropic", claude_reply("", stop_reason="refusal"))
        with patch.dict(sys.modules, {"anthropic": sdk}):
            with patch.dict("os.environ", {"ANTHROPIC_API_KEY": ""}):
                with self.assertRaises(LLMProviderError) as ctx:
                    call_anthropic("claude-opus-5-5", MESSAGES)
                self.assertIn("ANTHROPIC_API_KEY", str(ctx.exception))
            with patch.dict("os.environ", {"ANTHROPIC_API_KEY": "k"}):
                with self.assertRaises(LLMProviderError) as ctx:
                    call_anthropic("claude-opus-5-5", MESSAGES)
                self.assertIn("declined", str(ctx.exception))

    def test_sdk_errors_become_provider_errors(self):
        sdk = fake_sdk("anthropic", claude_reply("x"))

        def raise_auth(**kw):
            raise sdk.AuthenticationError("bad key")
        sdk.Anthropic = lambda **kw: types.SimpleNamespace(messages=types.SimpleNamespace(create=raise_auth))
        with patch.dict(sys.modules, {"anthropic": sdk}), patch.dict("os.environ", {"ANTHROPIC_API_KEY": "k"}):
            with self.assertRaises(LLMProviderError) as ctx:
                call_anthropic("claude-opus-5-5", MESSAGES)
            self.assertIn("rejected", str(ctx.exception))

    def test_package_missing(self):
        with patch.dict(sys.modules, {"anthropic": None}), patch.dict("os.environ", {"ANTHROPIC_API_KEY": "k"}):
            with self.assertRaises(LLMProviderError) as ctx:
                call_anthropic("claude-opus-5-5", MESSAGES)
            self.assertIn("pip install anthropic", str(ctx.exception))


class TestOpenAI(unittest.TestCase):

    def test_request_shape(self):
        sdk = fake_sdk("openai", openai_reply('{"rules": []}'))
        with patch.dict(sys.modules, {"openai": sdk}), patch.dict("os.environ", {"OPENAI_API_KEY": "k"}):
            text = call_openai("gpt-5.5", MESSAGES, json_mode=True, reasoning_effort="low")
        self.assertEqual(text, '{"rules": []}')
        call = sdk.calls[0]
        self.assertEqual(call["model"], "gpt-5.5")
        self.assertEqual(call["messages"], MESSAGES)  # system message stays in the list for OpenAI
        self.assertEqual(call["response_format"], {"type": "json_object"})
        self.assertEqual(call["reasoning_effort"], "low")
        self.assertNotIn("temperature", call)  # GPT-5 models accept only their default temperature

    def test_missing_key(self):
        sdk = fake_sdk("openai", openai_reply("x"))
        with patch.dict(sys.modules, {"openai": sdk}), patch.dict("os.environ", {"OPENAI_API_KEY": ""}):
            with self.assertRaises(LLMProviderError):
                call_openai("gpt-5.5", MESSAGES)


if __name__ == "__main__":
    unittest.main()
