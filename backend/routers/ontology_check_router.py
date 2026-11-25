"""
Live ontology check for the canvas: POST /ontology/check.

Read-only: it checks the ontology on the canvas (sent as Turtle) or the stored workspace schema,
stores the run in MongoDB, and never writes to GraphDB.
"""
import logging
import os
import re
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict

from core.auth import get_current_user
from services.ontology_check_service import (
    OntologyParseError,
    parse_ontology,
    run_check,
    store_check,
    ttl_sha256,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ontology", tags=["ontology-check"])

_DEFAULT_MAX_BYTES = 5 * 1024 * 1024


def _max_bytes() -> int:
    try:
        return int(os.getenv("ONTOLOGY_CHECK_MAX_BYTES", _DEFAULT_MAX_BYTES))
    except ValueError:
        return _DEFAULT_MAX_BYTES


class OntologyCheckRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source: Literal["canvas", "stored"] = "canvas"
    # Turtle built from the canvas; required for source "canvas", not allowed for "stored".
    ttl: Optional[str] = None
    # Workspace schema; required for source "stored", optional (for the record) for "canvas".
    schema_id: Optional[str] = None
    # "auto" runs (debounced while editing) skip the noisy unconnected-class check (PF05).
    trigger: Literal["manual", "auto"] = "manual"


def _bad_request(summary: str, technical: str = "", status: int = 400):
    return HTTPException(status, detail={"summary": summary, "technical": technical})


def _parse_error_summary(raw: str, source: str) -> str:
    line = re.search(r"line (\d+)", raw)
    where = f" (line {line.group(1)})" if line else ""
    if source == "canvas":
        return (f"The canvas content is not valid Turtle{where}, so it can't be checked. Imported OWL "
                f"constructs the canvas can't show, such as owl:hasKey lists, can cause this: "
                f"try \"Check saved schema\".")
    return f"The saved schema is not valid Turtle{where}, so it can't be checked."


def _load_stored_ttl(user_email: str, schema_id: str) -> str:
    """The stored workspace schema as Turtle (a read-only GraphDB export)."""
    from controllers.controller import ctrl_export_workspace  # heavy imports, load on use
    return ctrl_export_workspace(user_email, schema_id)


@router.post("/check")
def api_check_ontology(body: OntologyCheckRequest, current_user: Any = Depends(get_current_user)):
    """Check the ontology for logical errors (quick OWL RL) and modelling pitfalls (warnings)."""
    user_email = current_user["email"]
    schema_id = (body.schema_id or "").strip() or None

    if body.source == "canvas":
        if body.ttl is None or not body.ttl.strip():
            raise _bad_request("The canvas is empty: there is nothing to check.")
        ttl = body.ttl
    else:
        if body.ttl is not None:
            raise _bad_request("Send either the canvas Turtle (source 'canvas') or a schema_id "
                               "(source 'stored'), not both.")
        if not schema_id:
            raise _bad_request("schema_id is required to check a stored schema.")
        try:
            ttl = _load_stored_ttl(user_email, schema_id)
        except HTTPException:
            raise
        except Exception as e:
            logger.warning("Could not load schema %s for the ontology check: %s", schema_id, e)
            raise _bad_request("The stored schema could not be loaded.", str(e)[:500], status=502)
        if not ttl or not ttl.strip():
            raise _bad_request("The stored schema is empty: there is nothing to check.", status=404)

    size = len(ttl.encode("utf-8"))
    if size > _max_bytes():
        raise _bad_request(f"The ontology is too large to check ({size:,} bytes; the limit is "
                           f"{_max_bytes():,}, ONTOLOGY_CHECK_MAX_BYTES).", status=413)

    try:
        graph = parse_ontology(ttl)
    except OntologyParseError as e:
        raise _bad_request(_parse_error_summary(str(e), body.source), str(e)[:2000])

    result, raw = run_check(graph, trigger=body.trigger)
    result["source"] = body.source
    result["schema_id"] = schema_id

    try:
        result["stored"] = store_check(user_email=user_email, schema_id=schema_id, source=body.source,
                                       ttl_hash=ttl_sha256(ttl), result=result, raw=raw)
    except Exception as e:
        logger.error("Could not store ontology check %s: %s", result["check_id"], e)
        result["stored"] = False
        result["notes"].append("This check could not be saved to the database.")
    else:
        if not result["stored"]:
            result["notes"].append("The ontology is unchanged since the last stored check, "
                                   "so this run was not stored again.")
    return result
