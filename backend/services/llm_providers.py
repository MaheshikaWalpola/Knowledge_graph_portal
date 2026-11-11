"""
Cloud AI providers (Claude by Anthropic, OpenAI) offered next to the local Kiste server.

A model ID chosen in the frontend is either a bare Kiste model name ("Qwen3.6-35B-A3B-MLX-8bit") or
"<provider>/<model>" for a cloud provider ("anthropic/claude-opus-5-5", "openai/gpt-5.5").
A provider is offered only when its API key is set in backend/.env; the SDK packages are imported on first
use, so the backend starts without them.
"""
import os
import re
import logging
from typing import Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

JSON_ONLY_INSTRUCTION = (
    "Respond with a single JSON object and nothing else: no markdown, no code fences, "
    "no text before or after the JSON."
)

# Output limit for one answer (a SHACL shape or a JSON list is far below this)
MAX_OUTPUT_TOKENS = 16000


class KisteConnectionError(Exception):
    """Raised when the Kiste LLM API cannot be reached or fails to respond."""
    pass


class LLMProviderError(KisteConnectionError):
    """A cloud provider call failed (missing key, missing package, rejected request). Message is shown to the user."""
    pass


# Models offered per provider. Override with a comma-separated list in ANTHROPIC_MODELS / OPENAI_MODELS.
CLAUDE_MODELS = [
    {"id": "anthropic/claude-opus-5-5", "label": "Claude Opus 5.5",
     "description": "Anthropic's strongest model for reasoning; best for SHACL shapes and verification",
     "contextWindow": "1M", "tag": None},
    {"id": "anthropic/claude-sonnet-5-5", "label": "Claude Sonnet 5.5",
     "description": "Fast and capable at a lower price", "contextWindow": "1M", "tag": None},
    {"id": "anthropic/claude-haiku-5-5", "label": "Claude Haiku 5.5",
     "description": "Fastest and cheapest Claude; fine for simple rules", "contextWindow": "1M", "tag": "Fast"},
]

OPENAI_MODELS = [
    {"id": "openai/gpt-5.5", "label": "GPT-5.5",
     "description": "OpenAI's current flagship", "contextWindow": "400K", "tag": None},
    {"id": "openai/gpt-5.4", "label": "GPT-5.4",
     "description": "Previous flagship, slightly cheaper", "contextWindow": "400K", "tag": None},
]

PROVIDERS = [
    {"id": "anthropic", "label": "Claude (Anthropic API)", "key_env": "ANTHROPIC_API_KEY",
     "models_env": "ANTHROPIC_MODELS", "defaults": CLAUDE_MODELS},
    {"id": "openai", "label": "OpenAI API", "key_env": "OPENAI_API_KEY",
     "models_env": "OPENAI_MODELS", "defaults": OPENAI_MODELS},
]


def split_model(model: Optional[str]) -> Tuple[str, Optional[str]]:
    """("anthropic", "claude-opus-5-5") for "anthropic/claude-opus-5-5"; ("kiste", name) for a bare Kiste name."""
    if model and "/" in model:
        provider, name = model.split("/", 1)
        return provider.strip().lower(), name.strip()
    return "kiste", model


def _provider_models(provider: Dict) -> List[Dict]:
    override = os.getenv(provider["models_env"], "").strip()
    if not override:
        return provider["defaults"]
    known = {m["id"]: m for m in provider["defaults"]}
    models = []
    for name in (n.strip() for n in override.split(",") if n.strip()):
        model_id = f"{provider['id']}/{name}"
        models.append(known.get(model_id) or {"id": model_id, "label": name, "description": "", "contextWindow": "", "tag": None})
    return models


def cloud_providers() -> List[Dict]:
    """Cloud providers whose API key is configured, with the models the user can pick."""
    result = []
    for provider in PROVIDERS:
        if os.getenv(provider["key_env"], "").strip():
            result.append({"id": provider["id"], "label": provider["label"], "models": _provider_models(provider)})
    return result


def json_text(text: str) -> str:
    """The JSON part of a model answer: code fences and any chatter around the first {...} / [...] are removed."""
    text = (text or "").strip()
    text = re.sub(r"^```[a-zA-Z]*\s*\n", "", text)
    text = re.sub(r"\n?```$", "", text).strip()
    if text[:1] in ("{", "["):
        return text
    start = min((i for i in (text.find("{"), text.find("[")) if i >= 0), default=-1)
    end = max(text.rfind("}"), text.rfind("]"))
    return text[start:end + 1] if 0 <= start < end else text


