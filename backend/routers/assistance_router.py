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
    search_terms_in_graph
)

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


def extract_connected_to_term(q: str) -> str:
    """
    Extract term after 'connected to ...' for questions like:
      'What classes are connected to Pressure'
    """
    m = re.search(r"connected\s+to\s+([A-Za-z0-9_:-]+)", q, flags=re.IGNORECASE)
    if m:
        return m.group(1).strip()
    return q.strip()


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

        # Special intent: average/avg/mean of a term (numeric instance stats)
        if m_avg:
            # extract term after "of" or "for" if present
            m_term = re.search(
                r"\b(?:average|avg|mean)\s+(?:of|for)\s+(.+)$",
                last_user,
                flags=re.IGNORECASE
            )
            term = entity_term
            if not term or term == last_user.strip():
                term = (m_term.group(1).strip() if m_term else last_user.strip())
            # Strip trailing punctuation like "?"
            term = term.rstrip("?")

            iri = None
            stats = None
            if graph_name:
                matched_graphs = find_graphs_by_name(graph_name)
                for g_iri in matched_graphs:
                    iri = resolve_term_in_graph(term, g_iri)
                    if iri:
                        stats = numeric_stats_for_class(iri, instance_graph_iri=g_iri + "/instances", schema_graph_iri=g_iri)
                        if stats and stats["count"] > 0:
                            break
            
            if not iri:
                iri = resolve_schema_term_to_iri_global(term)
                if iri:
                    stats = numeric_stats_for_class(iri)

            if not iri:
                candidates = []
                if graph_name:
                    matched_graphs = find_graphs_by_name(graph_name)
                    for g_iri in matched_graphs:
                        candidates.extend(search_terms_in_graph(term, g_iri, limit=5))
                else:
                    candidates = search_schema_terms_global(term, limit=10)

                if not candidates:
                    return {"answer": f"'{term}' was not found.", "options": []}

                options = list({c.get("label") or c["iri"].split("/")[-1] for c in candidates})[:10]
                return {
                    "answer": f"'{term}' was not found. Did you mean:",
                    "options": options
                }

            if not stats or stats["count"] == 0 or stats["avg"] is None:
                return {"answer": f"No numeric instance values found for '{term}'.", "options": []}

            return {
                "answer": (
                    f"Stats for {term}:\n"
                    f"- count: {stats['count']}\n"
                    f"- avg: {stats['avg']}\n"
                    f"- min: {stats['min']}\n"
                    f"- max: {stats['max']}"
                ),
                "options": []
            }

        # 2) Special intent: "What classes are connected to X"
        if is_connected_q:
            term = entity_term
            if not term or term == last_user.strip():
                term = extract_connected_to_term(last_user)
            term = term.rstrip("?")

            iri = None
            rows = []
            
            if graph_name:
                matched_graphs = find_graphs_by_name(graph_name)
                for g_iri in matched_graphs:
                    iri = resolve_term_in_graph(term, g_iri)
                    if iri:
                        # Extract schema connections using neighbors
                        g = neighbors_in_uploaded_graph(iri, g_iri, schema_only=True, limit=200)
                        edges = g.get("edges") or []
                        nodes = g.get("nodes") or []
                        
                        node_map = {n["iri"]: n.get("label") or n["iri"].split("/")[-1] for n in nodes}
                        
                        for e in edges:
                            other = e["target"] if e["source"] == iri else e["source"]
                            direction = "out" if e["source"] == iri else "in"
                            rows.append({
                                "class": other,
                                "label": node_map.get(other, other.split("/")[-1]),
                                "relation": e["relation"],
                                "direction": direction
                            })
                        if rows:
                            break

            if not iri:
                iri = resolve_schema_term_to_iri_global(term)
                if iri:
                    rows = connected_classes_global(iri, limit=200)

            if not iri:
                answer = svc.chat_general(
                    f"{last_user}\n\nNote: '{term}' was not found.", history=history
                )
                return {"answer": answer, "options": []}

            if not rows:
                return {"answer": f"No connected classes found for '{term}'.", "options": []}

            evidence_lines = [
                f"Target class IRI: {iri}",
                "Connected classes (label | classIRI | direction | relationIRI):",
            ]
            for r in rows[:80]:
                evidence_lines.append(
                    f"{r['label']} | {r['class']} | {r['direction']} | {r['relation']}"
                )

            answer = svc.chat_grounded(
                f"What classes are connected to {term}?",
                evidence="\n".join(evidence_lines), history=history
            )
            return {"answer": answer, "options": []}

        # 3) Default routing using extracted entity_term
        term = entity_term
        evidence = build_evidence_for_term(term, graph_name)
        
        if not evidence:
            # Disambiguate if possible
            candidates = []
            if graph_name:
                matched_graphs = find_graphs_by_name(graph_name)
                for g_iri in matched_graphs:
                    candidates.extend(search_terms_in_graph(term, g_iri, limit=5))
            else:
                candidates = search_schema_terms_global(term, limit=10)

            if candidates:
                options = list({c.get("label") or c["iri"].split("/")[-1] for c in candidates})[:10]
                return {
                    "answer": f"Multiple or fuzzy matches found for '{term}'. Did you mean:",
                    "options": options
                }
            else:
                # If even the extracted entity isn't in graphDB, try raw last_user
                if not graph_name:
                    candidates_raw = search_schema_terms_global(last_user.strip(), limit=10)
                    if candidates_raw:
                        options = list({c.get("label") or c["iri"].split("/")[-1] for c in candidates_raw})[:10]
                        return {
                            "answer": f"Multiple matches found. Did you mean:",
                            "options": options
                        }


        if not evidence:
            if intent.get("requires_graphdb", True):
                answer = svc.chat_grounded(last_user, evidence="", history=history)
            else:
                answer = svc.chat_general(last_user, history=history)
        else:
            answer = svc.chat_grounded(last_user, evidence=evidence, history=history)

        return {"answer": answer, "options": []}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
