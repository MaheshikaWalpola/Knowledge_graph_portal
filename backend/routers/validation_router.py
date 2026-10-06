from typing import Any, List, Optional
import json
import io

from fastapi import APIRouter, Depends, Form, Request, UploadFile, File, HTTPException
from fastapi.responses import StreamingResponse

from core.auth import get_current_user
from services.validation_service import ValidationService
from services.user_schema_service import get_user_schema
from services.graphdb_service import (
    export_graph_turtle,
    user_schema_graph,
    user_schema_instance_graph
)

router = APIRouter()
validation_service = ValidationService()

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


@router.post("/validation/suggest-rules")
async def api_suggest_rules(
    user_explanation: Optional[str] = Form(None),
    num_questions: int = Form(10),
    schema_id: Optional[str] = Form(None),
    schema_file: Optional[UploadFile] = File(None),
    instance_file: Optional[UploadFile] = File(None),
    current_user: Any = Depends(get_current_user)
):
    """
    Analyze schema and optional instance data to suggest relevant SHACL validation rules
    and verification questions based on the user's intent.
    """
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
            
    rules = validation_service.suggest_validation_rules(
        user_explanation=user_explanation,
        schema_content=schema_content,
        instance_content=instance_content,
        num_questions=num_questions
    )
    return {"status": "ok", "rules": rules}


@router.post("/validation/generate-shacl")
async def api_generate_shacl(
    rules: str = Form(...),  # Expected JSON array string of plain English rules
    schema_id: Optional[str] = Form(None),
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
            
    shacl_ttl = validation_service.generate_shacl_shapes(rules_list, schema_content)
    return {"status": "ok", "shacl_ttl": shacl_ttl}


@router.post("/validation/generate-shacl-stream")
async def api_generate_shacl_stream(
    rules: str = Form(...),
    schema_id: Optional[str] = Form(None),
    schema_file: Optional[UploadFile] = File(None),
    current_user: Any = Depends(get_current_user)
):
    """SSE endpoint that streams SHACL shape generation progress rule by rule."""
    import asyncio
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
            
    async def event_generator():
        async for event in validation_service.generate_shacl_shapes_stream(rules_list, schema_content):
            yield {"data": json.dumps(event)}
            await asyncio.sleep(0)  # Yield control to flush the event

    from sse_starlette.sse import EventSourceResponse
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
    v_meta = _parse_verification_meta(verification_metadata)

    async def event_generator():
        for event in validation_service.validate_rdf_stream(
            data_ttl=instances_ttl,
            shapes_ttl=shacl_ttl,
            schema_ttl=schema_ttl,
            verification_metadata=v_meta
        ):
            yield {"data": json.dumps(event)}
            await asyncio.sleep(0)  # Yield control to flush the event

    from sse_starlette.sse import EventSourceResponse
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
    user_email = current_user["email"]
    v_meta = _parse_verification_meta(verification_metadata)

    # Fetch graphs first (fast operation)
    try:
        schema_ttl_content = _fetch_workspace_schema_ttl(user_email, schema_id)
        instances_ttl_content = _fetch_workspace_instances_ttl(user_email, schema_id)
    except Exception as e:
        raise HTTPException(500, detail=f"Failed to retrieve workspace graphs: {e}")

    async def event_generator():
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

    from sse_starlette.sse import EventSourceResponse
    return EventSourceResponse(event_generator())


@router.post("/validation/export-pdf")
async def api_export_pdf(
    request: Request,
    current_user: Any = Depends(get_current_user)
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
        raise HTTPException(500, detail=f"PDF generation failed: {e}")