def _split_system(messages: List[Dict[str, str]]) -> Tuple[str, List[Dict[str, str]]]:
    """Claude takes the system prompt as a separate parameter; the turns must start with a user message."""
    system_parts = [m["content"] for m in messages if m.get("role") == "system"]
    turns = [{"role": m["role"], "content": m["content"]} for m in messages if m.get("role") in ("user", "assistant")]
    if not turns or turns[0]["role"] != "user":
        turns.insert(0, {"role": "user", "content": "(continue)"})
    return "\n\n".join(system_parts), turns


def call_anthropic(model: str, messages: List[Dict[str, str]], json_mode: bool = False,
                   reasoning_effort: Optional[str] = None, timeout: float = 300) -> str:
    """One Claude request through the official SDK. Thinking stays at the model's adaptive default."""
    try:
        import anthropic
    except ImportError:
        raise LLMProviderError("Claude models need the 'anthropic' package on the server: run `pip install anthropic`.")
    api_key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        raise LLMProviderError("ANTHROPIC_API_KEY is not set in backend/.env, so Claude models are unavailable.")

    system, turns = _split_system(messages)
    if json_mode:
        system = f"{system}\n\n{JSON_ONLY_INSTRUCTION}" if system else JSON_ONLY_INSTRUCTION
    kwargs = {"model": model, "max_tokens": MAX_OUTPUT_TOKENS, "messages": turns}
    if system:
        kwargs["system"] = system
    if reasoning_effort in ("low", "medium", "high"):
        kwargs["output_config"] = {"effort": reasoning_effort}

    client = anthropic.Anthropic(api_key=api_key, timeout=timeout)
    try:
        response = client.messages.create(**kwargs)
    except anthropic.AuthenticationError:
        raise LLMProviderError("The Anthropic API key was rejected. Check ANTHROPIC_API_KEY in backend/.env.")
    except anthropic.RateLimitError:
        raise LLMProviderError("The Anthropic API rate limit was reached. Please try again in a minute.")
    except anthropic.APIStatusError as e:
        raise LLMProviderError(f"The Anthropic API returned an error ({e.status_code}): {e.message}")
    except anthropic.APIConnectionError:
        raise LLMProviderError("The Anthropic API could not be reached. Check the server's internet connection.")

    if response.stop_reason == "refusal":
        category = getattr(getattr(response, "stop_details", None), "category", None)
        raise LLMProviderError("Claude declined this request" + (f" ({category})." if category else "."))
    if response.stop_reason == "max_tokens":
        logger.warning("Claude answer was cut off at %s output tokens (model=%s)", MAX_OUTPUT_TOKENS, model)
    return "".join(block.text for block in response.content if block.type == "text")


def call_openai(model: str, messages: List[Dict[str, str]], json_mode: bool = False,
                reasoning_effort: Optional[str] = None, timeout: float = 300) -> str:
    """One OpenAI chat completion. No temperature is sent: GPT-5 models accept only their default."""
    try:
        import openai
    except ImportError:
        raise LLMProviderError("OpenAI models need the 'openai' package on the server: run `pip install openai`.")
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise LLMProviderError("OPENAI_API_KEY is not set in backend/.env, so OpenAI models are unavailable.")

    kwargs = {"model": model, "messages": messages}
    if json_mode:
        kwargs["response_format"] = {"type": "json_object"}
    if reasoning_effort:
        kwargs["reasoning_effort"] = reasoning_effort

    client = openai.OpenAI(api_key=api_key, timeout=timeout)
    try:
        response = client.chat.completions.create(**kwargs)
    except openai.AuthenticationError:
        raise LLMProviderError("The OpenAI API key was rejected. Check OPENAI_API_KEY in backend/.env.")
    except openai.RateLimitError:
        raise LLMProviderError("The OpenAI API rate limit or quota was reached. Please try again later.")
    except openai.APIStatusError as e:
        raise LLMProviderError(f"The OpenAI API returned an error ({e.status_code}): {e.message}")
    except openai.APIConnectionError:
        raise LLMProviderError("The OpenAI API could not be reached. Check the server's internet connection.")
    return response.choices[0].message.content or ""
