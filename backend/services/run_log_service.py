"""
Timing log: one MongoDB document per run of a validation-page step (collection `validation_runs`).

Why: the study reports how long each step takes per model (question generation, SHACL generation,
verification, validation against the data). The router measures every run, including ones that fail or
that the browser aborts, and stores it here; the per-shape generation time is on the shape row itself
(shacl_generations.duration_ms).

Document fields (always all present; missing information is null):
  run_id        uuid, unique
  user_email    who ran the step
  step          question_generation | shacl_generation | shacl_verification | validation
  round_id      the generate call the step belongs to (shacl_generations.round_id); null for question
                generation, and for validation runs the browser did not link to a round
  model_id      model as requested (null for validation, which is pySHACL only)
  schema_id     workspace ontology, null for an uploaded file
  target        workspace | uploaded (where the schema / data came from)
  count         what the step worked on: questions asked, rules generated / verified, shapes validated
  detail        step-specific numbers, e.g. {"verified": 8, "repaired": 2} or the validation totals
  status        completed | error | aborted (client disconnected)
  error         error text when status is not completed
  started_at, finished_at   ISO-8601 UTC
  duration_ms   wall-clock time of the whole request
"""
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional
from uuid import uuid4

STEPS = ("question_generation", "shacl_generation", "shacl_verification", "validation")

FIELDS = (
    "run_id", "user_email", "step", "round_id", "model_id", "schema_id", "target", "count", "detail",
    "status", "error", "started_at", "finished_at", "duration_ms",
)


def _col():
    # Imported here so that importing this module (e.g. in unit tests) does not open a database connection
    from services.mongo_service import validation_runs_collection
    return validation_runs_collection


def _clean(doc: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if doc is None:
        return None
    return {k: v for k, v in doc.items() if k != "_id"}


def log_run(
    *,
    user_email: str,
    step: str,
    duration_ms: int,
    started_at: Optional[datetime] = None,
    status: str = "completed",
    error: Optional[str] = None,
    round_id: Optional[str] = None,
    model_id: Optional[str] = None,
    schema_id: Optional[str] = None,
    target: Optional[str] = None,
    count: Optional[int] = None,
    detail: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Store the time one step took. `started_at` defaults to now minus the duration."""
    if step not in STEPS:
        raise ValueError(f"unknown step {step!r}; expected one of {', '.join(STEPS)}")
    finished = datetime.now(timezone.utc)
    started = started_at or (finished - timedelta(milliseconds=duration_ms))
    doc = {
        "run_id": str(uuid4()),
        "user_email": user_email,
        "step": step,
        "round_id": round_id,
        "model_id": model_id,
        "schema_id": schema_id,
        "target": target,
        "count": count,
        "detail": detail,
        "status": status,
        "error": error,
        "started_at": started.isoformat(),
        "finished_at": finished.isoformat(),
        "duration_ms": int(duration_ms),
    }
    _col().insert_one(doc)
    return _clean(doc)


def list_runs(
    user_email: Optional[str] = None,
    round_id: Optional[str] = None,
    step: Optional[str] = None,
    model: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 50,
    skip: int = 0,
) -> Dict[str, Any]:
    """Newest first, with paging."""
    query: Dict[str, Any] = {}
    if user_email:
        query["user_email"] = user_email
    if round_id:
        query["round_id"] = round_id
    if step:
        query["step"] = step
    if model:
        query["model_id"] = model
    if status:
        query["status"] = status
    col = _col()
    total = col.count_documents(query)
    rows = [_clean(d) for d in col.find(query).sort("started_at", -1).skip(skip).limit(limit)]
    return {"entries": rows, "total": total, "skip": skip, "limit": limit, "has_more": skip + len(rows) < total}


def timings_by_round(round_ids: Iterable[str]) -> Dict[str, Dict[str, int]]:
    """
    {round_id: {step: total duration_ms}} over the completed runs of those rounds, e.g.
    {"...": {"shacl_generation": 631000, "shacl_verification": 1428600, "validation": 637200}}.
    A step run twice (verify again, validate again) is summed.
    """
    ids = [r for r in round_ids if r]
    if not ids:
        return {}
    out: Dict[str, Dict[str, int]] = {}
    for d in _col().find({"round_id": {"$in": ids}, "status": "completed"}):
        steps = out.setdefault(d["round_id"], {})
        steps[d["step"]] = steps.get(d["step"], 0) + int(d.get("duration_ms") or 0)
    return out
