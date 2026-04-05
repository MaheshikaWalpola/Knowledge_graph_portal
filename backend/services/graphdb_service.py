from typing import List, Dict, Optional, Tuple, Set, Literal
from SPARQLWrapper import SPARQLWrapper, JSON, POST, URLENCODED, TURTLE
from core.config import settings
import urllib.parse
import requests
import hashlib

# prefixes
PREFIXES = f"""
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX rdf:  <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX owl:  <http://www.w3.org/2002/07/owl#>
PREFIX xsd:  <http://www.w3.org/2001/XMLSchema#>
PREFIX cmpo: <{settings.CMP_NS}>
"""

# Base schema named graph (read-only)
BASE_SCHEMA_GRAPH = settings.BASE_SCHEMA_GRAPH or settings.CMP_NS.rstrip("/") + "/base"
BASE_INSTANCE_GRAPH = settings.BASE_INSTANCE_GRAPH or settings.CMP_NS.rstrip("/") + "/graph/base-instances"


# low-level clients
def _select_client() -> SPARQLWrapper:
    c = SPARQLWrapper(
        f"{settings.GRAPHDB_BASE_URL}/repositories/{settings.GRAPHDB_REPOSITORY}"
    )
    c.setMethod(POST)
    c.setRequestMethod(URLENCODED)
    return c


def _update_client() -> SPARQLWrapper:
    c = SPARQLWrapper(
        f"{settings.GRAPHDB_BASE_URL}/repositories/{settings.GRAPHDB_REPOSITORY}/statements"
    )
    c.setMethod(POST)
    c.setReturnFormat(JSON)
    c.setRequestMethod(URLENCODED)
    return c


def _exec_select(q: str):
    s = _select_client()
    s.setQuery(q)
    s.setReturnFormat(JSON)
    return s.query().convert()


# safety helpers
def _assert_not_base_graph(graph_iri: str):
    if graph_iri == BASE_SCHEMA_GRAPH:
        raise ValueError("Modification of the base schema graph is not allowed")


def _ensure_schema_iri(iri: str, role: str):
    if not iri.startswith(settings.CMP_NS) or iri.startswith(settings.CMP_INSTANCE_NS):
        raise ValueError(
            f"{role} must be in schema namespace {settings.CMP_NS} (not instance)"
        )



def graph_has_triples(graph_iri: str) -> bool:
    """Check if a named graph has any triples (public API)."""
    return _graph_has_triples(graph_iri)


def _graph_has_triples(graph_iri: str) -> bool:
    q = PREFIXES + f"""
    ASK {{
      GRAPH <{graph_iri}> {{ ?s ?p ?o }}
    }}
    """
    res = _exec_select(q)
    return bool(res.get("boolean"))


def _base_graph_has_triples() -> bool:
    return _graph_has_triples(BASE_SCHEMA_GRAPH)


# parsing helpers
def _edge_rows(res) -> List[Dict]:
    edges: List[Dict] = []
    for b in res["results"]["bindings"]:
        edges.append(
            {
                "source": b["source"]["value"],
                "relation": b["relation"]["value"],
                "target": b["target"]["value"],
            }
        )
    return edges


def _fetch_nodes_with_labels(iris: set[str]) -> list[dict]:
    """
    Fetch rdfs:label for a set of IRIs (schema or instances),
    without restricting to a single named graph.
    """
    if not iris:
        return []

    values = " ".join(f"<{iri}>" for iri in list(iris)[:2000])

    q = PREFIXES + f"""
    SELECT ?s ?lbl WHERE {{
      VALUES ?s {{ {values} }}
      OPTIONAL {{ ?s rdfs:label ?lbl }}
    }}
    """

    res = _exec_select(q)

    labels = {}
    for b in res["results"]["bindings"]:
        s = b["s"]["value"]
        lbl = b.get("lbl", {}).get("value")
        if lbl:
            labels[s] = lbl

    return [{"iri": iri, "label": labels.get(iri)} for iri in iris]


def _fetch_nodes_with_labels_from_graph(iris: Set[str], graph_iri: str) -> List[Dict]:
    """
    IMPORTANT:
    Always fetch labels from the SAME graph you queried.
    This prevents "workspace labels leaking into base" and vice-versa.
    """
    if not iris:
        return []
    values = " ".join(f"<{iri}>" for iri in list(iris)[:2000])  # safety cap

    q = PREFIXES + f"""
    SELECT ?s (SAMPLE(?lbl) AS ?lbl) WHERE {{
      GRAPH <{graph_iri}> {{
        VALUES ?s {{ {values} }}
        OPTIONAL {{ ?s rdfs:label ?lbl }}
      }}
    }}
    GROUP BY ?s
    """

    res = _exec_select(q)
    labels_map: Dict[str, str] = {}
    for b in res["results"]["bindings"]:
        s = b["s"]["value"]
        lbl = b.get("lbl", {}).get("value")
        if lbl:
            labels_map[s] = lbl

    return [{"iri": iri, "label": labels_map.get(iri)} for iri in iris]


