from typing import Any, Dict, List, Optional
from contextlib import contextmanager
import json
import io
import time

from fastapi import APIRouter, Body, Depends, Form, Query, Request, UploadFile, File, HTTPException
from fastapi.responses import StreamingResponse
from sse_starlette.sse import EventSourceResponse
from starlette.concurrency import run_in_threadpool

from core.auth import get_current_user
from services.llm_providers import cloud_providers
from services.model_catalog import list_models
from services import generation_log_service as genlog
from services.validation_service import ValidationService
from services.user_schema_service import get_user_schema
from services.graphdb_service import (
    export_graph_turtle,
    user_schema_graph,
    user_schema_instance_graph
)

router = APIRouter()
validation_service = ValidationService()


@contextmanager
def _timed(label: str, start: Optional[float] = None):
    """Print how long a validation process took, including runs that fail or are aborted by the client."""
    t0 = start if start is not None else time.perf_counter()
    status = "completed"
    try:
        yield
    except BaseException:
        status = "aborted"
        raise
    finally:
        print(f"[Timing] {label} {status} in {time.perf_counter() - t0:.2f}s")

def _fetch_workspace_schema_ttl(user_email: str, schema_id: str) -> str:
    """Helper to fetch workspace schema turtle content from GraphDB."""
    meta = get_user_schema(user_email, schema_id)
    if meta and meta.get("graph_iri"):
        return export_graph_turtle(meta["graph_iri"])
    # Fallback to base schema graph for workspace
    graph_iri = user_schema_graph(user_email, schema_id)
    return export_graph_turtle(graph_iri)

def _fetch_workspace_instances_ttl(user_email: str, schema_id: str) -> str:
    """Helper to fetch workspace instances turtle content from GraphDB."""
    meta = get_user_schema(user_email, schema_id)
    if meta and meta.get("instance_graph_iri"):
        return export_graph_turtle(meta["instance_graph_iri"])
    # Fallback to base instance graph for workspace
    graph_iri = user_schema_instance_graph(user_email, schema_id)
    return export_graph_turtle(graph_iri)


@router.get("/validation/models")
async def api_models():
    """
    The AI models the dropdowns offer: backend/models.yaml merged with the live Kiste model list and the cloud providers
    whose API key is set (services.model_catalog). "providers" is the older cloud-only view, kept for compatibility.
    """
    return {"models": list_models(), "providers": cloud_providers()}


# --- Generation log: every AI-generated SHACL shape (services.generation_log_service) ---

@router.get("/validation/generations")
def api_list_generations(
    model: Optional[str] = Query(None, description="requested or returned model id"),
    statement_id: Optional[str] = Query(None),
    experiment_tag: Optional[str] = Query(None),
    stage: Optional[str] = Query(None, description="raw or repaired"),
    search: Optional[str] = Query(None, description="text contained in the rule"),
    limit: int = Query(50, ge=1, le=500),
    skip: int = Query(0, ge=0),
    current_user: Any = Depends(get_current_user),
) -> Dict:
    """The current user's generated shapes, newest first, with paging and filters."""
    return genlog.list_generations(user_email=current_user["email"], model=model, statement_id=statement_id,
                                   experiment_tag=experiment_tag, stage=stage, search=search, limit=limit, skip=skip)


@router.get("/validation/generations/{generation_id}")
def api_get_generation(generation_id: str, current_user: Any = Depends(get_current_user)) -> Dict:
    row = genlog.get_generation(generation_id, current_user["email"])
    if not row:
        raise HTTPException(404, detail="Generation not found")
    return row


@router.patch("/validation/generations/{generation_id}")
def api_patch_generation(
    generation_id: str,
    payload: Dict[str, Any] = Body(..., examples=[{"targets_count": 5, "validation_result": {"violations": 0}}]),
    current_user: Any = Depends(get_current_user),
) -> Dict:
    """Writes the data-run outcome (targets_count, validation_result) back into a generation-log row."""
    try:
        row = genlog.update_generation(generation_id, payload, current_user["email"])
    except ValueError as e:
        raise HTTPException(422, detail=str(e))
    if not row:
        raise HTTPException(404, detail="Generation not found")
    return row


