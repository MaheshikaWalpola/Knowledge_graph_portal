"""
Instance Analysis Service

Handles:
- Extracting schema terms from RDF files
- Extracting schema structure (classes, properties, SOSA patterns)
- Analyzing CSV headers
- Matching CSV headers to schema terms using AI service or skos:altLabel
- Generating matching reports
"""

from typing import Dict, List, Any, Set, Optional
from io import BytesIO
import pandas as pd
from rdflib import Graph, Namespace, URIRef
from rdflib.namespace import RDF, RDFS, OWL, XSD, SKOS
import json

from core.config import settings
from services.llm_matching_service import get_llm_matching_suggestions
from services.local_llm_service import LocalLLMService
from concurrent.futures import ThreadPoolExecutor, as_completed

# Standard W3C namespace URIs used for generic detection
SOSA = Namespace("http://www.w3.org/ns/sosa/")
SSN = Namespace("http://www.w3.org/ns/ssn/")


def _get_local_name(uri: str) -> str:
    """Extract the local name from a URI (after # or last /)."""
    uri_str = str(uri)
    if "#" in uri_str:
        return uri_str.rsplit("#", 1)[-1]
    elif "/" in uri_str:
        return uri_str.rsplit("/", 1)[-1]
    return uri_str


def extract_schema_terms(rdf_content: bytes) -> List[str]:
    """
    Extract all class and property terms from an RDF file.
    Returns a list of term local names.
    """
    try:
        g = Graph()
        g.parse(data=rdf_content, format="turtle")
    except Exception as e:
        raise ValueError(f"Failed to parse RDF file: {str(e)}")

    terms = set()

    # Extract from classes (rdfs:Class instances)
    for s, p, o in g.triples((None, None, None)):
        # Add local names from URIs
        if hasattr(s, "split"):
            local = str(s).split("#")[-1].split("/")[-1]
            if local:
                terms.add(local)

    return sorted(list(terms))