def _filters_for_level(level: Literal["schema", "both"]) -> Tuple[str, str]:
    """
    Filters used in full_schema_graph() only.
    """
    cmp_base = "STR(cmpo:)"
    inst_base = settings.CMP_INSTANCE_NS

    subj_cmp = f"FILTER(STRSTARTS(STR(?source), {cmp_base}))"
    obj_cmp = f"FILTER(STRSTARTS(STR(?target), {cmp_base}))"

    if level == "schema":
        subj = subj_cmp + f'\nFILTER(!STRSTARTS(STR(?source), "{inst_base}"))'
        obj = obj_cmp + f'\nFILTER(!STRSTARTS(STR(?target), "{inst_base}"))'
    else:
        subj = subj_cmp
        obj = obj_cmp

    return subj, obj


# ------------------------------
# WORKSPACE INSTANCE DISPLAY (NEW)
# ------------------------------

def _is_workspace_instances_graph(graph_iri: str) -> bool:
    return ("/workspace/" in graph_iri) and graph_iri.endswith("/instances")


def _make_group_node_iri(group_key: str) -> str:
    """
    Mint a VIRTUAL node IRI for the UI; does not exist in RDF.
    """
    base = settings.CMP_NS.rstrip("/")
    safe = urllib.parse.quote(group_key, safe="")
    return f"{base}/instance/group/{safe}"


def _decode_group_node_iri(group_node_iri: str) -> str:
    base = settings.CMP_NS.rstrip("/") + "/instance/group/"
    if not group_node_iri.startswith(base):
        raise ValueError("Not a workspace group node")
    encoded = group_node_iri[len(base):]
    return urllib.parse.unquote(encoded)


