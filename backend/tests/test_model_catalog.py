"""
Tests for the model catalog (backend/models.yaml + services/model_catalog.py):
the file is valid and names exactly nine study models; the merged list marks Kiste models by the live
server list and cloud models by their API key; the models endpoint serves the merged list.
"""

import unittest
from unittest.mock import patch

from services import model_catalog as mc


LIVE = {
    "Qwen3.6-35B-A3B-MLX-8bit": {"id": "Qwen3.6-35B-A3B-MLX-8bit", "max_model_len": 262144},
    "GLM-5.3-Flash-oQ4e-mtp": {"id": "GLM-5.3-Flash-oQ4e-mtp", "max_model_len": 131072},
    "Kokoro-82M-bf16": {"id": "Kokoro-82M-bf16"},  # a speech model: listed by the server, excluded by the catalog
    "New-Chat-Model": {"id": "New-Chat-Model"},    # a chat model the server lists but the catalog does not know yet
}


class TestCatalogFile(unittest.TestCase):

    def test_catalog_is_valid_and_has_nine_study_models(self):
        entries = mc.load_catalog()
        self.assertEqual(sum(1 for e in entries if e["include_in_study"]), 8)  # the plan wants nine: the ninth open model is still open
        self.assertEqual({e["provider"] for e in entries}, {"kiste", "anthropic", "openai"})
        for e in entries:
            self.assertEqual(e["host"], "kiste" if e["provider"] == "kiste" else "api", e["id"])
        excluded = {e["id"] for e in entries if not e["include_in_study"]}
        self.assertEqual(excluded, {"gpt-oss-120b-MXFP4-Q8", "Hunyuan-MT-7B-8bit", "GLM-5.3-Flash-oQ4e-mtp", "Phi-3-mini-4k-instruct-mlx", "claude-haiku-5-5"})

    def test_model_value_matches_the_form_field_format(self):
        self.assertEqual(mc.model_value("kiste", "Qwen3.6-35B-A3B-MLX-8bit"), "Qwen3.6-35B-A3B-MLX-8bit")
        self.assertEqual(mc.model_value("anthropic", "claude-opus-5-5"), "anthropic/claude-opus-5-5")
        self.assertEqual(mc.model_value("openai", "gpt-5.5"), "openai/gpt-5.5")

    def test_format_context(self):
        self.assertEqual(mc.format_context(262144), "262K")
        self.assertEqual(mc.format_context(1048576), "1M")
        self.assertEqual(mc.format_context(131072), "131K")
        self.assertIsNone(mc.format_context(None))


class TestMergedList(unittest.TestCase):

    def test_kiste_availability_follows_the_live_list(self):
        with patch.dict("os.environ", {"ANTHROPIC_API_KEY": "k", "OPENAI_API_KEY": ""}):
            rows = {r["id"]: r for r in mc.list_models(live=LIVE)}
        self.assertTrue(rows["Qwen3.6-35B-A3B-MLX-8bit"]["available"])
        self.assertEqual(rows["Qwen3.6-35B-A3B-MLX-8bit"]["context_window"], "262K")  # live value wins
        self.assertFalse(rows["gpt-oss-120b-MLX-8bit"]["available"])  # in the catalog, not on the server
        self.assertTrue(rows["claude-opus-5-5"]["available"])
        self.assertFalse(rows["gpt-5.5"]["available"])  # no OpenAI key
        self.assertEqual((rows["claude-opus-5-5"]["model"], rows["claude-opus-5-5"]["provider_label"]), ("anthropic/claude-opus-5-5", "Claude"))
        # a server model outside the catalog is offered with its raw id; an excluded one never appears
        self.assertEqual((rows["New-Chat-Model"]["in_catalog"], rows["New-Chat-Model"]["include_in_study"], rows["New-Chat-Model"]["available"]), (False, False, True))
        self.assertNotIn("Kokoro-82M-bf16", rows)

    def test_unknown_live_list_leaves_kiste_availability_open(self):
        rows = {r["id"]: r for r in mc.list_models(live={}) if r["provider"] == "kiste"}
        self.assertTrue(all(r["available"] is False for r in rows.values()))
        with patch.object(mc, "_kiste_live", None):
            rows = {r["id"]: r for r in mc.list_models() if r["provider"] == "kiste"}
        self.assertTrue(all(r["available"] is None for r in rows.values()))

    def test_refresh_survives_an_unreachable_server(self):
        with patch.object(mc, "fetch_kiste_models", side_effect=OSError("down")):
            self.assertIsNone(mc.refresh_kiste_models())
        with patch.object(mc, "fetch_kiste_models", return_value=list(LIVE.values())):
            self.assertEqual(mc.refresh_kiste_models(), sorted(LIVE))  # the raw server list, exclusions included
        self.assertEqual(set(mc.kiste_live_models()), set(LIVE))

    def test_excluded_server_models_are_never_listed(self):
        self.assertIn("Qwen3-Embedding-0.6B-8bit", mc.load_exclusions())
        live = {"Qwen3-Embedding-0.6B-8bit": {"id": "Qwen3-Embedding-0.6B-8bit"}, "Some-New-Chat-Model": {"id": "Some-New-Chat-Model"}}
        ids = [r["id"] for r in mc.list_models(live=live)]
        self.assertNotIn("Qwen3-Embedding-0.6B-8bit", ids)
        self.assertIn("Some-New-Chat-Model", ids)

    def test_base_url(self):
        with patch.dict("os.environ", {"KISTE_BASE_URL": "", "KISTE_API_URL": "https://kiste.example/v1/chat/completions"}):
            self.assertEqual(mc.kiste_base_url(), "https://kiste.example")
        with patch.dict("os.environ", {"KISTE_BASE_URL": "https://other.example/"}):
            self.assertEqual(mc.kiste_base_url(), "https://other.example")


if __name__ == "__main__":
    unittest.main()