def extract_schema_model(rdf_content: bytes) -> Dict[str, Any]:
    """
    Parse any OWL/RDFS schema and extract its full structure.
    Returns a generic model with no domain-specific assumptions.

    Detects:
    - classes vs properties (using owl:Class, rdfs:Class, owl:*Property, rdf:Property)
    - SOSA observation pattern (subClassOf sosa:Observation)
    - Observable property classes (subClassOf sosa:ObservableProperty)
    - Feature of interest classes (subClassOf sosa:FeatureOfInterest)
    - Platform classes (subClassOf sosa:Platform)
    - skos:altLabel mappings (CSV header -> schema term)
    - Property domains and ranges
    - Primary namespace
    """
    result = {
        "namespace": None,
        "classes": set(),
        "properties": set(),
        "object_properties": set(),
        "datatype_properties": set(),
        "observation_class": None,
        "observable_property_classes": set(),
        "feature_of_interest_classes": set(),
        "platform_classes": set(),
        "altlabel_map": {},
        "property_domains": {},
        "property_ranges": {},
        "class_iris": {},
        "property_iris": {},
    }

    if not rdf_content:
        return result

    try:
        g = Graph()
        try:
            g.parse(data=rdf_content, format="turtle")
        except Exception:
            g.parse(data=rdf_content)
    except Exception as e:
        print(f"[WARNING] Could not parse schema for model extraction: {e}")
        return result

    # --- Extract primary namespace ---
    from services.instance_generation_service import extract_primary_namespace, WELL_KNOWN_NAMESPACES
    ns_str, _ = extract_primary_namespace(rdf_content)
    result["namespace"] = ns_str

    # --- Classify terms: classes vs properties ---
    class_types = {OWL.Class, RDFS.Class}
    property_types = {OWL.ObjectProperty, OWL.DatatypeProperty, RDF.Property}

    for s, p, o in g.triples((None, RDF.type, None)):
        local = _get_local_name(s)
        if not local:
            continue

        if o in class_types:
            result["classes"].add(local)
            result["class_iris"][local] = str(s)
        elif o in property_types:
            result["properties"].add(local)
            result["property_iris"][local] = str(s)
            if o == OWL.ObjectProperty:
                result["object_properties"].add(local)
            elif o == OWL.DatatypeProperty:
                result["datatype_properties"].add(local)

    # --- Walk subClassOf chains to detect SOSA patterns ---
    # Build a parent map: child_uri -> set of parent_uris (transitive)
    direct_parents = {}
    for s, p, o in g.triples((None, RDFS.subClassOf, None)):
        s_str, o_str = str(s), str(o)
        if s_str not in direct_parents:
            direct_parents[s_str] = set()
        direct_parents[s_str].add(o_str)

    def get_all_ancestors(uri: str, visited: set = None) -> set:
        """Get all transitive ancestors via rdfs:subClassOf."""
        if visited is None:
            visited = set()
        if uri in visited:
            return set()
        visited.add(uri)
        ancestors = set()
        for parent in direct_parents.get(uri, set()):
            ancestors.add(parent)
            ancestors |= get_all_ancestors(parent, visited)
        return ancestors

    sosa_observation_uri = str(SOSA.Observation)
    sosa_observable_prop_uri = str(SOSA.ObservableProperty)
    sosa_foi_uri = str(SOSA.FeatureOfInterest)
    sosa_platform_uri = str(SOSA.Platform)

    for local, iri in result["class_iris"].items():
        ancestors = get_all_ancestors(iri)
        if sosa_observation_uri in ancestors:
            # First observation class found becomes the observation class
            if result["observation_class"] is None:
                result["observation_class"] = local
        if sosa_observable_prop_uri in ancestors:
            result["observable_property_classes"].add(local)
        if sosa_foi_uri in ancestors:
            result["feature_of_interest_classes"].add(local)
        if sosa_platform_uri in ancestors:
            result["platform_classes"].add(local)

    # --- Extract skos:altLabel mappings ---
    # Maps altLabel string (e.g., "SLURRY_FLOW_LINE_A") -> schema term local name
    for s, p, o in g.triples((None, SKOS.altLabel, None)):
        label_str = str(o).strip()
        local = _get_local_name(s)
        if label_str and local:
            result["altlabel_map"][label_str] = local

    # --- Extract property domains and ranges ---
    for s, p, o in g.triples((None, RDFS.domain, None)):
        local = _get_local_name(s)
        if local:
            result["property_domains"][local] = _get_local_name(o)

    for s, p, o in g.triples((None, RDFS.range, None)):
        local = _get_local_name(s)
        if local:
            result["property_ranges"][local] = _get_local_name(o)

    # Convert sets to sorted lists for JSON serialization
    for key in ["classes", "properties", "object_properties", "datatype_properties",
                "observable_property_classes", "feature_of_interest_classes", "platform_classes"]:
        result[key] = sorted(result[key])

    print(f"[SCHEMA MODEL] namespace={result['namespace']}")
    print(f"[SCHEMA MODEL] classes={len(result['classes'])}, properties={len(result['properties'])}")
    print(f"[SCHEMA MODEL] observation_class={result['observation_class']}")
    print(f"[SCHEMA MODEL] observable_property_classes={len(result['observable_property_classes'])}")
    print(f"[SCHEMA MODEL] altlabel_map entries={len(result['altlabel_map'])}")

    return result


def extract_altlabel_map(rdf_content: bytes) -> Dict[str, str]:
    """
    Extract skos:altLabel -> local term name mappings from any schema.
    Returns a dict mapping label strings to schema term local names.
    This is a lightweight version of extract_schema_model for matching only.
    """
    if not rdf_content:
        return {}
    try:
        g = Graph()
        try:
            g.parse(data=rdf_content, format="turtle")
        except Exception:
            g.parse(data=rdf_content)

        altlabel_map = {}
        for s, p, o in g.triples((None, SKOS.altLabel, None)):
            label_str = str(o).strip()
            local = _get_local_name(s)
            if label_str and local:
                altlabel_map[label_str] = local
        return altlabel_map
    except Exception as e:
        print(f"[WARNING] Could not extract altLabels: {e}")
        return {}


def extract_csv_headers(csv_files: List[bytes], filenames: List[str]) -> List[str]:
    """
    Extract headers from all CSV files.
    Returns unique headers from all files.
    """
    headers = set()

    for content, filename in zip(csv_files, filenames):
        try:
            df = pd.read_csv(BytesIO(content), encoding="utf-8", nrows=0)
            headers.update(df.columns.tolist())
        except Exception as e:
            raise ValueError(f"Failed to parse CSV file {filename}: {str(e)}")

    return sorted(list(headers))


