from typing import Dict, Any, List, Optional

from fastapi import APIRouter, Query, Body, Depends, Response, UploadFile, File, Form, Path

from controllers.controller import (
    # base ontology (read-only)
    ctrl_full_schema_graph,
    ctrl_neighbors_schema,
    ctrl_neighbors_both,
    ctrl_neighbors_schema_and_instances,
    ctrl_instance_details,

    # multi-schema workspace (per-user-per-schema)
    ctrl_init_workspace,
    ctrl_workspace_neighbors,
    ctrl_workspace_add_relation,
    ctrl_workspace_delete_relation,
    ctrl_workspace_update_relation,
    ctrl_export_workspace,
    ctrl_workspace_upload_instances,

    # custom uploaded schemas
    ctrl_list_user_schemas,
    ctrl_delete_user_schema,
    ctrl_delete_schema,
    ctrl_upload_schema,
    ctrl_workspace_full_schema_graph,
)

from core.auth import get_current_user

router = APIRouter()

# -------------------------- BASE ONTOLOGY ------------------------------

@router.get("/schema/graph")
def api_full_schema_graph(
    limit: int = Query(20000, ge=1, le=100000),
) -> Dict:
    """Full base schema graph (schema-only, no instances)."""
    return ctrl_full_schema_graph(limit)


@router.get("/schema/neighbors")
def api_neighbors_schema(
    q: str = Query(..., description="term (e.g., 'Velocity') or full cmpo IRI"),
    limit: int = Query(5000, ge=1, le=50000),
) -> Dict:
    """Neighbors around a node (schema-only) from the base ontology."""
    return ctrl_neighbors_schema(q, limit)


@router.get("/schema/instances/neighbors")
def api_neighbors_schema_and_instances(
    q: str = Query(...),
    limit: int = Query(5000, ge=1, le=50000),
):
    """
    Base ontology: schema + instances
    """
    return ctrl_neighbors_schema_and_instances(q, limit)


@router.get("/instance/details")
def api_instance_details(
    iri: str = Query(..., description="Full instance IRI"),
):
    return ctrl_instance_details(iri)


# ---------------------------- WORKSPACE --------------------------------
# ---------------------- USER-SPECIFIC MULTI-SCHEMA ----------------------

@router.post("/workspace/init")
def api_workspace_init(
    schema_id: str = Query(..., description="Which workspace schema to initialize (e.g., 'main', 'schema1')"),
    current_user: Any = Depends(get_current_user),
) -> Dict:
    """
    Initialize a specific workspace schema for the current user by COPYING
    the base schema into a per-user-per-schema named graph (if not already done).
    """
    return ctrl_init_workspace(current_user["email"], schema_id)


@router.get("/workspace/neighbors")
def api_workspace_neighbors(
    schema_id: str = Query(..., description="Which workspace schema to query (e.g., 'main', 'schema1')"),
    q: str = Query(..., description="schema term/IRI, or workspace group node IRI"),
    limit: int = Query(5000, ge=1, le=50000),
    level: str = Query("schema", description="schema | both"),
    current_user: Any = Depends(get_current_user),
) -> Dict:
    return ctrl_workspace_neighbors(
        current_user["email"],
        schema_id,
        q,
        limit,
        level,
    )


@router.get("/workspace/schema/graph")
def api_workspace_full_schema_graph(
    schema_id: str = Query(..., description="Which workspace schema to fetch"),
    limit: int = Query(20000, ge=1, le=100000),
    current_user: Any = Depends(get_current_user),
) -> Dict:
    """Fetch the FULL isolated schema graph (T-Box) for the selected uploaded schema."""
    return ctrl_workspace_full_schema_graph(
        current_user["email"],
        schema_id,
        limit,
    )


@router.delete("/workspace/schema/{schema_id}")
def api_workspace_delete_schema(
    schema_id: str = Path(..., description="The schema to delete"),
    current_user: Any = Depends(get_current_user),
) -> Dict:
    """Delete a user schema completely from the workspace and graph database."""
    return ctrl_delete_schema(current_user["email"], schema_id)
