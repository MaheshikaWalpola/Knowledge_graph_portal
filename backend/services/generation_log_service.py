"""
Generation log: one MongoDB document per AI-generated SHACL shape (collection `shacl_generations`).

Why: every shape the portal generates must be traceable to the exact model, prompt version and settings
that produced it, and must stay stored even when the user never saves it. Repairs by the verifier never
overwrite a raw row; they are a second row with stage "repaired" and repair_of = the raw generation_id.

Document fields (always all present; missing information is null):
  generation_id        uuid, unique
  round_id             uuid shared by every row of one generate call (one click on "generate"); a repaired
                       row keeps the round_id of its raw row, so a round is found with {"round_id": ...}
  user_email           who triggered the generation
  schema_id            workspace ontology used as context (null for an uploaded file)
  experiment_tag       e.g. "R1" for study runs, null for ordinary portal use
  statement_id         e.g. "S-001" for study runs
  statement_text       the plain-English rule
  rule_type, intended_error_class   study metadata, null otherwise
  model_id             model as requested (dropdown value / form field)
  model_id_returned    model id exactly as the API reported it in its response
  provider             kiste | anthropic | openai
  host                 kiste | api
  temperature          value sent to Kiste; null for the cloud providers (their API fixes it)
  seed                 always null (no API offers a seed)
  prompt_version       PROMPT_VERSION of prompts/shacl_generation.py, or "override"
  prompt_override      the caller's prompt text when one was used, else null
  run_index            1, 2, 3 ... for repeated study runs
  calls                always "single" (one call per rule)
  shape_ttl            the cleaned model output
  parse_ok             rdflib parsed the Turtle
  shacl_valid          pySHACL with the SHACL-SHACL meta-shapes accepted it (null when it did not parse)
  error                error text when the call or the parsing failed, else null
  duration_ms          wall-clock time of the model call for this shape (null for repaired rows)
  stage                raw | repaired
  repair_of            generation_id of the raw row (repaired rows only)
  targets_count        filled in later by the data run (PATCH), else null
  validation_result    filled in later by the data run (PATCH), else null
  created_at           ISO-8601 UTC
"""
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import uuid4
import re

import pyshacl
from rdflib import Graph

from services.llm_providers import split_model

STAGE_RAW = "raw"
STAGE_REPAIRED = "repaired"
PATCHABLE_FIELDS = ("targets_count", "validation_result")

FIELDS = (
    "generation_id", "round_id", "user_email", "schema_id", "experiment_tag", "statement_id", "statement_text",
    "rule_type", "intended_error_class", "model_id", "model_id_returned", "provider", "host", "temperature",
    "seed", "prompt_version", "prompt_override", "run_index", "calls", "shape_ttl", "parse_ok", "shacl_valid",
    "error", "stage", "repair_of", "targets_count", "validation_result", "duration_ms", "created_at",
)


def _col():
    # Imported here so that importing this module (e.g. in unit tests) does not open a database connection
    from services.mongo_service import shacl_generations_collection
    return shacl_generations_collection


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean(doc: Optional[Dict]) -> Optional[Dict]:
    if doc is not None:
        doc.pop("_id", None)
    return doc


def provider_host(model_id: Optional[str]) -> Dict[str, Optional[str]]:
    """provider and host for a requested model id ("anthropic/claude-opus-5-5" -> anthropic on the API host)."""
    provider, _ = split_model(model_id)
    return {"provider": provider, "host": "kiste" if provider == "kiste" else "api"}


def check_shape(shape_ttl: Optional[str]) -> Dict[str, Any]:
    """
    parse_ok: rdflib reads the Turtle. shacl_valid: pySHACL's SHACL-SHACL meta-shapes accept the shapes graph
    (null when the Turtle did not parse). error: the first problem found, else null.
    """
    if not shape_ttl or not shape_ttl.strip():
        return {"parse_ok": False, "shacl_valid": None, "error": "empty output"}
    g = Graph()
    try:
        g.parse(data=shape_ttl, format="turtle")
    except Exception as e:
        return {"parse_ok": False, "shacl_valid": None, "error": f"not valid Turtle: {str(e)[:300]}"}
    try:
        pyshacl.validate(Graph(), shacl_graph=g, meta_shacl=True)
    except Exception as e:
        msgs = list(dict.fromkeys(re.findall(r"Message: (.+)", str(e))))
        return {"parse_ok": True, "shacl_valid": False,
                "error": "not valid SHACL: " + ("; ".join(msgs[:3]) if msgs else str(e)[:300])}
    return {"parse_ok": True, "shacl_valid": True, "error": None}