def match_headers_to_schema(
    data_headers: List[str],
    schema_terms: List[str],
    altlabel_map: Dict[str, str] = None,
) -> Dict[str, Any]:
    """
    Use skos:altLabel (if available), then AI service to match CSV headers to schema terms.
    Returns a dictionary with:
    - matched_headers: {data_header: schema_term}
    - unmatched_data_headers: [headers without matches]
    - missing_schema_terms: [terms without data]
    """

    if not data_headers or not schema_terms:
        return {
            "matched_headers": {},
            "unmatched_data_headers": data_headers,
            "missing_schema_terms": schema_terms,
            "matching_method": "None",
        }

    matched = {}
    matching_method = "LLM"

    # Step 0: Check altlabel_map (exact altLabel matches from schema)
    unmatched_headers = []
    if altlabel_map:
        for header in data_headers:
            header_str = header.strip()
            if header_str in altlabel_map:
                matched[header] = altlabel_map[header_str]
            elif header_str.upper() in altlabel_map:
                matched[header] = altlabel_map[header_str.upper()]
            else:
                unmatched_headers.append(header)
    else:
        unmatched_headers = list(data_headers)

    if len(matched) == len(data_headers):
        matching_method = "skos:altLabel Schema Grounding"
    elif unmatched_headers:
        # Try to use LLM service for intelligent matching on remaining unmatched headers
        try:
            print(f"[INFO] Attempting intelligent matching using LLM service for {len(unmatched_headers)} headers...")
            llm_matched = get_llm_matching_suggestions(unmatched_headers, schema_terms)
            if llm_matched:
                matched.update(llm_matched)
                print(f"[INFO] LLM matching succeeded. Matched {len(llm_matched)} headers.")
                matching_method = "skos:altLabel + LLM" if matched else "LLM"
            else:
                print("[INFO] LLM matching returned empty results. Falling back to simple heuristic matching...")
                fallback_matched = _fallback_simple_matching(unmatched_headers, schema_terms)
                matched.update(fallback_matched)
                matching_method = "skos:altLabel + Fallback Heuristics" if matched else "Fallback Heuristics"
        except Exception as e:
            # Fallback to simple string matching if LLM fails
            print(f"[WARNING] LLM matching failed with exception, using fallback: {str(e)}")
            fallback_matched = _fallback_simple_matching(unmatched_headers, schema_terms)
            matched.update(fallback_matched)
            matching_method = "Fallback Heuristics"

    # Find unmatched headers
    matched_headers = set(matched.keys())
    final_unmatched_data = [h for h in data_headers if h not in matched_headers]

    # Find missing schema terms
    matched_terms = set(matched.values())
    missing_terms = [t for t in schema_terms if t not in matched_terms]

    return {
        "matched_headers": matched,
        "unmatched_data_headers": final_unmatched_data,
        "missing_schema_terms": missing_terms,
        "available_schema_terms": schema_terms,
        "matching_method": matching_method,
    }


def _fallback_simple_matching(
    data_headers: List[str],
    schema_terms: List[str],
) -> Dict[str, str]:
    """
    Simple string matching when LLM is not available.
    Matches based on:
    1. Exact match (case-insensitive)
    2. Contains relationship
    3. First 3 letters match + length proximity
    """
    matched = {}

    for header in data_headers:
        header_lower = header.lower().strip()

        # Try exact match
        for term in schema_terms:
            if term.lower() == header_lower:
                matched[header] = term
                break

        if header in matched:
            continue

        # Try contains relationship
        for term in schema_terms:
            term_lower = term.lower()
            if term_lower in header_lower or header_lower in term_lower:
                matched[header] = term
                break

        if header in matched:
            continue

        # Try first 3 letters + similar length
        if header and len(header) >= 3:
            header_prefix = header[:3].lower()
            for term in schema_terms:
                if term and len(term) >= 3 and term[:3].lower() == header_prefix:
                    len_diff = abs(len(header) - len(term))
                    if len_diff <= 3:  # Similar length
                        matched[header] = term
                        break

    return matched


