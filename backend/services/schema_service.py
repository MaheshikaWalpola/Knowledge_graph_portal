from typing import Optional, List, Dict, Tuple
from services.graphdb_service import _exec_select, find_graphs_by_name, BASE_SCHEMA_GRAPH, PREFIXES

def get_ontology_schema(graph_name: Optional[str] = None, explicit_target_graphs: Optional[List[str]] = None) -> Tuple[str, List[str]]:
    """
    Fetches the schema (classes, properties, domains, ranges) from the specified graph,
    or the base schema graph if no graph is provided/matched.
    Returns a formatted string suitable for the LLM context.
    """
    target_graphs = explicit_target_graphs or []
    
    if not target_graphs and graph_name:
        target_graphs = find_graphs_by_name(graph_name)
    
    if not target_graphs:
        target_graphs = [BASE_SCHEMA_GRAPH]
        
    schema_lines = []
    
    for i, graph_iri in enumerate(target_graphs):
        schema_lines.append(f"--- Schema Context for Graph: <GRAPH_{i}> ---")
        
        # 1. Fetch Classes (both explicit owl:Class and implicit via subClassOf)
        q_classes = PREFIXES + f"""
        SELECT DISTINCT ?class (SAMPLE(?lbl) AS ?label) WHERE {{
          GRAPH <{graph_iri}> {{
            {{
              ?class a owl:Class .
            }}
            UNION
            {{
              ?child rdfs:subClassOf ?class .
            }}
            UNION
            {{
              ?class rdfs:subClassOf ?parent .
            }}
            OPTIONAL {{ ?class rdfs:label ?lbl }}
          }}
          FILTER(ISIRI(?class))
        }}
        GROUP BY ?class
        LIMIT 300
        """
        res_classes = _exec_select(q_classes)
        classes = res_classes.get("results", {}).get("bindings", [])
        
        if classes:
            schema_lines.append("Classes:")
            for b in classes:
                cls_iri = b["class"]["value"]
                lbl = b.get("label", {}).get("value", "")
                schema_lines.append(f"  - IRI: <{cls_iri}> | Label: \"{lbl}\"")
        else:
            schema_lines.append("Classes: None found")
            
        # 2. Fetch Properties
        q_props = PREFIXES + f"""
        SELECT DISTINCT ?prop ?propType ?label ?domain ?range WHERE {{
          GRAPH <{graph_iri}> {{
            ?prop a ?propType .
            FILTER(?propType IN (rdf:Property, owl:ObjectProperty, owl:DatatypeProperty))
            OPTIONAL {{ ?prop rdfs:label ?label }}
            OPTIONAL {{ ?prop rdfs:domain ?domain }}
            OPTIONAL {{ ?prop rdfs:range ?range }}
          }}
        }}
        LIMIT 300
        """
        res_props = _exec_select(q_props)
        props = res_props.get("results", {}).get("bindings", [])
        
        if props:
            schema_lines.append("Properties:")
            for b in props:
                prop_iri = b["prop"]["value"]
                p_type = b["propType"]["value"].split("#")[-1]
                lbl = b.get("label", {}).get("value", "")
                domain = b.get("domain", {}).get("value", "Any")
                rng = b.get("range", {}).get("value", "Any")
                schema_lines.append(f"  - IRI: <{prop_iri}> ({p_type}) | Label: \"{lbl}\" | Domain: <{domain}> | Range: <{rng}>")
        else:
            schema_lines.append("Properties: None found")
            
        schema_lines.append("") # spacer
        
    return "\n".join(schema_lines), target_graphs
