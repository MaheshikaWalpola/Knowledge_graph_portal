"""
Instance Analysis Service

Handles:
- Extracting schema terms from RDF files
- Analyzing CSV headers
- Matching CSV headers to schema terms using AI service
- Generating matching reports
"""

from typing import Dict, List, Any
from io import BytesIO
import pandas as pd
from rdflib import Graph, Namespace
import json

from core.config import settings
from services.llm_matching_service import get_llm_matching_suggestions
from services.local_llm_service import LocalLLMService
from concurrent.futures import ThreadPoolExecutor, as_completed


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
) -> Dict[str, Any]:
    """
    Use AI service to match CSV headers to schema terms.
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

    # Try to use LLM service for intelligent matching
    try:
        print("[INFO] Attempting intelligent matching using LLM service...")
        matched = get_llm_matching_suggestions(data_headers, schema_terms)
        if not matched:
            print("[INFO] LLM matching returned empty results. Falling back to simple heuristic matching...")
            matched = _fallback_simple_matching(data_headers, schema_terms)
            matching_method = "Fallback Heuristics"
        else:
            print(f"[INFO] LLM matching succeeded. Matched {len(matched)} headers.")
    except Exception as e:
        # Fallback to simple string matching if LLM fails
        print(f"[WARNING] LLM matching failed with exception, using fallback: {str(e)}")
        matched = _fallback_simple_matching(data_headers, schema_terms)
        matching_method = "Fallback Heuristics"

    # Find unmatched headers
    matched_headers = set(matched.keys())
    unmatched_data = [h for h in data_headers if h not in matched_headers]

    # Find missing schema terms
    matched_terms = set(matched.values())
    missing_terms = [t for t in schema_terms if t not in matched_terms]

    return {
        "matched_headers": matched,
        "unmatched_data_headers": unmatched_data,
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
    3. Matches them using AI
    4. Returns full analysis report
    """

    try:
        # Step 1: Extract schema terms
        schema_terms = extract_schema_terms(schema_content)

        if not schema_terms:
            raise ValueError(
                "No schema terms found in RDF file. Ensure it contains class definitions."
            )

        # Step 2: Extract CSV headers
        data_headers = extract_csv_headers(csv_files, filenames)

        if not data_headers:
            raise ValueError("No CSV headers found in uploaded files")

        # Step 3: Match headers to schema
        matching_report = match_headers_to_schema(data_headers, schema_terms)

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
        # Step 1: Extract schema terms
        schema_terms = extract_schema_terms(schema_content)
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
        matching_method = "LLM"
        llm_success = False

        yield {"type": "status", "message": "Attempting intelligent matching using AI...", "method": "LLM"}
        print(f"\n--- [MATCHING PROCESS START] data_headers={len(data_headers)} schema_terms={len(schema_terms)} ---")
        print("[INFO] Attempting concurrent AI matching...")

        try:
            # Match each header in parallel using ThreadPoolExecutor
            # The matches will stream to the client as soon as each one finishes!
            with ThreadPoolExecutor(max_workers=5) as executor:
                # Submit all matching tasks
                future_to_header = {
                    executor.submit(get_single_llm_match, header, schema_terms): header
                    for header in data_headers
                }
                
                # As each task completes, yield the matched pair immediately
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
                        
            if not llm_success:
                print("[INFO] LLM matching returned empty results. Falling back to heuristics...")
        except Exception as e:
            print(f"[WARNING] LLM matching failed during stream: {str(e)}. Falling back to heuristics...")

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