def workspace_instance_groups_for_class(
    class_iri: str,
    instance_graph_iri: str,
    schema_graph_iri: str,   # <-- add this
    limit: int = 2000,
) -> Dict:
    q = PREFIXES + f"""
    SELECT
      ?cls
      (COUNT(?v) AS ?count)
      (MIN(xsd:float(?v)) AS ?min)
      (MAX(xsd:float(?v)) AS ?max)
      (AVG(xsd:float(?v)) AS ?avg)
    WHERE {{
      GRAPH <{instance_graph_iri}> {{
        ?rowNode rdf:type ?cls .
        ?rowNode cmpo:hasNumericValue ?v .
      }}
      GRAPH <{schema_graph_iri}> {{
        ?cls rdfs:subClassOf* <{class_iri}> .
      }}
    }}
    GROUP BY ?cls
    ORDER BY ?cls
    LIMIT {limit}
    """
    res = _exec_select(q)

    nodes: List[Dict] = []
    edges: List[Dict] = []

    for b in res["results"]["bindings"]:
        cls_iri = b["cls"]["value"]

        # Extract clean local name (handle # and / separators)
        if "#" in cls_iri:
            cls_local = cls_iri.rsplit("#", 1)[-1]
        else:
            cls_local = cls_iri.rsplit("/", 1)[-1]

        # Convert camelCase/PascalCase to readable: "CenterAirBagPressure" → "Center Air Bag Pressure"
        import re
        readable = re.sub(r'([a-z])([A-Z])', r'\1 \2', cls_local)
        readable = re.sub(r'([A-Z]+)([A-Z][a-z])', r'\1 \2', readable)
        readable = readable.replace("_", " ").strip()

        group_node = _make_group_node_iri(cls_iri)

        nodes.append(
            {
                "iri": group_node,
                "label": readable,
                "kind": "workspace_group",
                "groupKey": cls_iri,
                "type": cls_iri,
                "summary": {
                    "count": int(b["count"]["value"]),
                    "min": float(b["min"]["value"]),
                    "max": float(b["max"]["value"]),
                    "avg": float(b["avg"]["value"]),
                },
            }
        )

        edges.append(
            {
                "source": group_node,
                "relation": str("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
                "target": class_iri,
            }
        )

    return {"nodes": nodes, "edges": edges}

def workspace_group_values(
    group_node_iri: str,
    instance_graph_iri: str,
    limit: int = 5000,
) -> Dict:
    cls_iri = _decode_group_node_iri(group_node_iri)

    q = PREFIXES + f"""
    SELECT ?s ?v WHERE {{
      GRAPH <{instance_graph_iri}> {{
        ?s rdf:type <{cls_iri}> .
        ?s cmpo:hasNumericValue ?v .
      }}
    }}
    ORDER BY ?s
    LIMIT {limit}
    """

    res = _exec_select(q)

    values: List[float] = []
    for b in res["results"]["bindings"]:
        values.append(float(b["v"]["value"]))

    if values:
        vmin = min(values)
        vmax = max(values)
        vavg = sum(values) / len(values)
    else:
        vmin = vmax = vavg = None

    return {
        "iri": group_node_iri,
        "kind": "workspace_group",
        "groupKey": cls_iri,
        "values": values,
        "summary": {"count": len(values), "min": vmin, "max": vmax, "avg": vavg},
    }


# resolvers (STRICT: base graph only)
def resolve_schema_term_to_iri(term: str) -> Optional[str]:
    """
    STRICT behavior:
    - Only resolves from BASE_SCHEMA_GRAPH
    - No fallback to "all graphs"
    """
    t = (term or "").strip().lower()
    if not t:
        return None

    inst_ns = settings.CMP_INSTANCE_NS

    q = PREFIXES + f"""
    SELECT ?s WHERE {{
      GRAPH <{BASE_SCHEMA_GRAPH}> {{
        ?s ?p ?o .
        FILTER(STRSTARTS(STR(?s), STR(cmpo:)))
        FILTER(!STRSTARTS(STR(?s), "{inst_ns}"))
        OPTIONAL {{ ?s rdfs:label ?lbl }}
        BIND(LCASE("{t}") AS ?t)
        BIND(LCASE(STRAFTER(STR(?s), STR(cmpo:))) AS ?local)
        FILTER( ?local = ?t || (BOUND(?lbl) && LCASE(STR(?lbl)) = ?t) )
      }}
    }}
    LIMIT 1
    """

    rows = _exec_select(q)["results"]["bindings"]
    return rows[0]["s"]["value"] if rows else None


def search_base_schema_terms(term: str, limit: int = 15) -> List[Dict]:
    t = (term or "").strip().lower()
    if not t:
        return []

    inst_ns = settings.CMP_INSTANCE_NS

    q = PREFIXES + f"""
    SELECT DISTINCT ?s (SAMPLE(?lbl) AS ?lbl) WHERE {{
      GRAPH <{BASE_SCHEMA_GRAPH}> {{
        ?s ?p ?o .
        FILTER(STRSTARTS(STR(?s), STR(cmpo:)))
        FILTER(!STRSTARTS(STR(?s), "{inst_ns}"))
        OPTIONAL {{ ?s rdfs:label ?lbl }}
        BIND(LCASE("{t}") AS ?t)
        BIND(LCASE(STRAFTER(STR(?s), STR(cmpo:))) AS ?local)
        FILTER(CONTAINS(?local, ?t) || (BOUND(?lbl) && CONTAINS(LCASE(STR(?lbl)), ?t)))
      }}
    }}
    GROUP BY ?s
    LIMIT {limit}
    """
    res = _exec_select(q)
    out = []
    for b in res["results"]["bindings"]:
        out.append({"iri": b["s"]["value"], "label": b.get("lbl", {}).get("value")})
    return out

# READ APIs: BASE ONTOLOGY (STRICT)
def full_schema_graph(limit: int = 20000) -> Dict:
    """
    Full base schema graph (schema-only), strictly from BASE_SCHEMA_GRAPH.
    """
    subj_filter, obj_filter = _filters_for_level("schema")
    q = PREFIXES + f"""
    SELECT ?source ?relation ?target
    WHERE {{
      GRAPH <{BASE_SCHEMA_GRAPH}> {{
        ?source ?relation ?target .
        {subj_filter}
        {obj_filter}
      }}
    }}
    LIMIT {limit}
    """
    edges = _edge_rows(_exec_select(q))

    iris: Set[str] = set()
    for e in edges:
        iris.add(e["source"])
        iris.add(e["target"])

    nodes = _fetch_nodes_with_labels_from_graph(iris, BASE_SCHEMA_GRAPH)
    return {"nodes": nodes, "edges": edges}


def neighbors_schema(node_iri: str, limit: int = 5000) -> Dict:
    """
    Schema-only neighbors for a node in BASE_SCHEMA_GRAPH.
    """
    inst_ns = settings.CMP_INSTANCE_NS
    q = PREFIXES + f"""
    SELECT ?source ?relation ?target
    WHERE {{
      GRAPH <{BASE_SCHEMA_GRAPH}> {{
        {{
          BIND(<{node_iri}> AS ?node)
          ?node ?relation ?target .
          BIND(?node AS ?source)
          FILTER(STRSTARTS(STR(?target), STR(cmpo:)))
          FILTER(!STRSTARTS(STR(?target), "{inst_ns}"))
        }}
        UNION
        {{
          BIND(<{node_iri}> AS ?node)
          ?source ?relation ?node .
          BIND(?node AS ?target)
          FILTER(STRSTARTS(STR(?source), STR(cmpo:)))
          FILTER(!STRSTARTS(STR(?source), "{inst_ns}"))
        }}
      }}
    }}
    LIMIT {limit}
    """

    edges = _edge_rows(_exec_select(q))

    iris: Set[str] = {node_iri}
    for e in edges:
        iris.add(e["source"])
        iris.add(e["target"])

    nodes = _fetch_nodes_with_labels_from_graph(iris, BASE_SCHEMA_GRAPH)
    return {"node": node_iri, "nodes": nodes, "edges": edges}


def neighbors_both(node_iri: str, limit: int = 5000) -> Dict:
    """
    Neighbors for a node in BASE_SCHEMA_GRAPH, allowing instances.
    """
    q = PREFIXES + f"""
    SELECT ?source ?relation ?target
    WHERE {{
      GRAPH <{BASE_SCHEMA_GRAPH}> {{
        {{
          BIND(<{node_iri}> AS ?node)
          ?node ?relation ?target .
          BIND(?node AS ?source)
          FILTER(STRSTARTS(STR(?target), STR(cmpo:)))
        }}
        UNION
        {{
          BIND(<{node_iri}> AS ?node)
          ?source ?relation ?node .
          BIND(?node AS ?target)
          FILTER(STRSTARTS(STR(?source), STR(cmpo:)))
        }}
      }}
    }}
    LIMIT {limit}
    """

    edges = _edge_rows(_exec_select(q))

    iris: Set[str] = {node_iri}
    for e in edges:
        iris.add(e["source"])
        iris.add(e["target"])

    nodes = _fetch_nodes_with_labels_from_graph(iris, BASE_SCHEMA_GRAPH)
    return {"node": node_iri, "nodes": nodes, "edges": edges}


def neighbors_schema_and_instances(node_iri: str, limit: int = 5000) -> Dict:
    """
    Neighbors from:
      - BASE_SCHEMA_GRAPH
      - BASE_INSTANCE_GRAPH
    """

    q = PREFIXES + f"""
    SELECT ?source ?relation ?target WHERE {{
      {{
        GRAPH <{BASE_SCHEMA_GRAPH}> {{
          {{
            <{node_iri}> ?relation ?target .
            BIND(<{node_iri}> AS ?source)
          }}
          UNION
          {{
            ?source ?relation <{node_iri}> .
            BIND(<{node_iri}> AS ?target)
          }}
        }}
      }}
      UNION
      {{
        GRAPH <{BASE_INSTANCE_GRAPH}> {{
          {{
            <{node_iri}> ?relation ?target .
            BIND(<{node_iri}> AS ?source)
          }}
          UNION
          {{
            ?source ?relation <{node_iri}> .
            BIND(<{node_iri}> AS ?target)
          }}
        }}
      }}
    }}
    LIMIT {limit}
    """

    edges = _edge_rows(_exec_select(q))

    iris: Set[str] = {node_iri}
    for e in edges:
        iris.add(e["source"])
        iris.add(e["target"])

    nodes = _fetch_nodes_with_labels(iris)
    return {"node": node_iri, "nodes": nodes, "edges": edges}


def get_instance_summary(instance_iri: str) -> Dict:
    q = PREFIXES + f"""
    SELECT ?type ?value WHERE {{
      GRAPH <{BASE_INSTANCE_GRAPH}> {{
        <{instance_iri}> rdf:type ?type .
        OPTIONAL {{
          <{instance_iri}> cmpo:hasNumericValue ?value .
        }}
      }}
    }}
    """

    res = _exec_select(q)

    values = []
    inst_type = None

    for b in res["results"]["bindings"]:
        if not inst_type:
            inst_type = b["type"]["value"]
        if "value" in b:
            values.append(float(b["value"]["value"]))

    return {
        "iri": instance_iri,
        "id": instance_iri.split("/")[-1],
        "type": inst_type.split("/")[-1] if inst_type else None,
        "values": values,
    }

def numeric_stats_for_class(
    class_iri: str,
    instance_graph_iri: str = BASE_INSTANCE_GRAPH,
    schema_graph_iri: str = BASE_SCHEMA_GRAPH,
) -> Optional[Dict]:
    q = PREFIXES + f"""
    SELECT
      (COUNT(?s) AS ?count)
      (MIN(xsd:float(?v)) AS ?min)
      (MAX(xsd:float(?v)) AS ?max)
      (AVG(xsd:float(?v)) AS ?avg)
    WHERE {{
      GRAPH <{instance_graph_iri}> {{
        ?s rdf:type ?cls .
        ?s cmpo:hasNumericValue ?v .
      }}
      GRAPH <{schema_graph_iri}> {{
        ?cls rdfs:subClassOf* <{class_iri}> .
      }}
    }}
    """
    res = _exec_select(q)
    rows = res.get("results", {}).get("bindings", [])
    if not rows:
        return None

    b = rows[0]
    count = int(b["count"]["value"]) if "count" in b else 0

    # If there are no numeric values, Virtuoso/GraphDB may omit avg/min/max
    if count == 0 or "avg" not in b:
        return {"count": count, "min": None, "max": None, "avg": None}

    return {
        "count": count,
        "min": float(b["min"]["value"]) if "min" in b else None,
        "max": float(b["max"]["value"]) if "max" in b else None,
        "avg": float(b["avg"]["value"]) if "avg" in b else None,
    }

def neighbors_schema_and_instances_in_two_graphs(
    node_iri: str,
    schema_graph_iri: str,
    instance_graph_iri: str,
    limit: int = 5000,
) -> Dict:
    # 0) If user clicked a virtual group node -> return group values
    if _is_workspace_instances_graph(instance_graph_iri) and node_iri.startswith(
        settings.CMP_NS.rstrip("/") + "/instance/group/"
    ):
        details = workspace_group_values(
            group_node_iri=node_iri,
            instance_graph_iri=instance_graph_iri,
            limit=limit,
        )
        # Return as a "graph response" so frontend can reuse its rendering
        return {"node": node_iri, "nodes": [details], "edges": []}

    # 1) WORKSPACE INSTANCE DISPLAY OVERRIDE (CLASS SEARCH)
    if _is_workspace_instances_graph(instance_graph_iri) and node_iri.startswith(settings.CMP_NS.rstrip("/") + "/"):
        schema_part = neighbors_schema_in_graph(node_iri, schema_graph_iri, limit=limit)

        groups_part = workspace_instance_groups_for_class(
            class_iri=node_iri,
            instance_graph_iri=instance_graph_iri,
            schema_graph_iri=schema_graph_iri,   # <-- pass ONLY here
            limit=limit,
        )

        merged: Dict[str, Dict] = {}
        for n in (schema_part.get("nodes") or []):
            merged[n["iri"]] = n
        for n in (groups_part.get("nodes") or []):
            merged[n["iri"]] = n

        merged_edges = (schema_part.get("edges") or []) + (groups_part.get("edges") or [])

        return {"node": node_iri, "nodes": list(merged.values()), "edges": merged_edges}


    # 2) DEFAULT (UNCHANGED) PATH
    q = PREFIXES + f"""
    SELECT ?source ?relation ?target
    WHERE {{
      {{
        GRAPH <{schema_graph_iri}> {{
          {{
            BIND(<{node_iri}> AS ?node)
            ?node ?relation ?target .
            BIND(?node AS ?source)
          }}
          UNION
          {{
            BIND(<{node_iri}> AS ?node)
            ?source ?relation ?node .
            BIND(?node AS ?target)
          }}
        }}
      }}
      UNION
      {{
        GRAPH <{instance_graph_iri}> {{
          {{
            ?source rdf:type <{node_iri}> .
            BIND(rdf:type AS ?relation)
            BIND(<{node_iri}> AS ?target)
          }}
          UNION
          {{
            BIND(<{node_iri}> AS ?node)
            ?node ?relation ?target .
            BIND(?node AS ?source)
          }}
          UNION
          {{
            BIND(<{node_iri}> AS ?node)
            ?source ?relation ?node .
            BIND(?node AS ?target)
          }}
        }}
      }}
    }}
    LIMIT {limit}
    """

    edges = _edge_rows(_exec_select(q))

    iris: Set[str] = {node_iri}
    for e in edges:
        iris.add(e["source"])
        iris.add(e["target"])

    nodes = _fetch_nodes_with_labels(iris)
    return {"node": node_iri, "nodes": nodes, "edges": edges}

def connected_classes_in_base_schema(class_iri: str, limit: int = 200) -> List[Dict]:
    """
    Return classes that have any direct edge to/from class_iri within BASE_SCHEMA_GRAPH.
    Schema-only, base graph only.
    """
    q = PREFIXES + f"""
    SELECT DISTINCT ?other ?rel ?dir (SAMPLE(?lbl) AS ?lbl)
    WHERE {{
      GRAPH <{BASE_SCHEMA_GRAPH}> {{
        {{
          <{class_iri}> ?rel ?other .
          BIND("out" AS ?dir)
        }}
        UNION
        {{
          ?other ?rel <{class_iri}> .
          BIND("in" AS ?dir)
        }}

        ?other a owl:Class .
        FILTER(STRSTARTS(STR(?other), STR(cmpo:)))
      }}

      OPTIONAL {{
        GRAPH <{BASE_SCHEMA_GRAPH}> {{ ?other rdfs:label ?lbl }}
      }}
    }}
    LIMIT {limit}
    """
    res = _exec_select(q)

    out: List[Dict] = []
    for b in res["results"]["bindings"]:
        out.append({
            "class": b["other"]["value"],
            "label": b.get("lbl", {}).get("value"),
            "relation": b["rel"]["value"],
            "direction": b["dir"]["value"],  # "in" or "out"
        })
    return out

# MULTI-SCHEMA WORKSPACE SUPPORT # Each user can have multiple schemas (graphs), identified by schema_id.

def user_schema_graph(user_key: str, schema_id: str) -> str:
    safe_user = urllib.parse.quote(user_key, safe="")
    safe_schema = urllib.parse.quote(schema_id, safe="")
    base = settings.CMP_NS.rstrip("/")
    return f"{base}/workspace/{safe_user}/{safe_schema}"


def init_user_schema_graph_from_base(user_key: str, schema_id: str) -> Dict:
    """
    Copy BASE_SCHEMA_GRAPH into the user's schema graph ONCE.
    Keeps literals too (labels/comments).
    """
    graph_iri = user_schema_graph(user_key, schema_id)

    if _graph_has_triples(graph_iri):
        return {"status": "ok", "message": "schema already initialized", "graph": graph_iri}

    if not _base_graph_has_triples():
        return {
            "status": "error",
            "message": (
                "BASE_SCHEMA_GRAPH is empty. Import your base ontology into the named graph "
                f"<{BASE_SCHEMA_GRAPH}> first."
            ),
            "graph": graph_iri,
        }

    inst_ns = settings.CMP_INSTANCE_NS

    # Copy everything where subject is cmpo schema (not instance).
    # Keep object literals AND cmpo objects.
    update = PREFIXES + f"""
    INSERT {{
      GRAPH <{graph_iri}> {{
        ?s ?p ?o .
      }}
    }}
    WHERE {{
      GRAPH <{BASE_SCHEMA_GRAPH}> {{
        ?s ?p ?o .
        FILTER(STRSTARTS(STR(?s), STR(cmpo:)))
        FILTER(!STRSTARTS(STR(?s), "{inst_ns}"))
      }}
    }}
    """
    u = _update_client()
    u.setQuery(update)
    u.query()

    return {"status": "ok", "message": "schema initialized", "graph": graph_iri}


def user_schema_instance_graph(user_key: str, schema_id: str) -> str:
    """
    Named graph IRI for instances belonging to a user's schema.
    Example:
      https://tucid/cpmo/workspace/pabapalihena%40gmail.com/main/instances
    """
    safe_user = urllib.parse.quote(user_key, safe="")
    safe_schema = urllib.parse.quote(schema_id, safe="")
    base = settings.CMP_NS.rstrip("/")
    return f"{base}/workspace/{safe_user}/{safe_schema}/instances"


def import_turtle_to_named_graph(turtle_str: str, graph_iri: str) -> None:
    """
    Upload Turtle content into a specific named graph in GraphDB.
    Uses GraphDB /statements endpoint with ?context=<graph>.
    """
    url = f"{settings.GRAPHDB_BASE_URL}/repositories/{settings.GRAPHDB_REPOSITORY}/statements"
    headers = {"Content-Type": "text/turtle"}

    # GraphDB expects context as <graphIri>
    params = {"context": f"<{graph_iri}>"}

    r = requests.post(
        url,
        params=params,
        data=turtle_str.encode("utf-8"),
        headers=headers,
        timeout=120,
    )
    if not r.ok:
        raise RuntimeError(f"GraphDB import failed: HTTP {r.status_code} - {r.text[:400]}")


def export_graph_turtle(graph_iri: str) -> str:
    """
    Export a specific named graph as Turtle.
    """
    q = PREFIXES + f"""
    CONSTRUCT {{ ?s ?p ?o }}
    WHERE {{
      GRAPH <{graph_iri}> {{ ?s ?p ?o }}
    }}
    """
    s = _select_client()
    s.setQuery(q)
    s.setReturnFormat(TURTLE)
    res = s.query().convert()
    return res.decode("utf-8") if isinstance(res, bytes) else res


def neighbors_schema_in_graph(node_iri: str, graph_iri: str, limit: int = 5000) -> Dict:
    """
    Schema-only neighbors inside a specific named graph.
    """
    inst_ns = settings.CMP_INSTANCE_NS
    q = PREFIXES + f"""
    SELECT ?source ?relation ?target
    WHERE {{
      GRAPH <{graph_iri}> {{
        {{
          BIND(<{node_iri}> AS ?node)
          ?node ?relation ?target .
          BIND(?node AS ?source)
          FILTER(STRSTARTS(STR(?target), STR(cmpo:)))
          FILTER(!STRSTARTS(STR(?target), "{inst_ns}"))
        }}
        UNION
        {{
          BIND(<{node_iri}> AS ?node)
          ?source ?relation ?node .
          BIND(?node AS ?target)
          FILTER(STRSTARTS(STR(?source), STR(cmpo:)))
          FILTER(!STRSTARTS(STR(?source), "{inst_ns}"))
        }}
      }}
    }}
    LIMIT {limit}
    """
    edges = _edge_rows(_exec_select(q))

    iris: Set[str] = {node_iri}
    for e in edges:
        iris.add(e["source"])
        iris.add(e["target"])

    nodes = _fetch_nodes_with_labels_from_graph(iris, graph_iri)
    return {"node": node_iri, "nodes": nodes, "edges": edges}


def neighbors_both_in_graph(node_iri: str, graph_iri: str, limit: int = 5000) -> Dict:
    """
    Neighbors allowing instances inside a specific named graph.
    """
    q = PREFIXES + f"""
    SELECT ?source ?relation ?target
    WHERE {{
      GRAPH <{graph_iri}> {{
        {{
          BIND(<{node_iri}> AS ?node)
          ?node ?relation ?target .
          BIND(?node AS ?source)
          FILTER(STRSTARTS(STR(?target), STR(cmpo:)))
        }}
        UNION
        {{
          BIND(<{node_iri}> AS ?node)
          ?source ?relation ?node .
          BIND(?node AS ?target)
          FILTER(STRSTARTS(STR(?source), STR(cmpo:)))
        }}
      }}
    }}
    LIMIT {limit}
    """
    edges = _edge_rows(_exec_select(q))

    iris: Set[str] = {node_iri}
    for e in edges:
        iris.add(e["source"])
        iris.add(e["target"])

    nodes = _fetch_nodes_with_labels_from_graph(iris, graph_iri)
    return {"node": node_iri, "nodes": nodes, "edges": edges}


# WORKSPACE WRITES (NEVER BASE)
def add_schema_triple_in_graph(
    subject_iri: str,
    predicate_iri: str,
    object_iri: str,
    graph_iri: str,
) -> None:
    _assert_not_base_graph(graph_iri)
    _ensure_schema_iri(subject_iri, "subject")
    _ensure_schema_iri(object_iri, "object")

    update = f"""
    INSERT DATA {{
      GRAPH <{graph_iri}> {{
        <{subject_iri}> <{predicate_iri}> <{object_iri}> .
      }}
    }}
    """
    u = _update_client()
    u.setQuery(update)
    u.query()


def delete_schema_triple_in_graph(
    subject_iri: str,
    predicate_iri: str,
    object_iri: Optional[str],
    graph_iri: str,
) -> None:
    _assert_not_base_graph(graph_iri)
    _ensure_schema_iri(subject_iri, "subject")

    if object_iri is None:
        update = f"""
        WITH <{graph_iri}>
        DELETE {{ <{subject_iri}> <{predicate_iri}> ?o }}
        WHERE  {{ <{subject_iri}> <{predicate_iri}> ?o }}
        """
    else:
        _ensure_schema_iri(object_iri, "object")
        update = f"""
        DELETE DATA {{
          GRAPH <{graph_iri}> {{
            <{subject_iri}> <{predicate_iri}> <{object_iri}> .
          }}
        }}
        """
    u = _update_client()
    u.setQuery(update)
    u.query()


def update_schema_triple_in_graph(
    subject_iri: str,
    predicate_iri: str,
    old_object_iri: Optional[str],
    new_object_iri: str,
    graph_iri: str,
) -> None:
    _assert_not_base_graph(graph_iri)
    _ensure_schema_iri(subject_iri, "subject")
    if old_object_iri:
        _ensure_schema_iri(old_object_iri, "old_object")
    _ensure_schema_iri(new_object_iri, "new_object")

    delete_schema_triple_in_graph(subject_iri, predicate_iri, old_object_iri, graph_iri)
    add_schema_triple_in_graph(subject_iri, predicate_iri, new_object_iri, graph_iri)


# ──────────────────────────────────────────────────────────────────────
# UPLOADED SCHEMA SUPPORT (NAMESPACE-AGNOSTIC)
# ──────────────────────────────────────────────────────────────────────

def full_uploaded_schema_graph(graph_iri: str, limit: int = 20000) -> Dict:
    """
    Return ALL triples from a user's uploaded schema graph.
    No namespace filtering — the named graph already isolates the data.
    """
    q = f"""
    SELECT ?source ?relation ?target
    WHERE {{
      GRAPH <{graph_iri}> {{
        ?source ?relation ?target .
        FILTER(isIRI(?source))
        FILTER(isIRI(?target))
      }}
    }}
    LIMIT {limit}
    """
    edges = _edge_rows(_exec_select(q))

    iris: Set[str] = set()
    for e in edges:
        iris.add(e["source"])
        iris.add(e["target"])

    nodes = _fetch_nodes_with_labels_from_graph(iris, graph_iri)
    return {"nodes": nodes, "edges": edges}


def neighbors_in_uploaded_graph(
    node_iri: str,
    graph_iri: str,
    limit: int = 5000,
) -> Dict:
    """
    Namespace-agnostic neighbor query for uploaded schemas.
    Returns all edges to/from node_iri within the given graph.
    """
    q = f"""
    SELECT ?source ?relation ?target
    WHERE {{
      GRAPH <{graph_iri}> {{
        {{
          BIND(<{node_iri}> AS ?node)
          ?node ?relation ?target .
          BIND(?node AS ?source)
          FILTER(isIRI(?target))
        }}
        UNION
        {{
          BIND(<{node_iri}> AS ?node)
          ?source ?relation ?node .
          BIND(?node AS ?target)
          FILTER(isIRI(?source))
        }}
      }}
    }}
    LIMIT {limit}
    """
    edges = _edge_rows(_exec_select(q))

    iris: Set[str] = {node_iri}
    for e in edges:
        iris.add(e["source"])
        iris.add(e["target"])

    nodes = _fetch_nodes_with_labels_from_graph(iris, graph_iri)
    return {"node": node_iri, "nodes": nodes, "edges": edges}


def neighbors_in_uploaded_two_graphs(
    node_iri: str,
    schema_graph_iri: str,
    instance_graph_iri: str,
    limit: int = 500,
) -> Dict:
    """
    Namespace-agnostic neighbors from both schema + instance graphs.
    """
    q = f"""
    SELECT ?source ?relation ?target WHERE {{
      {{
        GRAPH <{schema_graph_iri}> {{
          {{
            <{node_iri}> ?relation ?target .
            BIND(<{node_iri}> AS ?source)
            FILTER(isIRI(?target))
          }}
          UNION
          {{
            ?source ?relation <{node_iri}> .
            BIND(<{node_iri}> AS ?target)
            FILTER(isIRI(?source))
          }}
        }}
      }}
      UNION
      {{
        GRAPH <{instance_graph_iri}> {{
          {{
            <{node_iri}> ?relation ?target .
            BIND(<{node_iri}> AS ?source)
            FILTER(isIRI(?target))
          }}
          UNION
          {{
            ?source ?relation <{node_iri}> .
            BIND(<{node_iri}> AS ?target)
            FILTER(isIRI(?source))
          }}
        }}
      }}
    }}
    LIMIT {limit}
    """
    edges = _edge_rows(_exec_select(q))

    iris: Set[str] = {node_iri}
    for e in edges:
        iris.add(e["source"])
        iris.add(e["target"])

    nodes = _fetch_nodes_with_labels(iris)
    return {"node": node_iri, "nodes": nodes, "edges": edges}


def search_terms_in_graph(
    term: str,
    graph_iri: str,
    limit: int = 15,
) -> List[Dict]:
    """
    Search for classes/properties by local name or label within a specific graph.
    Namespace-agnostic — works for any uploaded ontology.
    """
    t = (term or "").strip().lower()
    if not t:
        return []

    q = f"""
    SELECT DISTINCT ?s (SAMPLE(?lbl) AS ?lbl) WHERE {{
      GRAPH <{graph_iri}> {{
        ?s ?p ?o .
        FILTER(isIRI(?s))
        OPTIONAL {{ ?s <http://www.w3.org/2000/01/rdf-schema#label> ?lbl }}
        BIND(LCASE(REPLACE(STR(?s), "^.*/|^.*#", "")) AS ?local)
        FILTER(
          CONTAINS(?local, "{t}")
          || (BOUND(?lbl) && CONTAINS(LCASE(STR(?lbl)), "{t}"))
        )
      }}
    }}
    GROUP BY ?s
    LIMIT {limit}
    """
    res = _exec_select(q)
    out = []
    for b in res["results"]["bindings"]:
        out.append({"iri": b["s"]["value"], "label": b.get("lbl", {}).get("value")})
    return out


def resolve_term_in_graph(term: str, graph_iri: str) -> Optional[str]:
    """
    Resolve a term to an IRI within a specific uploaded graph.
    Matches by local name or rdfs:label (case-insensitive).
    """
    t = (term or "").strip().lower()
    if not t:
        return None

    q = f"""
    SELECT ?s WHERE {{
      GRAPH <{graph_iri}> {{
        ?s ?p ?o .
        FILTER(isIRI(?s))
        OPTIONAL {{ ?s <http://www.w3.org/2000/01/rdf-schema#label> ?lbl }}
        BIND(LCASE(REPLACE(STR(?s), "^.*/|^.*#", "")) AS ?local)
        FILTER(
          ?local = "{t}"
          || (BOUND(?lbl) && LCASE(STR(?lbl)) = "{t}")
        )
      }}
    }}
    LIMIT 1
    """
    rows = _exec_select(q)["results"]["bindings"]
    return rows[0]["s"]["value"] if rows else None


def delete_named_graph(graph_iri: str) -> None:
    """Drop an entire named graph from GraphDB."""
    _assert_not_base_graph(graph_iri)
    update = f"DROP GRAPH <{graph_iri}>"
    u = _update_client()
    u.setQuery(update)
    u.query()


def add_triple_in_graph_no_ns_check(
    subject_iri: str,
    predicate_iri: str,
    object_iri: str,
    graph_iri: str,
) -> None:
    """Add a triple without namespace validation (for uploaded schemas)."""
    _assert_not_base_graph(graph_iri)
    update = f"""
    INSERT DATA {{
      GRAPH <{graph_iri}> {{
        <{subject_iri}> <{predicate_iri}> <{object_iri}> .
      }}
    }}
    """
    u = _update_client()
    u.setQuery(update)
    u.query()


def delete_triple_in_graph_no_ns_check(
    subject_iri: str,
    predicate_iri: str,
    object_iri: Optional[str],
    graph_iri: str,
) -> None:
    """Delete a triple without namespace validation (for uploaded schemas)."""
    _assert_not_base_graph(graph_iri)
    if object_iri is None:
        update = f"""
        WITH <{graph_iri}>
        DELETE {{ <{subject_iri}> <{predicate_iri}> ?o }}
        WHERE  {{ <{subject_iri}> <{predicate_iri}> ?o }}
        """
    else:
        update = f"""
        DELETE DATA {{
          GRAPH <{graph_iri}> {{
            <{subject_iri}> <{predicate_iri}> <{object_iri}> .
          }}
        }}
        """
    u = _update_client()
    u.setQuery(update)
    u.query()
