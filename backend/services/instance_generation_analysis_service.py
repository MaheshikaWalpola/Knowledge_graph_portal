"""
Instance Generation Analysis Service

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
        }

    # Try to use LLM service for intelligent matching
    try:
        matched = get_llm_matching_suggestions(data_headers, schema_terms)
    except Exception as e:
        # Fallback to simple string matching if LLM fails
        print(f"Warning: LLM matching failed, using fallback: {str(e)}")
        matched = _fallback_simple_matching(data_headers, schema_terms)

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
    3. First letter match + length proximity
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

        # Try first letter + similar length
        if header:
            header_first = header[0].lower()
            for term in schema_terms:
                if term and term[0].lower() == header_first:
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
