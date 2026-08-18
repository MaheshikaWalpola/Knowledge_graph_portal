from typing import Dict, Any, List, Optional

from fastapi import APIRouter, Query, Body, Depends, Response, UploadFile, File, Form, Path
from fastapi.responses import StreamingResponse

from controllers.controller import (

    ctrl_full_schema_graph,
    ctrl_neighbors_schema,
    ctrl_neighbors_both,
    ctrl_neighbors_schema_and_instances,
    ctrl_instance_details,

    # workspace (per-user-per-schema)
    ctrl_init_workspace,
    ctrl_workspace_neighbors,
    ctrl_workspace_add_relation,
    ctrl_workspace_delete_relation,
    ctrl_workspace_update_relation,
    ctrl_export_workspace,
    ctrl_workspace_upload_instances,

    # uploaded schemas
    ctrl_list_user_schemas,
    ctrl_delete_user_schema,
    ctrl_delete_schema,
    ctrl_upload_schema,
    ctrl_workspace_full_schema_graph,
)

from controllers.instance_generation_controller import (
    ctrl_analyze_schema_and_data,
    ctrl_analyze_schema_and_data_stream,
    ctrl_generate_instance,
)

from core.auth import get_current_user

router = APIRouter()

# --- Base ontology ---

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


# --- Workspace (user-specific multi-schema) ---

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
            "subject": "https://tucid/cmpo/Velocity",
            "predicate": "http://www.w3.org/2000/01/rdf-schema#subClassOf",
            "object": "https://tucid/cmpo/ProcessVariable",
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
            "subject": "https://tucid/cmpo/Velocity",
            "predicate": "http://www.w3.org/2000/01/rdf-schema#subClassOf",
            "object": "https://tucid/cmpo/ProcessVariable",
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
            "subject": "https://tucid/cmpo/Velocity",
            "predicate": "http://www.w3.org/2000/01/rdf-schema#subClassOf",
            "old_object": "https://tucid/cmpo/ProcessVariable",
            "new_object": "https://tucid/cmpo/PhysicalQuantity",
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
    update_schema_id: Optional[str] = Form(None, description="If provided, overwrites the existing schema with this ID"),
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
        instances_file=instances_file,
        update_schema_id=update_schema_id
    )


# --- Canvas (import / export) ---

from core.parse_errors import friendly_parse_error as _friendly_parse_error


