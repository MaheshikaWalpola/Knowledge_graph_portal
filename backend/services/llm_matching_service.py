"""
LLM Matching Suggestions - Extends local_llm_service.py

This module provides functions for matching CSV headers to schema terms using LLM.
Can be imported and used independently or integrated into LocalLLMService.
"""

from typing import Dict, List
from services.local_llm_service import LocalLLMService
import json


def get_llm_matching_suggestions(data_headers: List[str], schema_terms: List[str]) -> Dict[str, str]:
    """
    Use LLM to match CSV data headers to schema terms.
    
    Args:
        data_headers: List of CSV column headers
        schema_terms: List of schema terms to match against
    
    Returns:
        Dictionary mapping matched data headers to schema terms
    """
    if not data_headers or not schema_terms:
        return {}

    try:
        llm_service = LocalLLMService()

        system = (
            "You are a data mapping expert. Your task is to match CSV column headers to ontology terms.\n"
            "Return ONLY a valid JSON object where keys are data headers and values are the best matching schema terms.\n"
            "If no good match exists for a header, omit it from the result.\n"
            "Be intelligent about matching variations of the same term (e.g., 'NewSpeed' matches 'NewSpeed', 'Speed_New', etc.)\n"
            "Examples:\n"
            "  Input: headers=['Speed', 'Temperature'], terms=['NewSpeed', 'Temperature', 'Pressure']\n"
            "  Output: {\"Speed\": \"NewSpeed\", \"Temperature\": \"Temperature\"}\n"
            "IMPORTANT: ONLY output valid JSON. Nothing else."
        )

        user = f"""
        Schema terms: {json.dumps(schema_terms)}
        
        Data headers: {json.dumps(data_headers)}
        
        Please match each data header to the best corresponding schema term.
        Return ONLY the JSON mapping object.
        """

        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": user}
        ]

        ans = llm_service._call_kiste(messages, json_mode=False, temperature=0.1)
        
        # Extract JSON from response (might be wrapped or contain extra text)
        import re
        json_match = re.search(r'\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}', ans, re.DOTALL)
        if json_match:
            try:
                data = json.loads(json_match.group())
                # Ensure all values are schema terms that exist
                filtered = {}
                for header, term in data.items():
                    if term in schema_terms and header in data_headers:
                        filtered[header] = term
                return filtered
            except json.JSONDecodeError:
                pass

        print(f"Warning: Could not parse LLM matching response: {ans[:100]}...")
        return {}

    except Exception as e:
        print(f"LLM matching error (will use fallback): {str(e)}")
        return {}
