"""
Tests for the generation log (services.generation_log_service) and its hook in SHACL generation:
every generated shape becomes one Mongo document with every field; a failed call becomes a row with
parse_ok false; a verifier repair becomes a second row linked to the raw one; PATCH and listing work.
Mongo is replaced by an in-memory collection, and the AI by a fake, so no services are needed.
"""

import asyncio
import json
import unittest
from unittest.mock import patch

from services import generation_log_service as genlog
from services.local_llm_service import KisteConnectionError
from services.validation_service import ValidationService
from prompts.shacl_generation import PROMPT_VERSION


SCHEMA = """
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix cmpo: <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo#> .
cmpo:Pressure a owl:Class ; rdfs:label "Pressure" .
cmpo:hasNumericValue a owl:DatatypeProperty ; rdfs:domain cmpo:Pressure .
"""

VALID_SHAPE = """
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix cmpo: <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo#> .
@prefix inst: <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo/instance/> .

inst:Question_1_Shape a sh:NodeShape ;
    rdfs:label "Every pressure value must be at least 0" ;
    sh:targetClass cmpo:Pressure ;
    sh:property [ sh:path cmpo:hasNumericValue ; sh:minInclusive 0 ; sh:datatype xsd:decimal ] .
"""

# sh:minCount must be an integer: valid Turtle, invalid SHACL
INVALID_SHACL = VALID_SHAPE.replace("sh:minInclusive 0", 'sh:minCount "one"')
NOT_TURTLE = "inst:Question_1_Shape a sh:NodeShape ; sh:targetClass cmpo:Pressure"  # prefixes missing


class FakeCursor:
    def __init__(self, docs):
        self.docs = list(docs)

    def sort(self, key, direction=1):
        self.docs.sort(key=lambda d: d.get(key) or "", reverse=direction == -1)
        return self

    def skip(self, n):
        self.docs = self.docs[n:]
        return self

    def limit(self, n):
        self.docs = self.docs[:n]
        return self

    def __iter__(self):
        return iter([dict(d) for d in self.docs])


class FakeCollection:
    """The handful of pymongo calls the log service uses, on a list of dicts."""

    def __init__(self):
        self.docs = []

    @staticmethod
    def _match_value(value, cond):
        if isinstance(cond, dict):
            if "$ne" in cond:
                return value != cond["$ne"]
            if "$regex" in cond:
                import re
                return re.search(cond["$regex"], value or "", re.I if "i" in cond.get("$options", "") else 0) is not None
            raise NotImplementedError(cond)
        return value == cond

    def _matches(self, doc, query):
        for key, cond in query.items():
            if key == "$or":
                if not any(self._matches(doc, sub) for sub in cond):
                    return False
            elif not self._match_value(doc.get(key), cond):
                return False
        return True

    def insert_one(self, doc):
        self.docs.append(dict(doc))

    def find_one(self, query, sort=None, projection=None):
        hits = [d for d in self.docs if self._matches(d, query)]
        if sort:
            key, direction = sort[0]
            hits.sort(key=lambda d: d.get(key) or "", reverse=direction == -1)
        return dict(hits[0]) if hits else None

    def find(self, query, projection=None):
        return FakeCursor(d for d in self.docs if self._matches(d, query))

    def count_documents(self, query):
        return sum(1 for d in self.docs if self._matches(d, query))

    def update_one(self, query, update):
        class Res:
            matched_count = 0
        res = Res()
        for d in self.docs:
            if self._matches(d, query):
                d.update(update["$set"])
                res.matched_count = 1
                break
        return res


class FakeLLM:
    """Stands in for LocalLLMService: returns a fixed shape and a fixed 'model' field, or raises."""

    def __init__(self, reply=VALID_SHAPE, returned_model="Qwen3.6-35B-A3B-MLX-8bit-returned", error=None):
        self.reply, self.returned_model, self.error = reply, returned_model, error
        self.calls = []

    def _call_kiste_meta(self, messages, json_mode=False, temperature=0.7, model_override=None, reasoning_effort=None):
        self.calls.append({"messages": messages, "temperature": temperature, "model": model_override})
        if self.error:
            raise self.error
        return self.reply, {"model": self.returned_model, "provider": "kiste", "host": "kiste", "temperature": temperature}

    def _call_kiste(self, *args, **kwargs):
        return self._call_kiste_meta(*args, **kwargs)[0]


