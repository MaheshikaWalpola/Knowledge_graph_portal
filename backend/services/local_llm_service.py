import json
import urllib.request
import re
import os
import ssl
from typing import List, Dict, Any, Optional

# Kiste API Configuration (OpenAI-compatible)
KISTE_API_URL = os.getenv("KISTE_API_URL")
KISTE_API_KEY = os.getenv("KISTE_API_KEY")
MODEL_NAME = os.getenv("KISTE_MODEL")  # "gpt-oss-120b" or "qwen3.6"


def strip_markdown(text: str) -> str:
    if not text:
        return text
    text = re.sub(r"^\s*([-*_]\s*){3,}\s*$", "", text, flags=re.MULTILINE)
    text = re.sub(r"^\s{0,3}#{1,6}\s*", "", text, flags=re.MULTILINE)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return text


class KisteConnectionError(Exception):
    """Raised when the Kiste LLM API cannot be reached or fails to respond."""
    pass


class LocalLLMService:
    def _call_kiste(self, messages: List[Dict[str, str]], json_mode: bool = False, temperature: float = 0.7, model_override: str = None,
                    timeout: int = 120, max_tokens: Optional[int] = None) -> str:
        """Call Kiste API (OpenAI-compatible). Use model_override to dynamically select a different model."""
        if not KISTE_API_KEY:
            raise KisteConnectionError("We are experiencing connection issues with the AI server. Please try again shortly.")
        
        effective_model = model_override or MODEL_NAME
        data = {
            "model": effective_model,
            "messages": messages,
            "temperature": temperature,
        }
        if json_mode:
            data["response_format"] = {"type": "json_object"}
        if max_tokens:
            data["max_tokens"] = max_tokens

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {KISTE_API_KEY}"
        }
        
        req = urllib.request.Request(
            KISTE_API_URL,
            data=json.dumps(data).encode("utf-8"),
            headers=headers,
        )
        try:
            # Create SSL context that doesn't verify certificates (for development)
            ssl_context = ssl.create_default_context()
            ssl_context.check_hostname = False
            ssl_context.verify_mode = ssl.CERT_NONE
            
            with urllib.request.urlopen(req, context=ssl_context, timeout=timeout) as response:
                result = json.loads(response.read().decode("utf-8"))
                return result.get("choices", [{}])[0].get("message", {}).get("content", "")
        except Exception as e:
            print(f"Kiste API error (model={effective_model}): {e}")
            raise KisteConnectionError("We are experiencing connection issues with the AI server. Please try again shortly.") from e




    def chat_general(self, user_text: str, history: List[Dict[str, str]] = None) -> str:
        """
        Normal responses. No GraphDB grounding required.
        """
        system = (
            "You are a helpful assistant for a Knowledge Graph Portal. "
            "Return plain text only. Do NOT use Markdown formatting."
        )
        messages = [{"role": "system", "content": system}]
        if history:
            messages.extend(history)
        else:
            messages.append({"role": "user", "content": user_text})

        ans = self._call_kiste(messages)
        return strip_markdown(ans)

    def chat_grounded(self, user_text: str, evidence: str, history: List[Dict[str, str]] = None) -> str:
        """
        Grounded responses: MUST use base-graph evidence only.
        """
        system = (
            "You are an assistant for a Knowledge Graph Portal.\n"
            "Answer using ONLY the provided EVIDENCE from the base graphs.\n"
            "If the evidence is insufficient, say: "
            "'I cannot answer from the base graphs with the current evidence.'\n"
            "Return plain text only. Do NOT use Markdown formatting.\n"
        )
        user = f"QUESTION:\n{user_text}\n\nEVIDENCE:\n{evidence or '(none)'}"

        messages = [{"role": "system", "content": system}]
        if history:
            # Include history but replace the last message content with evidence
            messages.extend(history[:-1])
            messages.append({"role": "user", "content": user})
        else:
            messages.append({"role": "user", "content": user})

        ans = self._call_kiste(messages)
        return strip_markdown(ans)

    def generate_sparql(self, user_text: str, schema_context: str) -> str:
        """
        Generates a valid SPARQL SELECT query based on the user's question and the provided schema.
        """
        system = (
            "You are a SPARQL query generator for a Knowledge Graph Portal.\n"
            "You must generate ONLY a valid SPARQL SELECT query. Do not include markdown code blocks, do not include any explanations.\n"
            "WARNING: You are ONLY allowed to generate SELECT queries. DO NOT use INSERT, DELETE, DROP, CLEAR, LOAD, CREATE, MOVE, COPY, ADD.\n"
            "IMPORTANT: The schema context includes the Graph IRI (e.g. '--- Schema Context for Graph: <IRI> ---'). You MUST wrap your WHERE patterns inside a GRAPH <IRI> { ... } block for the corresponding graph. Reject queries that use a different graph.\n"
            "CRITICAL: Do NOT hardcode full IRIs (e.g. <https://...>) for classes or properties unless you are absolutely certain of them from the schema context. Instead, use variables and robust string matching. "
            "For example, if the user asks for subclasses of 'Velocity', do THIS:\n"
            "  ?subclass rdfs:subClassOf ?parent .\n"
            "  FILTER(CONTAINS(LCASE(STR(?parent)), 'velocity'))\n"
            "If the user asks for 'instances of X', do THIS:\n"
            "  ?s rdf:type ?type .\n"
            "  FILTER(CONTAINS(LCASE(STR(?type)), 'x'))\n"
            "Ensure you use PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#> and PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> if needed.\n"
            "ALWAYS include a LIMIT (e.g. LIMIT 100).\n"
            "\nSCHEMA CONTEXT:\n"
            f"{schema_context}"
        )
        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": user_text}
        ]
        
        ans = self._call_kiste(messages, temperature=0.1)
        # Strip markdown if the LLM still wrapped it
        ans = re.sub(r"^```[a-zA-Z]*\n", "", ans)
        ans = re.sub(r"```$", "", ans.strip())
        return ans.strip()

    def answer_from_sparql_results(self, user_text: str, results: str, history: List[Dict[str, str]] = None) -> str:
        """
        Takes raw JSON/Dictionary results from GraphDB and formulates a natural language answer.
        """
        system = (
            "You are a helpful Knowledge Graph assistant.\n"
            "You are provided with the raw JSON-like results of a SPARQL query that was executed to answer the user's question.\n"
            "Formulate a clear, concise, natural language response based ONLY on these results.\n"
            "If the results are empty or say 'None found', explicitly state that the information was not found in the graph.\n"
            "Return plain text only. Do NOT use Markdown formatting."
        )
        user = f"QUESTION:\n{user_text}\n\nQUERY RESULTS:\n{results}"
        
        messages = [{"role": "system", "content": system}]
        if history:
            messages.extend(history[:-1])
        messages.append({"role": "user", "content": user})
        
        ans = self._call_kiste(messages, temperature=0.2)
        return strip_markdown(ans)

    def analyze_intent_and_clarify(self, user_text: str, history: List[Dict[str, str]] = None) -> Dict[str, Any]:
        """
        Analyzes the user's intent to extract structured semantic meaning.
        """
        system = (
            "You are an intent analyzer for a Knowledge Graph Portal. "
            "Analyze the user's latest query along with any provided history. "
            "Output EXACTLY a JSON object with this schema:\n"
            "{\n"
            "  \"requires_graphdb\": boolean,\n"
            "  \"ontology_name\": string,\n"
            "  \"data_scope\": string,\n"
            "  \"intent\": string,\n"
            "  \"stat\": string,\n"
            "  \"entity\": string,\n"
            "  \"property\": string,\n"
            "  \"needs_clarification\": boolean,\n"
            "  \"clarification_message\": string\n"
            "}\n\n"
            "Guidelines:\n"
            "- 'requires_graphdb' is TRUE unless the question is purely conceptual (e.g., 'What is a KG?').\n"
            "- 'ontology_name' is extracted if the user mentions 'in CMP data', 'for XYZ ontology', etc.\n"
            "- 'data_scope' MUST be 'instances' if asking for instance values, stats, or individuals. Otherwise 'schema'.\n"
            "- 'intent' MUST be one of: 'get_all_classes', 'get_subclasses', 'get_superclasses', 'get_properties', 'get_object_properties', 'get_datatype_properties', 'get_instances', 'get_domain_range', 'get_numeric_stat', or 'complex_query'.\n"
            "- If the query asks for 'maximum value of X', 'max value of X', 'minimum value of X', 'average value of X', 'mean value of X', 'count of X', 'numeric stats of X', or to 'plot', 'graph', 'chart', 'visualize' X, then intent MUST be 'get_numeric_stat'.\n"
            "- 'stat' MUST be one of: 'max', 'min', 'avg', 'count', 'plot', 'all' if intent is 'get_numeric_stat'. Otherwise empty string. Use 'plot' if they ask for a graph/chart/visualization.\n"
            "- 'entity' is the main class or instance asked about (e.g. 'Velocity', 'Head speed', 'Pressure').\n"
            "- 'property' is a specific property if requested.\n"
            "- 'needs_clarification' is TRUE only if the request is highly ambiguous.\n"
            "- 'clarification_message' explains what is needed if needs_clarification is true.\n"
            "IMPORTANT: ONLY output valid JSON. Nothing else."
        )

        messages = [{"role": "system", "content": system}]
        if history:
            messages.extend(history)
        else:
            messages.append({"role": "user", "content": user_text})

        ans = self._call_kiste(messages, json_mode=True, temperature=0.1)
        try:
            return json.loads(ans)
        except json.JSONDecodeError:
            # Fallback if the LLM didn't return valid JSON
            return {
                "requires_graphdb": True,
                "ontology_name": "",
                "data_scope": "schema",
                "intent": "complex_query",
                "stat": "",
                "entity": user_text,
                "property": "",
                "needs_clarification": False,
                "clarification_message": ""
            }
