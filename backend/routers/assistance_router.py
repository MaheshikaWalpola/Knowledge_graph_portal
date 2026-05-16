# routers/assistant_router.py
import re
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Literal, Optional

from services.local_llm_service import LocalLLMService
from services.graphdb_service import (
    resolve_schema_term_to_iri_global,
    search_schema_terms_global,
    neighbors_schema_and_instances_global,
    connected_classes_global,
    numeric_stats_for_class,
    find_graphs_by_name,
    resolve_term_in_graph,
    neighbors_in_uploaded_two_graphs,
    search_terms_in_graph,
    execute_safe_select
)
from services.schema_service import get_ontology_schema

router = APIRouter(prefix="/assistant", tags=["assistant"])
svc = LocalLLMService()


class ChatMsg(BaseModel):
    role: Literal["user", "assistant", "system"]
    content: str


class ChatReq(BaseModel):
    messages: List[ChatMsg]


SCHEMA_HINTS = {
    "class", "classes", "property", "properties", "ontology", "schema",
    "relation", "relationship", "predicate", "iri", "instance", "instances",
    "type", "subclass", "domain", "range", "connected"
}

# General KG/semantic-web concepts that can be answered from common knowledge
# without querying the user's graph database.
GENERAL_KG_CONCEPTS = {
    "knowledge graph", "kg", "ontology", "rdf", "sparql", "owl", "triple",
    "turtle", "json-ld", "n-triples", "n3", "semantic web", "linked data",
    "namespace", "prefix", "iri", "uri", "blank node", "literal",
    "class", "subclass", "superclass", "instance", "individual", "property",
    "data property", "object property", "annotation property", "axiom",
    "inference", "reasoner", "shacl", "skos"
}


def is_general_concept_question(entity_term: str, question: str) -> bool:
    """
    Conservative keyword safety net: returns True ONLY for pure definitional
    questions like 'What is a KG?' that have no specific entity/ontology context.
    This fires ONLY when the LLM also sets requires_graphdb=False.
    """
    q = question.lower().strip().rstrip("?").rstrip(".")

    # If the question contains any specific-context signals, it is NOT general
    specific_signals = [" in ", " of ", " for ", " from ", " within ", " inside "]
    if any(sig in q for sig in specific_signals):
        return False

    # Must match "what is [a/an] <concept>" exactly
    for concept in GENERAL_KG_CONCEPTS:
        if q in (f"what is {concept}", f"what is a {concept}", f"what is an {concept}"):
            return True

    return False


def extract_connected_to_term(q: str) -> str:
    """
    Extract term after 'connected to ...' for questions like:
      'What classes are connected to Pressure'
    """
    m = re.search(r"connected\s+to\s+([A-Za-z0-9_:-]+)", q, flags=re.IGNORECASE)
    if m:
        return m.group(1).strip()
    return q.strip()


def generate_options_for_stats(term: str, iri: str, graph_name: str = "") -> List[str]:
    """
    Generate meaningful follow-up options based on connected classes/entities.
    For example, if user asks for "average of Ripple Air Bag Pressure",
    suggest "average of [related_class]" from connected entities.
    """
    options = []
    
    try:
        # Get connected classes to this term
        connected = connected_classes_global(iri, limit=50)
        
        if not connected:
            return []
        
        # Extract unique labels/names from connected classes
        seen = set()
        for row in connected[:20]:  # Check first 20 connections
            label = row.get("label") or row.get("class", "").split("/")[-1]
            if label and label not in seen:
                seen.add(label)
                # Generate option text
                direction = "(" + row.get("direction", "related") + ")"
                options.append(f"Average of {label} {direction}")
                if len(options) >= 3:  # Limit to 3 suggestions
                    break
        
        return options
    except Exception as e:
        print(f"Error generating stat options: {e}")
        return []