def analyze_schema_and_data(
    schema_content: bytes,
    csv_files: List[bytes],
    filenames: List[str],
) -> Dict[str, Any]:
    """
    Main analysis function that:
    1. Extracts schema terms from RDF
    2. Extracts headers from CSVs
    3. Matches them using skos:altLabel or AI
    4. Returns full analysis report
    """

    try:
        # Step 1: Extract schema terms & altlabel map
        schema_terms = extract_schema_terms(schema_content)
        altlabel_map = extract_altlabel_map(schema_content)

        if not schema_terms:
            raise ValueError(
                "No schema terms found in RDF file. Ensure it contains class definitions."
            )

        # Step 2: Extract CSV headers
        data_headers = extract_csv_headers(csv_files, filenames)

        if not data_headers:
            raise ValueError("No CSV headers found in uploaded files")

        # Step 3: Match headers to schema
        matching_report = match_headers_to_schema(data_headers, schema_terms, altlabel_map=altlabel_map)

        return {
            "success": True,
            "schema_terms_count": len(schema_terms),
            "data_headers_count": len(data_headers),
            "matched_count": len(matching_report["matched_headers"]),
            "unmatched_count": len(matching_report["unmatched_data_headers"]),
            "missing_count": len(matching_report["missing_schema_terms"]),
            **matching_report,
        }

    except Exception as e:
        raise ValueError(f"Analysis failed: {str(e)}")


def get_single_llm_match(header: str, schema_terms: List[str]):
    """
    Use LLM to match a single CSV header to schema terms.
    Returns the matched term name or None.
    """
    if not header or not schema_terms:
        return None

    try:
        llm_service = LocalLLMService()

        system = (
            "You are a data mapping expert. Your task is to match a single CSV column header to a list of ontology schema terms.\n"
            "Return ONLY the exact matched schema term from the list.\n"
            "If no good match exists in the list, return 'NONE'.\n"
            "Do NOT output any other text, only the matched term or 'NONE'."
        )

        user = f"Schema terms: {json.dumps(schema_terms)}\nCSV Header: '{header}'\nBest matching schema term:"

        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": user}
        ]

        ans = llm_service._call_kiste(messages, json_mode=False, temperature=0.1)
        ans = ans.strip().replace('"', '').replace("'", '').replace("`", "")
        
        # Check if the returned answer matches a schema term
        for term in schema_terms:
            if term.lower() == ans.lower():
                return term

    except Exception as e:
        print(f"LLM match error for header '{header}': {str(e)}")
    return None