def run_generation(service, rules, model, log_context):
    async def collect():
        return [e async for e in service.generate_shacl_shapes_stream(rules, SCHEMA, model=model, log_context=log_context)]
    return asyncio.run(collect())


CONTEXT = {"user_email": "me@example.org", "schema_id": "CMPO_1", "experiment_tag": "R1", "run_index": 2,
           "statement_ids": ["S-001"], "rule_types": ["range"], "intended_error_classes": ["T3_negative_value"]}


class TestLogService(unittest.TestCase):

    def setUp(self):
        self.col = FakeCollection()
        self.patcher = patch.object(genlog, "_col", lambda: self.col)
        self.patcher.start()

    def tearDown(self):
        self.patcher.stop()

    def test_check_shape(self):
        self.assertEqual(genlog.check_shape(VALID_SHAPE), {"parse_ok": True, "shacl_valid": True, "error": None})
        bad = genlog.check_shape(INVALID_SHACL)
        self.assertEqual((bad["parse_ok"], bad["shacl_valid"]), (True, False))
        self.assertIn("not valid SHACL", bad["error"])
        not_ttl = genlog.check_shape(NOT_TURTLE)
        self.assertEqual((not_ttl["parse_ok"], not_ttl["shacl_valid"]), (False, None))
        self.assertEqual(genlog.check_shape("")["error"], "empty output")

    def test_log_generation_has_every_field(self):
        row = genlog.log_generation(user_email="me@example.org", statement_text="rule", model_id="anthropic/claude-opus-5-5",
                                    shape_ttl=VALID_SHAPE, model_id_returned="claude-opus-5-5-20260301",
                                    prompt_version=PROMPT_VERSION, experiment_tag="R1", statement_id="S-001",
                                    rule_type="range", intended_error_class="T3", run_index=1)
        self.assertEqual(set(genlog.FIELDS) - set(row), set(), "a documented field is missing")
        self.assertEqual((row["provider"], row["host"], row["temperature"], row["seed"]), ("anthropic", "api", None, None))
        self.assertEqual((row["stage"], row["calls"], row["parse_ok"], row["shacl_valid"]), ("raw", "single", True, True))
        self.assertIsNone(row["targets_count"])
        self.assertEqual(self.col.count_documents({}), 1)
        self.assertEqual(genlog.get_generation(row["generation_id"], "me@example.org")["model_id_returned"], "claude-opus-5-5-20260301")
        self.assertIsNone(genlog.get_generation(row["generation_id"], "someone@else.org"))

    def test_failed_call_is_logged_with_parse_ok_false(self):
        row = genlog.log_generation(user_email="me@example.org", statement_text="rule", model_id="Qwen3.6-35B-A3B-MLX-8bit",
                                    shape_ttl="", error="connection refused", temperature=0)
        self.assertEqual((row["parse_ok"], row["shacl_valid"], row["error"]), (False, None, "connection refused"))
        self.assertEqual((row["provider"], row["host"], row["temperature"]), ("kiste", "kiste", 0))

    def test_repair_is_a_second_linked_row(self):
        raw = genlog.log_generation(user_email="me@example.org", statement_text="rule", model_id="Qwen3.6-35B-A3B-MLX-8bit",
                                    shape_ttl=INVALID_SHACL, temperature=0, prompt_version="p3", statement_id="S-001",
                                    experiment_tag="R2", run_index=1)
        fixed = genlog.log_repair(raw, VALID_SHAPE, "openai/gpt-5.5")
        self.assertEqual(self.col.count_documents({}), 2)
        self.assertEqual((fixed["stage"], fixed["repair_of"]), ("repaired", raw["generation_id"]))
        self.assertEqual((fixed["statement_id"], fixed["experiment_tag"], fixed["run_index"]), ("S-001", "R2", 1))
        self.assertEqual((fixed["model_id"], fixed["provider"], fixed["temperature"]), ("openai/gpt-5.5", "openai", None))
        self.assertTrue(fixed["shacl_valid"])
        again = genlog.get_generation(raw["generation_id"])
        self.assertEqual((again["stage"], again["shape_ttl"]), ("raw", INVALID_SHACL))  # untouched

    def test_patch_only_allowed_fields(self):
        raw = genlog.log_generation(user_email="me@example.org", statement_text="rule", model_id="m", shape_ttl=VALID_SHAPE)
        row = genlog.update_generation(raw["generation_id"], {"targets_count": 5, "shape_ttl": "hacked"}, "me@example.org")
        self.assertEqual(row["targets_count"], 5)
        self.assertEqual(row["shape_ttl"], VALID_SHAPE)
        with self.assertRaises(ValueError):
            genlog.update_generation(raw["generation_id"], {"shape_ttl": "x"})
        self.assertIsNone(genlog.update_generation("missing", {"targets_count": 1}))

    def test_list_filters_and_paging(self):
        for i, model in enumerate(["a", "a", "b"]):
            genlog.log_generation(user_email="me@example.org", statement_text=f"rule {i}", model_id=model, shape_ttl=VALID_SHAPE,
                                  statement_id=f"S-00{i}", experiment_tag="R1" if i < 2 else "R2")
        genlog.log_generation(user_email="other@example.org", statement_text="rule x", model_id="a", shape_ttl=VALID_SHAPE)
        self.assertEqual(genlog.list_generations(user_email="me@example.org")["total"], 3)
        self.assertEqual(genlog.list_generations(user_email="me@example.org", model="a")["total"], 2)
        self.assertEqual(genlog.list_generations(experiment_tag="R2")["total"], 1)
        self.assertEqual(genlog.list_generations(statement_id="S-001")["entries"][0]["statement_text"], "rule 1")
        page = genlog.list_generations(user_email="me@example.org", limit=2, skip=2)
        self.assertEqual((len(page["entries"]), page["has_more"]), (1, False))
        self.assertEqual(genlog.list_generations(search="RULE 2")["total"], 1)