def log_generation(
    *,
    user_email: str,
    statement_text: str,
    model_id: Optional[str],
    shape_ttl: str,
    model_id_returned: Optional[str] = None,
    temperature: Optional[float] = None,
    prompt_version: Optional[str] = None,
    prompt_override: Optional[str] = None,
    schema_id: Optional[str] = None,
    experiment_tag: Optional[str] = None,
    statement_id: Optional[str] = None,
    rule_type: Optional[str] = None,
    intended_error_class: Optional[str] = None,
    run_index: Optional[int] = None,
    error: Optional[str] = None,
    stage: str = STAGE_RAW,
    repair_of: Optional[str] = None,
    round_id: Optional[str] = None,
    duration_ms: Optional[int] = None,
) -> Dict[str, Any]:
    """Store one generated shape. With `error` set (the call failed) the row is kept with parse_ok false."""
    checks = {"parse_ok": False, "shacl_valid": None, "error": error} if error else check_shape(shape_ttl)
    doc = {
        "generation_id": str(uuid4()),
        "round_id": round_id,
        "user_email": user_email,
        "schema_id": schema_id,
        "experiment_tag": experiment_tag,
        "statement_id": statement_id,
        "statement_text": statement_text,
        "rule_type": rule_type,
        "intended_error_class": intended_error_class,
        "model_id": model_id,
        "model_id_returned": model_id_returned,
        **provider_host(model_id),
        "temperature": temperature,
        "seed": None,
        "prompt_version": prompt_version,
        "prompt_override": prompt_override,
        "run_index": run_index,
        "calls": "single",
        "shape_ttl": shape_ttl or "",
        **checks,
        "stage": stage,
        "repair_of": repair_of,
        "targets_count": None,
        "validation_result": None,
        "duration_ms": int(duration_ms) if duration_ms is not None else None,
        "created_at": _now(),
    }
    _col().insert_one(doc)
    return _clean(doc)


def log_repair(raw: Dict[str, Any], shape_ttl: str, repair_model_id: Optional[str]) -> Dict[str, Any]:
    """
    A verifier repair of a logged shape: a new row with stage "repaired" that keeps the raw row's study
    metadata. model_id is the model that wrote the repaired shape (the verification model), which can differ
    from the model of the raw row. The raw row is never changed.
    """
    model_id = repair_model_id or raw.get("model_id")
    return log_generation(
        user_email=raw["user_email"],
        statement_text=raw.get("statement_text", ""),
        model_id=model_id,
        shape_ttl=shape_ttl,
        temperature=raw.get("temperature") if provider_host(model_id)["provider"] == "kiste" else None,
        prompt_version=raw.get("prompt_version"),
        schema_id=raw.get("schema_id"),
        experiment_tag=raw.get("experiment_tag"),
        statement_id=raw.get("statement_id"),
        rule_type=raw.get("rule_type"),
        intended_error_class=raw.get("intended_error_class"),
        run_index=raw.get("run_index"),
        stage=STAGE_REPAIRED,
        repair_of=raw["generation_id"],
        round_id=raw.get("round_id"),
    )


def get_generation(generation_id: str, user_email: Optional[str] = None) -> Optional[Dict[str, Any]]:
    query: Dict[str, Any] = {"generation_id": generation_id}
    if user_email:
        query["user_email"] = user_email
    return _clean(_col().find_one(query))


def find_latest_raw(user_email: str, statement_text: str) -> Optional[Dict[str, Any]]:
    """The newest raw row of this user for this exact rule text (used when a caller has no generation_id)."""
    return _clean(_col().find_one(
        {"user_email": user_email, "statement_text": statement_text, "stage": STAGE_RAW},
        sort=[("created_at", -1)],
    ))