def analyze_schema_and_data_stream(
    schema_content: bytes,
    csv_files: List[bytes],
    filenames: List[str],
):
    """
    Generator function that:
    1. Extracts schema terms from RDF
    2. Extracts headers from CSVs
    3. Yields matching updates in real-time, matching concurrently using AI
    """
    try:
        # Step 1: Extract schema terms and altlabels
        schema_terms = extract_schema_terms(schema_content)
        altlabel_map = extract_altlabel_map(schema_content)
        if not schema_terms:
            yield {"type": "error", "message": "No schema terms found in RDF file. Ensure it contains class definitions."}
            return

        # Step 2: Extract CSV headers
        data_headers = extract_csv_headers(csv_files, filenames)
        if not data_headers:
            yield {"type": "error", "message": "No CSV headers found in uploaded files."}
            return

        # Yield initial info
        yield {
            "type": "init",
            "schema_terms": schema_terms,
            "schema_terms_count": len(schema_terms),
            "data_headers_count": len(data_headers)
        }

        # Step 3: Progressive Match
        matched = {}
        matching_method = "skos:altLabel Schema Grounding"
        llm_success = False

        # 3a. Check altlabel_map first
        unmatched_headers = []
        if altlabel_map:
            for header in data_headers:
                h_str = header.strip()
                term = altlabel_map.get(h_str) or altlabel_map.get(h_str.upper())
                if term:
                    matched[header] = term
                    print(f"[MATCH - skos:altLabel] CSV Header '{header}' -> Schema Term '{term}'")
                    yield {"type": "match", "header": header, "term": term, "method": "skos:altLabel"}
                else:
                    unmatched_headers.append(header)
        else:
            unmatched_headers = list(data_headers)

        if unmatched_headers:
            yield {"type": "status", "message": f"Matching remaining {len(unmatched_headers)} headers using AI...", "method": "LLM"}
            print(f"\n--- [MATCHING PROCESS START] remaining_headers={len(unmatched_headers)} schema_terms={len(schema_terms)} ---")
            print("[INFO] Attempting concurrent AI matching...")

            try:
                with ThreadPoolExecutor(max_workers=5) as executor:
                    future_to_header = {
                        executor.submit(get_single_llm_match, header, schema_terms): header
                        for header in unmatched_headers
                    }
                    for future in as_completed(future_to_header):
                        header = future_to_header[future]
                        try:
                            term = future.result()
                            if term:
                                matched[header] = term
                                llm_success = True
                                print(f"[MATCH - AI/LLM] CSV Header '{header}' -> Schema Term '{term}'")
                                yield {"type": "match", "header": header, "term": term, "method": "LLM"}
                        except Exception as e:
                            print(f"[WARNING] LLM match failed for header '{header}': {str(e)}")
            except Exception as e:
                print(f"[WARNING] LLM matching failed during stream: {str(e)}. Falling back to heuristics...")
                        
            if not llm_success:
                print("[INFO] LLM matching returned empty results. Falling back to heuristics...")

        # Fallback to heuristics if LLM is not viable (didn't make any matches or crashed)
        if not llm_success:
            matching_method = "Fallback Heuristics"
            yield {"type": "status", "message": "AI matching not viable. Falling back to quick heuristic matching...", "method": "Fallback Heuristics"}
            print("[INFO] Running heuristic fallback matching...")

            for header in data_headers:
                header_lower = header.lower().strip()
                found = False

                # 1. Exact match (case-insensitive)
                for term in schema_terms:
                    if term.lower() == header_lower:
                        matched[header] = term
                        print(f"[MATCH - Heuristics (Exact)] CSV Header '{header}' -> Schema Term '{term}'")
                        yield {"type": "match", "header": header, "term": term, "method": "Fallback Heuristics"}
                        found = True
                        break
                if found:
                    continue

                # 2. Contains relationship
                for term in schema_terms:
                    term_lower = term.lower()
                    if term_lower in header_lower or header_lower in term_lower:
                        matched[header] = term
                        print(f"[MATCH - Heuristics (Contains)] CSV Header '{header}' -> Schema Term '{term}'")
                        yield {"type": "match", "header": header, "term": term, "method": "Fallback Heuristics"}
                        found = True
                        break
                if found:
                    continue

                # 3. Prefix matching
                if header and len(header) >= 3:
                    header_prefix = header[:3].lower()
                    for term in schema_terms:
                        if term and len(term) >= 3 and term[:3].lower() == header_prefix:
                            len_diff = abs(len(header) - len(term))
                            if len_diff <= 3:  # Similar length
                                matched[header] = term
                                print(f"[MATCH - Heuristics (Prefix)] CSV Header '{header}' -> Schema Term '{term}'")
                                yield {"type": "match", "header": header, "term": term, "method": "Fallback Heuristics"}
                                found = True
                                break

        # Yield unmatched headers
        final_unmatched = []
        for header in data_headers:
            if header not in matched:
                final_unmatched.append(header)
                print(f"[UNMATCHED] CSV Header '{header}' could not be matched")
                yield {"type": "unmatched", "header": header}

        # Calculate missing schema terms
        matched_terms = set(matched.values())
        missing_terms = [t for t in schema_terms if t not in matched_terms]

        heuristic_count = len(matched) if not llm_success else 0
        llm_count = len(matched) if llm_success else 0
        print(f"--- [MATCHING PROCESS DONE] Total={len(data_headers)} Heuristics={heuristic_count} AI/LLM={llm_count} Unmatched={len(final_unmatched)} ---\n")

        # Send final done message
        yield {
            "type": "done",
            "matched_headers": matched,
            "unmatched_data_headers": final_unmatched,
            "missing_schema_terms": missing_terms,
            "matching_method": matching_method,
            "success": True
        }

    except Exception as e:
        yield {"type": "error", "message": f"Analysis failed: {str(e)}"}