@router.post("/validation/suggest-rules")
async def api_suggest_rules(
    user_explanation: Optional[str] = Form(None),
    num_questions: int = Form(10),
    model: Optional[str] = Form(None),  # Kiste model ID; server default when omitted
    schema_id: Optional[str] = Form(None),
    schema_file: Optional[UploadFile] = File(None),
    instance_file: Optional[UploadFile] = File(None),
    current_user: Any = Depends(get_current_user)
):
    """
    Analyze schema and optional instance data to suggest relevant SHACL validation rules
    and verification questions based on the user's intent.
    """
    start = time.perf_counter()
    schema_content = None
    instance_content = None
    if schema_file:
        content_bytes = await schema_file.read()
        schema_content = content_bytes.decode("utf-8")
    elif schema_id:
        try:
            schema_content = _fetch_workspace_schema_ttl(current_user["email"], schema_id)
        except Exception as e:
            print(f"Error fetching workspace schema: {e}")
    
    if instance_file:
        instance_bytes = await instance_file.read()
        instance_content = instance_bytes.decode("utf-8")
    elif schema_id:
        try:
            instance_content = _fetch_workspace_instances_ttl(current_user["email"], schema_id)
        except Exception as e:
            print(f"Error fetching workspace instances: {e}")
            
    with _timed(f"Rule suggestion ({num_questions} questions, model={model or 'default'})", start):
        # Blocking AI call: run it in a worker thread so other requests are not frozen meanwhile
        rules = await run_in_threadpool(
            validation_service.suggest_validation_rules,
            user_explanation=user_explanation,
            schema_content=schema_content,
            instance_content=instance_content,
            num_questions=num_questions,
            model=model
        )
    return {"status": "ok", "rules": rules}


@router.post("/validation/generate-shacl")
async def api_generate_shacl(
    rules: str = Form(...),  # Expected JSON array string of plain English rules
    schema_id: Optional[str] = Form(None),
    model: Optional[str] = Form(None),
    schema_file: Optional[UploadFile] = File(None),
    current_user: Any = Depends(get_current_user)
):
    """
    Convert a list of plain-English validation rules into standard SHACL shapes (Turtle format)
    using ontology context.
    """
    try:
        rules_list = json.loads(rules)
    except Exception as e:
        raise HTTPException(400, detail="Invalid JSON array format for 'rules'.")
        
    schema_content = None
    if schema_file:
        content_bytes = await schema_file.read()
        schema_content = content_bytes.decode("utf-8")
    elif schema_id:
        try:
            schema_content = _fetch_workspace_schema_ttl(current_user["email"], schema_id)
        except Exception as e:
            print(f"Error fetching workspace schema: {e}")
            
    shacl_ttl = await run_in_threadpool(validation_service.generate_shacl_shapes, rules_list, schema_content, model=model)
    return {"status": "ok", "shacl_ttl": shacl_ttl}


def _json_list(value: Optional[str], name: str, expected_len: Optional[int] = None) -> Optional[List[Any]]:
    """An optional form field holding a JSON array; with expected_len it must have exactly that many items."""
    if value is None or value == "":
        return None
    try:
        items = json.loads(value)
        assert isinstance(items, list)
    except Exception:
        raise HTTPException(400, detail=f"'{name}' must be a JSON array.")
    if expected_len is not None and len(items) != expected_len:
        raise HTTPException(400, detail=f"'{name}' must have one entry per rule ({expected_len}), got {len(items)}.")
    return items