class TestGenerationHook(unittest.TestCase):

    def setUp(self):
        self.col = FakeCollection()
        self.patcher = patch.object(genlog, "_col", lambda: self.col)
        self.patcher.start()
        self.service = ValidationService()

    def tearDown(self):
        self.patcher.stop()

    def test_each_generated_shape_is_one_row(self):
        self.service.llm = FakeLLM()
        events = run_generation(self.service, ["Every pressure value must be at least 0"], "Qwen3.6-35B-A3B-MLX-8bit", CONTEXT)
        progress = [e for e in events if e["status"] == "progress"][0]
        completed = [e for e in events if e["status"] == "completed"][0]
        self.assertEqual(self.col.count_documents({}), 1)
        row = self.col.docs[0]
        self.assertEqual(progress["generation_id"], row["generation_id"])
        self.assertEqual(completed["generation_ids"], [row["generation_id"]])
        self.assertEqual(row["model_id"], "Qwen3.6-35B-A3B-MLX-8bit")
        self.assertEqual(row["model_id_returned"], "Qwen3.6-35B-A3B-MLX-8bit-returned")
        self.assertEqual((row["temperature"], row["prompt_version"], row["prompt_override"]), (0, PROMPT_VERSION, None))
        self.assertEqual((row["statement_id"], row["rule_type"], row["intended_error_class"], row["run_index"], row["experiment_tag"]),
                         ("S-001", "range", "T3_negative_value", 2, "R1"))
        self.assertEqual((row["parse_ok"], row["shacl_valid"], row["stage"]), (True, True, "raw"))
        self.assertEqual(self.service.llm.calls[0]["temperature"], 0)  # Step 9: temperature 0 for Kiste

    def test_rows_of_one_run_share_a_round_id(self):
        self.service.llm = FakeLLM()
        rules = ["Every pressure value must be at least 0", "Every pressure value must be below 100"]
        completed = [e for e in run_generation(self.service, rules, "Qwen3.6-35B-A3B-MLX-8bit", CONTEXT)
                     if e["status"] == "completed"][0]
        second = [e for e in run_generation(self.service, rules[:1], "Qwen3.6-35B-A3B-MLX-8bit", CONTEXT)
                  if e["status"] == "completed"][0]
        round_id = completed["round_id"]
        self.assertTrue(round_id)
        self.assertNotEqual(round_id, second["round_id"])
        rows = genlog.list_generations(user_email="me@example.org", round_id=round_id)["entries"]
        self.assertEqual(sorted(r["generation_id"] for r in rows), sorted(completed["generation_ids"]))
        self.assertTrue(all(r["round_id"] == round_id for r in rows))
        # a repair keeps the round of its raw row
        fixed = genlog.get_generation(ValidationService._log_repair("me@example.org", completed["generation_ids"], 1,
                                                                    rules[1], VALID_SHAPE, "openai/gpt-5.5"))
        self.assertEqual(fixed["round_id"], round_id)
        rounds = genlog.list_rounds(user_email="me@example.org")
        self.assertEqual(rounds["total"], 2)
        newest, older = rounds["entries"]
        self.assertEqual((newest["round_id"], newest["shapes"]), (second["round_id"], 1))
        self.assertEqual((older["round_id"], older["shapes"], older["parsed"], older["valid"], older["failed"], older["repaired"]),
                         (round_id, 2, 2, 2, 0, 1))
        self.assertEqual(older["generation_ids"], completed["generation_ids"])
        self.assertIsNone(genlog.list_rounds(user_email="someone@else.org")["entries"] or None)

    def test_failed_generation_is_logged(self):
        self.service.llm = FakeLLM(error=KisteConnectionError("wrong key"))
        events = run_generation(self.service, ["rule"], "Qwen3.6-35B-A3B-MLX-8bit", CONTEXT)
        progress = [e for e in events if e["status"] == "progress"][0]
        self.assertEqual(progress["result_status"], "error")
        row = self.col.docs[0]
        self.assertEqual((row["parse_ok"], row["shacl_valid"], row["error"], row["shape_ttl"]), (False, None, "wrong key", ""))
        self.assertEqual(progress["generation_id"], row["generation_id"])

    def test_two_models_give_two_rows_with_their_returned_ids(self):
        for model, returned in (("Qwen3.6-35B-A3B-MLX-8bit", "qwen-returned"), ("openai/gpt-5.5", "gpt-5.5-2026-04-01")):
            self.service.llm = FakeLLM(returned_model=returned)
            run_generation(self.service, ["rule"], model, {"user_email": "me@example.org"})
        self.assertEqual([d["model_id_returned"] for d in self.col.docs], ["qwen-returned", "gpt-5.5-2026-04-01"])
        self.assertEqual([d["provider"] for d in self.col.docs], ["kiste", "openai"])

    def test_prompt_override_is_used_and_recorded(self):
        self.service.llm = FakeLLM()
        ctx = {"user_email": "me@example.org", "prompt_override": "Benchmark prompt for: {rule}"}
        run_generation(self.service, ["rule A"], "Qwen3.6-35B-A3B-MLX-8bit", ctx)
        self.assertEqual(self.service.llm.calls[0]["messages"][1]["content"], "Benchmark prompt for: rule A")
        self.assertEqual((self.col.docs[0]["prompt_version"], self.col.docs[0]["prompt_override"]),
                         ("override", "Benchmark prompt for: {rule}"))

    def test_nothing_logged_without_context(self):
        self.service.llm = FakeLLM()
        events = run_generation(self.service, ["rule"], "Qwen3.6-35B-A3B-MLX-8bit", None)
        self.assertEqual(self.col.count_documents({}), 0)
        self.assertIsNone([e for e in events if e["status"] == "progress"][0]["generation_id"])

    def test_repair_during_verification_adds_linked_row(self):
        raw = genlog.log_generation(user_email="me@example.org", statement_text="rule", model_id="Qwen3.6-35B-A3B-MLX-8bit",
                                    shape_ttl=INVALID_SHACL, temperature=0, prompt_version="p3")
        fixed_id = ValidationService._log_repair("me@example.org", [raw["generation_id"]], 0, "rule", VALID_SHAPE, "openai/gpt-5.5")
        fixed = genlog.get_generation(fixed_id)
        self.assertEqual((fixed["stage"], fixed["repair_of"]), ("repaired", raw["generation_id"]))
        # without ids the newest raw row for the same rule text is used
        fixed2_id = ValidationService._log_repair("me@example.org", None, 0, "rule", VALID_SHAPE, None)
        self.assertEqual(genlog.get_generation(fixed2_id)["repair_of"], raw["generation_id"])
        self.assertIsNone(ValidationService._log_repair("me@example.org", None, 0, "unknown rule", VALID_SHAPE, None))


if __name__ == "__main__":
    unittest.main()