@router.post("/canvas/import")
async def api_canvas_import(
    file: UploadFile = File(...),
    current_user: Any = Depends(get_current_user),
) -> Dict:
    """
    Parse an uploaded TTL/RDF file and return { nodes, edges } for React Flow canvas.
    """
    from rdflib import Graph as RDFGraph, RDF, RDFS, OWL

    content = await file.read()
    g = RDFGraph()

    # Guess format from filename
    fname = (file.filename or "").lower()
    fmt = "turtle"
    if fname.endswith(".rdf") or fname.endswith(".owl"):
        fmt = "xml"
    elif fname.endswith(".nt"):
        fmt = "nt"
    elif fname.endswith(".n3"):
        fmt = "n3"

    try:
        g.parse(data=content, format=fmt)
    except Exception as e:
        from fastapi import HTTPException
        raw = str(e)
        raise HTTPException(400, detail={
            "summary": _friendly_parse_error(raw, file.filename),
            "technical": raw,
        })

    # Detect node types from rdf:type
    node_map = {}
    edge_list = []

    TYPE_MAP = {
        str(OWL.Class): "classNode",
        str(OWL.ObjectProperty): "propertyNode",
        str(OWL.DatatypeProperty): "propertyNode",
        str(OWL.NamedIndividual): "instanceNode",
        str(RDFS.Literal): "literalNode",
    }

    COLOR_MAP = {
        "classNode": "#3b82f6",
        "propertyNode": "#f59e0b",
        "instanceNode": "#10b981",
        "literalNode": "#8b5cf6",
    }

    PRED_MAP = {
        str(RDFS.subClassOf): "subClassOf",
        str(RDFS.domain): "domain",
        str(RDFS.range): "range",
        str(RDF.type): "rdfType",
    }

    # First pass: detect types
    iri_types = {}
    for s, _, o in g.triples((None, RDF.type, None)):
        iri_types[str(s)] = str(o)

    # Collect labels
    iri_labels = {}
    for s, _, o in g.triples((None, RDFS.label, None)):
        iri_labels[str(s)] = str(o)

    # Build node set
    all_iris = set()
    for s, p, o in g:
        if hasattr(s, 'toPython'):
            all_iris.add(str(s))
        if hasattr(o, 'toPython') and not isinstance(o, type(g.namespace_manager)):
            from rdflib.term import URIRef
            if isinstance(o, URIRef):
                all_iris.add(str(o))

    # Filter out well-known namespace IRIs
    SKIP = {str(OWL.Class), str(OWL.ObjectProperty), str(OWL.DatatypeProperty),
            str(OWL.NamedIndividual), str(OWL.Ontology), str(OWL.Thing),
            str(RDFS.Literal), str(RDFS.Resource)}

    x_offset = 100
    y_offset = 100
    col = 0
    for iri in sorted(all_iris):
        if iri in SKIP:
            continue
        rdf_type = iri_types.get(iri, "")
        node_type = TYPE_MAP.get(rdf_type, "classNode")
        local_name = iri.rsplit("#", 1)[-1].rsplit("/", 1)[-1]
        label = iri_labels.get(iri, local_name)
        color = COLOR_MAP.get(node_type, "#3b82f6")

        prop_type = ""
        if rdf_type == str(OWL.DatatypeProperty):
            prop_type = "datatype"
        elif rdf_type == str(OWL.ObjectProperty):
            prop_type = "object"

        node_map[iri] = {
            "id": iri,
            "type": node_type,
            "position": {"x": x_offset + (col % 4) * 200, "y": y_offset + (col // 4) * 150},
            "data": {
                "label": label,
                "color": color,
                "iri": iri,
                "description": "",
                "propertyType": prop_type,
            },
        }
        col += 1

    # Build edges (skip rdf:type, label, comment edges)
    edge_idx = 0
    for s, p, o in g:
        s_str, p_str, o_str = str(s), str(p), str(o)
        if p_str == str(RDF.type):
            continue
        if p_str == str(RDFS.label) or p_str == str(RDFS.comment):
            continue
        if s_str not in node_map or o_str not in node_map:
            continue

        edge_type = PRED_MAP.get(p_str, "subClassOf")
        local_pred = p_str.rsplit("#", 1)[-1].rsplit("/", 1)[-1]

        EDGE_COLORS = {
            "subClassOf": "#6366f1",
            "domain": "#14b8a6",
            "range": "#f97316",
            "rdfType": "#8b5cf6",
        }

        edge_list.append({
            "id": f"e_{edge_idx}",
            "source": s_str,
            "target": o_str,
            "label": local_pred,
            "data": {"edgeType": edge_type},
            "style": {"stroke": EDGE_COLORS.get(edge_type, "#94a3b8"), "strokeWidth": 2},
            "markerEnd": {"type": "arrowclosed", "color": EDGE_COLORS.get(edge_type, "#94a3b8")},
            "labelStyle": {"fill": EDGE_COLORS.get(edge_type, "#94a3b8"), "fontWeight": 600, "fontSize": 11},
            "labelBgStyle": {"fill": "#ffffff", "fillOpacity": 0.9},
            "labelBgPadding": [6, 3],
            "labelBgBorderRadius": 4,
        })
        edge_idx += 1

    return {
        "nodes": list(node_map.values()),
        "edges": edge_list,
    }


# --- Instance generation workflow ---

@router.post("/instance-generation/analyze")
async def api_analyze_schema_and_data(
    schema_file: UploadFile = File(..., description="RDF/Turtle schema file"),
    data_files: List[UploadFile] = File(..., description="CSV data files"),
    current_user: Any = Depends(get_current_user),
):
    """
    Analyze schema file and CSV data files.
    Returns a streamed NDJSON matching analysis report with:
    - matched_headers: CSV headers matched to schema terms
    - unmatched_data_headers: CSV headers without matches
    - missing_schema_terms: Schema terms without data headers
    - available_schema_terms: All schema terms for manual mapping
    """
    return await ctrl_analyze_schema_and_data_stream(
        schema_file=schema_file,
        data_files=data_files,
        user_email=current_user["email"],
    )


@router.post("/instance-generation/generate")
async def api_generate_instance(
    schema_file: UploadFile = File(..., description="RDF/Turtle schema file"),
    data_files: List[UploadFile] = File(..., description="CSV data files"),
    mappings: str = Form(..., description="JSON string of {data_header: schema_term} mappings"),
    schema_id: Optional[str] = Form("main", description="Which schema workspace to use"),
    current_user: Any = Depends(get_current_user),
) -> Dict:
    """
    Generate RDF instance file from schema and data files.
    
    Uses the provided mappings to determine how CSV headers map to schema terms.
    Returns generated Turtle content and metadata.
    """
    return await ctrl_generate_instance(
        schema_file=schema_file,
        data_files=data_files,
        mappings=mappings,
        user_email=current_user["email"],
        schema_id=schema_id,
    )

