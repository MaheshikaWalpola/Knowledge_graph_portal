from typing import Any, List, Optional
import json
import io

from fastapi import APIRouter, Depends, Form, UploadFile, File, HTTPException
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
    schema_id: Optional[str] = Form(None),
    schema_file: Optional[UploadFile] = File(None),
    current_user: Any = Depends(get_current_user)
):
    schema_content = None
    if schema_file:
        content_bytes = await schema_file.read()
        schema_content = content_bytes.decode("utf-8")
    elif schema_id:
        try:
            schema_content = _fetch_workspace_schema_ttl(current_user["email"], schema_id)
        except Exception as e:
            print(f"Error fetching workspace schema: {e}")
            
    rules = validation_service.suggest_validation_rules(user_explanation, schema_content)
    return {"status": "ok", "rules": rules}


@router.post("/validation/generate-shacl")
async def api_generate_shacl(
    rules: str = Form(...),  # Expected JSON array string of plain English rules
    schema_id: Optional[str] = Form(None),
    schema_file: Optional[UploadFile] = File(None),
    current_user: Any = Depends(get_current_user)
):
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


@router.post("/validation/run-playground")
async def api_run_playground(
    schema_ttl: str = Form(...),
    instances_ttl: str = Form(...),
    shacl_ttl: str = Form(...),
    current_user: Any = Depends(get_current_user)
):
    report = validation_service.validate_rdf(
        data_ttl=instances_ttl,
        shapes_ttl=shacl_ttl,
        schema_ttl=schema_ttl
    )
    return {"status": "ok", "report": report}


@router.post("/validation/run-workspace")
async def api_run_workspace(
    schema_id: str = Form(...),
    shacl_ttl: str = Form(...),
    current_user: Any = Depends(get_current_user)
):
    user_email = current_user["email"]
    
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
        schema_ttl=schema_ttl
    )
    
    return {"status": "ok", "report": report}


@router.post("/validation/export-pdf")
def api_export_pdf(
    report_data: str = Form(...),
    current_user: Any = Depends(get_current_user)
):
    try:
        data = json.loads(report_data)
        pdf_bytes = validation_service.generate_pdf_report(data)
        return StreamingResponse(
            io.BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={"Content-Disposition": "attachment; filename=validation_report.pdf"}
        )
    except Exception as e:
        raise HTTPException(500, detail=f"PDF generation failed: {e}")