def build_evidence_for_term(term: str, graph_name: str = "") -> str:
    matched_graphs = []
    if graph_name:
        matched_graphs = find_graphs_by_name(graph_name)
        
    if matched_graphs:
        out = []
        out.append(f"Matched {len(matched_graphs)} graphs for '{graph_name}'")
        for g_iri in matched_graphs:
            iri = resolve_term_in_graph(term, g_iri)
            if not iri:
                continue
                
            instance_g_iri = g_iri + "/instances"
            g = neighbors_in_uploaded_two_graphs(iri, g_iri, instance_g_iri, limit=400)
            edges = g.get("edges") or []
            nodes = g.get("nodes") or []
            
            out.append(f"\nGraph: {g_iri}")
            out.append(f"Resolved term '{term}' to IRI: {iri}")
            out.append(f"Edges (source --predicate--> target), count={len(edges)}:")
            for e in edges[:200]:
                out.append(f"{e['source']} -- {e['relation']} --> {e['target']}")
                
            out.append(f"Nodes (IRI | label), count={len(nodes)}:")
            for n in nodes[:200]:
                out.append(f"{n.get('iri')} | {n.get('label') or ''}")
                
        if len(out) > 1:
            return "\n".join(out)

    # Default to global resolution if graph wasn't provided or no matches found
    iri = resolve_schema_term_to_iri_global(term)

    if not iri:
        return ""

    g = neighbors_schema_and_instances_global(iri, limit=400)
    edges = g.get("edges") or []
    nodes = g.get("nodes") or []

    out = []
    out.append(f"Resolved term '{term}' to IRI: {iri}")
    out.append(f"Edges (source --predicate--> target), count={len(edges)}:")
    for e in edges[:200]:
        out.append(f"{e['source']} -- {e['relation']} --> {e['target']}")

    out.append(f"Nodes (IRI | label), count={len(nodes)}:")
    for n in nodes[:200]:
        out.append(f"{n.get('iri')} | {n.get('label') or ''}")

    return "\n".join(out)


@router.post("/chat")
def chat(req: ChatReq):
    last_user = None
    for m in reversed(req.messages):
        if m.role == "user" and (m.content or "").strip():
            last_user = m.content.strip()
            break

    if not last_user:
        raise HTTPException(status_code=400, detail="No user message provided.")

    history = [{"role": m.role, "content": m.content} for m in req.messages]

    try:
        qlow = last_user.lower().strip()
        
        m_avg = re.search(r"\b(average|avg|mean)\b", qlow)
        is_connected_q = "classes" in qlow and "connected to" in qlow

        # Always analyze intent to extract entity_term or clarify
        intent = svc.analyze_intent_and_clarify(last_user, history=history)
        
        if not intent.get("is_clear", True):
            raw_options = intent.get("options", [])
            safe_options = []
            for opt in raw_options:
                if isinstance(opt, str):
                    safe_options.append(opt)
                elif isinstance(opt, dict) and "option" in opt:
                    safe_options.append(str(opt["option"]))
                elif isinstance(opt, dict) and len(opt) > 0:
                    safe_options.append(str(list(opt.values())[0]))
                else:
                    safe_options.append(str(opt))
            
            return {
                "answer": intent.get("clarification_message", "Please clarify your request."),
                "options": safe_options
            }

        entity_term = intent.get("entity_term") or last_user.strip()
        graph_name = intent.get("graph_name", "").strip()

        graph_name = intent.get("graph_name", "").strip()

        # Check if it's a general concept question not needing GraphDB
        is_general = (
            not intent.get("requires_graphdb", True)
            or is_general_concept_question(entity_term, last_user)
        )

        if is_general:
            answer = svc.chat_general(last_user, history=history)
            return {"answer": answer, "options": []}

        # --- Dynamic SPARQL Generation Pipeline ---
        try:
            print(f"[DEBUG] Starting dynamic SPARQL pipeline for graph: {graph_name}")
            # 1. Fetch Schema Context
            print(f"[DEBUG] Fetching schema context...")
            schema_context, target_graphs = get_ontology_schema(graph_name if graph_name else None)
            print(f"[DEBUG] Schema context fetched. Length: {len(schema_context)} characters")
            
            # 2. Generate SPARQL Query using LLM
            print(f"[DEBUG] Requesting LLM to generate SPARQL...")
            sparql_query = svc.generate_sparql(last_user, schema_context)
            
            # 2.5 Replace placeholders with actual Graph IRIs
            for i, graph_iri in enumerate(target_graphs):
                sparql_query = sparql_query.replace(f"<GRAPH_{i}>", f"<{graph_iri}>")
                
            print(f"[DEBUG] Generated SPARQL Query:\n{sparql_query}\n")
            
            # 3. Execute SPARQL safely
            print(f"[DEBUG] Executing SPARQL query against GraphDB...")
            raw_results = execute_safe_select(sparql_query)
            print(f"[DEBUG] GraphDB Results returned: {len(raw_results)} rows")
            
            if not raw_results:
                return {
                    "answer": "I could not find information regarding this in the available graph data.",
                    "options": []
                }
                
            # 4. Generate final natural language answer
            answer = svc.answer_from_sparql_results(last_user, str(raw_results), history=history)
            return {"answer": answer, "options": []}

        except Exception as query_err:
            print(f"[ERROR] Dynamic SPARQL pipeline failed: {query_err}")
            return {
                "answer": f"I encountered an error trying to query the graph database: {str(query_err)}",
                "options": []
            }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