@router.post("/validation/generate-shacl-stream")
async def api_generate_shacl_stream(
    rules: str = Form(...),
    schema_id: Optional[str] = Form(None),
    model: Optional[str] = Form(None),
    schema_file: Optional[UploadFile] = File(None),
    # Optional study metadata, stored with every generated shape in the generation log (see generation_log_service)
    statement_ids: Optional[str] = Form(None),           # JSON array, one id per rule, e.g. ["S-001", ...]
    rule_types: Optional[str] = Form(None),              # JSON array, one per rule
    intended_error_classes: Optional[str] = Form(None),  # JSON array, one per rule
    run_index: Optional[int] = Form(None),               # 1, 2, 3 ... for repeated runs
    experiment_tag: Optional[str] = Form(None),          # e.g. "R1"
    prompt_override: Optional[str] = Form(None),         # replaces the user prompt; {rule}, {schema}, {index} are filled in
    current_user: Any = Depends(get_current_user)
):
    """
    SSE endpoint that streams SHACL shape generation progress rule by rule.
    Every shape is written to the generation log; each progress event carries its generation_id and the
    completed event lists them in rule order (generation_ids).
    """
    import asyncio
    start = time.perf_counter()
    try:
        rules_list = json.loads(rules)
    except Exception as e:
        raise HTTPException(400, detail="Invalid JSON array format for 'rules'.")

    log_context: Dict[str, Any] = {
        "user_email": current_user["email"],
        "schema_id": schema_id,
        "experiment_tag": experiment_tag or None,
        "run_index": run_index,
        "prompt_override": prompt_override or None,
        "statement_ids": _json_list(statement_ids, "statement_ids", len(rules_list)),
        "rule_types": _json_list(rule_types, "rule_types", len(rules_list)),
        "intended_error_classes": _json_list(intended_error_classes, "intended_error_classes", len(rules_list)),
    }
        
    schema_content = None
    if schema_file:
        content_bytes = await schema_file.read()
        schema_content = content_bytes.decode("utf-8")
    elif schema_id:
        try:
            schema_content = _fetch_workspace_schema_ttl(current_user["email"], schema_id)
        except Exception as e:
            print(f"Error fetching workspace schema: {e}")
            
    async def event_generator():
        with _timed(f"SHACL generation ({len(rules_list)} rules, model={model or 'default'})", start):
            async for event in validation_service.generate_shacl_shapes_stream(rules_list, schema_content, model=model,
                                                                               log_context=log_context):
                yield {"data": json.dumps(event)}
                await asyncio.sleep(0)  # Yield control to flush the event

    return EventSourceResponse(event_generator())


@router.post("/validation/verify-shacl-stream")
async def api_verify_shacl_stream(
    rules: str = Form(...),       # JSON array of the plain-English rules, in generation order
    shapes_ttl: str = Form(...),  # current SHACL shapes (Turtle)
    indices: Optional[str] = Form(None),  # optional JSON array of rule indices to (re)check only
    model: Optional[str] = Form(None),
    schema_id: Optional[str] = Form(None),
    schema_file: Optional[UploadFile] = File(None),
    instance_file: Optional[UploadFile] = File(None),  # real data: known terms + example structure for tests
    generation_ids: Optional[str] = Form(None),  # JSON array, per rule: generation-log ids from the generation stream
    current_user: Any = Depends(get_current_user)
):
    """
    SSE endpoint: on-demand check/repair of already generated SHACL shapes.
    A repaired shape is logged as a new row linked to its raw row (generation_ids, or the newest raw row for the rule).
    """
    import asyncio
    start = time.perf_counter()
    try:
        rules_list = json.loads(rules)
    except Exception:
        raise HTTPException(400, detail="Invalid JSON array format for 'rules'.")
    try:
        indices_list = [int(i) for i in json.loads(indices)] if indices else None
    except Exception:
        raise HTTPException(400, detail="Invalid JSON array format for 'indices'.")
    generation_id_list = _json_list(generation_ids, "generation_ids")

    schema_content = None
    if schema_file:
        schema_content = (await schema_file.read()).decode("utf-8")
    elif schema_id:
        try:
            schema_content = _fetch_workspace_schema_ttl(current_user["email"], schema_id)
        except Exception as e:
            print(f"Error fetching workspace schema: {e}")

    instance_content = None
    if instance_file:
        instance_content = (await instance_file.read()).decode("utf-8")
    elif schema_id:
        try:
            instance_content = _fetch_workspace_instances_ttl(current_user["email"], schema_id)
        except Exception as e:
            print(f"Error fetching workspace instances: {e}")

    async def event_generator():
        checked = len(indices_list) if indices_list is not None else len(rules_list)
        with _timed(f"SHACL verification ({checked} rules, model={model or 'default'})", start):
            async for event in validation_service.verify_shacl_shapes_stream(rules_list, shapes_ttl, schema_content, indices_list, model=model,
                                                                       instance_content=instance_content,
                                                                       user_email=current_user["email"],
                                                                       generation_ids=generation_id_list):
                yield {"data": json.dumps(event)}
                await asyncio.sleep(0)

    return EventSourceResponse(event_generator())


def _parse_verification_meta(raw: Optional[str]) -> Optional[dict]:
    if not raw:
        return None
    try:
        return json.loads(raw)
    except Exception:
        return None