@router.post("/workspace/triple/add")
def api_workspace_add_relation(
    schema_id: str = Query(..., description="Which workspace schema to write to"),
    payload: Dict = Body(
        ...,
        example={
            "subject": "https://tucid/cpmo/Velocity",
            "predicate": "http://www.w3.org/2000/01/rdf-schema#subClassOf",
            "object": "https://tucid/cpmo/ProcessVariable",
        },
    ),
    current_user: Any = Depends(get_current_user),
) -> Dict:
    """Add a schema triple to the current user's selected workspace schema."""
    return ctrl_workspace_add_relation(current_user["email"], schema_id, payload)


@router.post("/workspace/triple/delete")
def api_workspace_delete_relation(
    schema_id: str = Query(..., description="Which workspace schema to write to"),
    payload: Dict = Body(
        ...,
        example={
            "subject": "https://tucid/cpmo/Velocity",
            "predicate": "http://www.w3.org/2000/01/rdf-schema#subClassOf",
            "object": "https://tucid/cpmo/ProcessVariable",
        },
    ),
    current_user: Any = Depends(get_current_user),
) -> Dict:
    """
    Delete schema triple(s) from the current user's selected workspace schema.
    If 'object' is omitted, all objects for that subject/predicate are deleted.
    """
    return ctrl_workspace_delete_relation(current_user["email"], schema_id, payload)


@router.post("/workspace/triple/update")
def api_workspace_update_relation(
    schema_id: str = Query(..., description="Which workspace schema to write to"),
    payload: Dict = Body(
        ...,
        example={
            "subject": "https://tucid/cpmo/Velocity",
            "predicate": "http://www.w3.org/2000/01/rdf-schema#subClassOf",
            "old_object": "https://tucid/cpmo/ProcessVariable",
            "new_object": "https://tucid/cpmo/PhysicalQuantity",
        },
    ),
    current_user: Any = Depends(get_current_user),
) -> Dict:
    """Update a schema triple in the current user's selected workspace schema."""
    return ctrl_workspace_update_relation(current_user["email"], schema_id, payload)


@router.get("/workspace/export")
def api_workspace_export(
    schema_id: str = Query(..., description="Which workspace schema to export"),
    current_user: Any = Depends(get_current_user),
):
    """Download the current user's selected workspace schema as Turtle (.ttl)."""
    ttl = ctrl_export_workspace(current_user["email"], schema_id)
    filename = f"workspace_schema_{schema_id}.ttl"
    return Response(
        content=ttl,
        media_type="text/turtle",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/workspace/instances/upload")
def api_workspace_instances_upload(
    schema_id: str = Query(..., description="main | schema1 | schema2"),
    files: List[UploadFile] = File(...),
    current_user: Any = Depends(get_current_user),
) -> Dict:
    """
    Upload multiple CSV files, generate instance TTL, import into GraphDB
    under the current user's instance graph for the selected schema_id.
    Returns TTL in the response so the frontend can download it.
    """
    return ctrl_workspace_upload_instances(current_user["email"], schema_id, files)
@router.get("/workspace/schemas")
def api_list_user_schemas(current_user: Any = Depends(get_current_user)) -> Dict:
    """List all schemas available for the current user."""
    return ctrl_list_user_schemas(current_user["email"])


@router.delete("/workspace/schema")
def api_delete_user_schema(
    schema_id: str = Query(..., description="Schema ID to delete"),
    current_user: Any = Depends(get_current_user),
) -> Dict:
    """Delete a user schema and drop its GraphDB data."""
    return ctrl_delete_user_schema(current_user["email"], schema_id)


@router.post("/workspace/schema/upload")
def api_upload_schema(
    name: str = Form(..., description="Display name for the schema"),
    mode: str = Form(..., description="'combined' or 'separate'"),
    schema_file: UploadFile = File(...),
    instances_file: Optional[UploadFile] = File(None),
    current_user: Any = Depends(get_current_user),
) -> Dict:
    """
    Upload a custom RDF ontology.
    """
    return ctrl_upload_schema(
        user_email=current_user["email"],
        name=name,
        mode=mode,
        schema_file=schema_file,
        instances_file=instances_file
    )