def update_generation(generation_id: str, fields: Dict[str, Any], user_email: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """PATCH: only targets_count and validation_result can be written back. Returns the updated row, or None."""
    allowed = {k: v for k, v in fields.items() if k in PATCHABLE_FIELDS}
    if not allowed:
        raise ValueError(f"Nothing to update; allowed fields: {', '.join(PATCHABLE_FIELDS)}")
    query: Dict[str, Any] = {"generation_id": generation_id}
    if user_email:
        query["user_email"] = user_email
    allowed["updated_at"] = _now()
    res = _col().update_one(query, {"$set": allowed})
    if res.matched_count == 0:
        return None
    return get_generation(generation_id, user_email)


def list_generations(
    user_email: Optional[str] = None,
    model: Optional[str] = None,
    statement_id: Optional[str] = None,
    experiment_tag: Optional[str] = None,
    stage: Optional[str] = None,
    search: Optional[str] = None,
    round_id: Optional[str] = None,
    limit: int = 50,
    skip: int = 0,
) -> Dict[str, Any]:
    """Newest first. `model` matches the requested or the returned model id; `search` matches the rule text."""
    query: Dict[str, Any] = {}
    if user_email:
        query["user_email"] = user_email
    if round_id:
        query["round_id"] = round_id
    if model:
        query["$or"] = [{"model_id": model}, {"model_id_returned": model}]
    if statement_id:
        query["statement_id"] = statement_id
    if experiment_tag:
        query["experiment_tag"] = experiment_tag
    if stage:
        query["stage"] = stage
    if search:
        query["statement_text"] = {"$regex": re.escape(search), "$options": "i"}
    col = _col()
    total = col.count_documents(query)
    rows = [_clean(d) for d in col.find(query).sort("created_at", -1).skip(skip).limit(limit)]
    return {"entries": rows, "total": total, "skip": skip, "limit": limit, "has_more": skip + len(rows) < total}


ROUND_SUMMARY_FIELDS = ("round_id", "user_email", "schema_id", "experiment_tag", "run_index", "model_id",
                        "prompt_version", "stage", "parse_ok", "shacl_valid", "error", "generation_id", "created_at")


def list_rounds(user_email: Optional[str] = None, limit: int = 50, skip: int = 0) -> Dict[str, Any]:
    """
    One summary per generate call (rows sharing a round_id), newest first: when it ran, which schema and model,
    how many shapes it produced, how many parsed / were valid SHACL / failed, how many were repaired, the
    generation_ids of its raw rows, and timings_ms per step from the timing log (services.run_log_service).
    Rows written before round ids existed (round_id null) are left out.
    """
    query: Dict[str, Any] = {"round_id": {"$ne": None}}
    if user_email:
        query["user_email"] = user_email
    rounds: Dict[str, Dict[str, Any]] = {}
    projection = {f: 1 for f in ROUND_SUMMARY_FIELDS}
    for d in _col().find(query, projection).sort("created_at", 1):
        r = rounds.get(d["round_id"])
        if r is None:
            r = rounds[d["round_id"]] = {
                "round_id": d["round_id"], "created_at": d.get("created_at"), "user_email": d.get("user_email"),
                "schema_id": d.get("schema_id"), "experiment_tag": d.get("experiment_tag"), "run_index": d.get("run_index"),
                "model_id": d.get("model_id"), "prompt_version": d.get("prompt_version"),
                "shapes": 0, "parsed": 0, "valid": 0, "failed": 0, "repaired": 0, "generation_ids": [],
            }
        if d.get("stage") == STAGE_REPAIRED:
            r["repaired"] += 1
            continue
        r["shapes"] += 1
        r["parsed"] += 1 if d.get("parse_ok") else 0
        r["valid"] += 1 if d.get("shacl_valid") else 0
        r["failed"] += 1 if d.get("error") and not d.get("parse_ok") else 0
        r["generation_ids"].append(d.get("generation_id"))
    ordered = sorted(rounds.values(), key=lambda r: r["created_at"] or "", reverse=True)
    page = ordered[skip:skip + limit]
    try:
        from services import run_log_service as runlog
        timings = runlog.timings_by_round([r["round_id"] for r in page])
    except Exception as e:
        print(f"Timing log read failed: {e}")
        timings = {}
    for r in page:
        r["timings_ms"] = timings.get(r["round_id"], {})
    return {"entries": page, "total": len(ordered), "skip": skip, "limit": limit, "has_more": skip + len(page) < len(ordered)}