@router.post("/validation/run-playground")
async def api_run_playground(
    schema_ttl: str = Form(...),
    instances_ttl: str = Form(...),
    shacl_ttl: str = Form(...),
    verification_metadata: Optional[str] = Form(None),
    current_user: Any = Depends(get_current_user)
):
    """
    Execute SHACL validation against user-provided Turtle data and shapes in the playground.
    """
    v_meta = _parse_verification_meta(verification_metadata)
    report = validation_service.validate_rdf(
        data_ttl=instances_ttl,
        shapes_ttl=shacl_ttl,
        schema_ttl=schema_ttl,
        verification_metadata=v_meta
    )
    return {"status": "ok", "report": report}


@router.post("/validation/run-playground-stream")
async def api_run_playground_stream(
    schema_ttl: str = Form(...),
    instances_ttl: str = Form(...),
    shacl_ttl: str = Form(...),
    verification_metadata: Optional[str] = Form(None),
    current_user: Any = Depends(get_current_user)
):
    """SSE endpoint that streams step-by-step SHACL validation progress for the playground."""
    import asyncio
    start = time.perf_counter()
    v_meta = _parse_verification_meta(verification_metadata)

    async def event_generator():
        with _timed("Playground validation", start):
            for event in validation_service.validate_rdf_stream(
                data_ttl=instances_ttl,
                shapes_ttl=shacl_ttl,
                schema_ttl=schema_ttl,
                verification_metadata=v_meta
            ):
                yield {"data": json.dumps(event)}
                await asyncio.sleep(0)  # Yield control to flush the event

    return EventSourceResponse(event_generator())


@router.post("/validation/run-workspace")
async def api_run_workspace(
    schema_id: str = Form(...),
    shacl_ttl: str = Form(...),
    verification_metadata: Optional[str] = Form(None),
    current_user: Any = Depends(get_current_user)
):
    """
    Retrieve schema and instance graphs for a workspace ontology from GraphDB and run SHACL validation.
    """
    user_email = current_user["email"]
    v_meta = _parse_verification_meta(verification_metadata)
    
    # 1. Fetch schema and instances turtle from GraphDB
    try:
        schema_ttl = _fetch_workspace_schema_ttl(user_email, schema_id)
        instances_ttl = _fetch_workspace_instances_ttl(user_email, schema_id)
    except Exception as e:
        raise HTTPException(500, detail=f"Failed to retrieve workspace graphs: {e}")
        
    # 2. Execute validation
    report = validation_service.validate_rdf(
        data_ttl=instances_ttl,
        shapes_ttl=shacl_ttl,
        schema_ttl=schema_ttl,
        verification_metadata=v_meta
    )
    
    return {"status": "ok", "report": report}


@router.post("/validation/run-workspace-stream")
async def api_run_workspace_stream(
    schema_id: str = Form(...),
    shacl_ttl: str = Form(...),
    verification_metadata: Optional[str] = Form(None),
    current_user: Any = Depends(get_current_user)
):
    """SSE endpoint that streams workspace graph retrieval and SHACL validation progress."""
    import asyncio
    start = time.perf_counter()
    user_email = current_user["email"]
    v_meta = _parse_verification_meta(verification_metadata)

    # Fetch graphs first (fast operation)
    try:
        schema_ttl_content = _fetch_workspace_schema_ttl(user_email, schema_id)
        instances_ttl_content = _fetch_workspace_instances_ttl(user_email, schema_id)
    except Exception as e:
        raise HTTPException(500, detail=f"Failed to retrieve workspace graphs: {e}")

    async def event_generator():
        with _timed(f"Workspace validation ({schema_id})", start):
            yield {"data": json.dumps({"step": "fetched_graphs", "message": "Workspace graphs retrieved from GraphDB"})}
            await asyncio.sleep(0)
            for event in validation_service.validate_rdf_stream(
                data_ttl=instances_ttl_content,
                shapes_ttl=shacl_ttl,
                schema_ttl=schema_ttl_content,
                verification_metadata=v_meta
            ):
                yield {"data": json.dumps(event)}
                await asyncio.sleep(0)

    return EventSourceResponse(event_generator())


@router.post("/validation/export-pdf")
async def api_export_pdf(
    request: Request
):
    """
    Generate and download a formatted PDF validation report summarizing conformance results and violations.
    """
    try:
        body = await request.json()
        # Accept either { report_data: {...} } or the report object directly
        data = body.get("report_data", body) if isinstance(body, dict) else body
        if isinstance(data, str):
            data = json.loads(data)
        pdf_bytes = validation_service.generate_pdf_report(data)
        return StreamingResponse(
            io.BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={"Content-Disposition": "attachment; filename=validation_report.pdf"}
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(500, detail=f"PDF generation failed: {e}")

