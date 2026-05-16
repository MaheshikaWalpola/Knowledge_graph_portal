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


class LocalLLMService:
    def _call_kiste(self, messages: List[Dict[str, str]], json_mode: bool = False) -> str:
        """Call Kiste API (OpenAI-compatible)"""
        if not KISTE_API_KEY:
            return "Error: KISTE_API_KEY environment variable not set."
        
        data = {
            "model": MODEL_NAME,
            "messages": messages,
            "temperature": 0.7,
        }
        if json_mode:
            data["response_format"] = {"type": "json_object"}

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
            
            with urllib.request.urlopen(req, context=ssl_context, timeout=120) as response:
                result = json.loads(response.read().decode("utf-8"))
                return result.get("choices", [{}])[0].get("message", {}).get("content", "")
        except Exception as e:
            print(f"Kiste API error: {e}")
            return f"Error: Could not reach Kiste API. {str(e)}"



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
            "IMPORTANT: The schema context includes the Graph IRI (e.g. '--- Schema Context for Graph: <IRI> ---'). You MUST wrap your WHERE patterns inside a GRAPH <IRI> { ... } block for the corresponding graph.\n"
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
        
        ans = self._call_kiste(messages)
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
        
        ans = self._call_kiste(messages)
        return strip_markdown(ans)

    def analyze_intent_and_clarify(self, user_text: str, history: List[Dict[str, str]] = None) -> Dict[str, Any]:
        """
        Analyzes the user's intent to check if it's clear or requires clarification.
        """
        system = (
            "You are an intent analyzer for a Knowledge Graph Portal. "
            "The user asks questions about ontology schemas, classes, instances, and properties. "
            "Analyze the user's latest query along with any provided history. "
            "IMPORTANT: If the user explicitly mentions a specific entity (e.g. 'Pressure', 'Sensor') or context (e.g. 'in CMP data ontology'), the query IS CLEAR and you MUST set is_clear to true. "
            "ONLY if the query is extremely vague (e.g., 'what are the classes?' with no other context), you may ask a clarifying question and provide 2-4 reasonable 'options'. "
            "Output EXACTLY a JSON object with this schema: "
            "{\"is_clear\": bool, \"clarification_message\": string, \"options\": [string, string], \"entity_term\": string, \"graph_name\": string, \"requires_graphdb\": bool} "
            "If the query is clear, set is_clear to true, clarification_message to \"\", and options to []. "
            "Also, if the query is clear, extract the main entity, class, or instance name the user is asking about into 'entity_term' (e.g. 'Pressure', 'Sensor', etc). "
            "If the user specifies an ontology name or graph context (e.g., 'in CMP data ontology', 'for CMP data'), extract the name ('CMP data') into 'graph_name'. If not specified, set it to \"\". "
            "Set 'requires_graphdb' to TRUE only when the user asks about SPECIFIC classes, entities, instances, or properties inside their uploaded ontology data (e.g. 'What are the subclasses of Pressure in CMP data?', 'List the instances of Sensor'). "
            "Set 'requires_graphdb' to FALSE for: "
            "(1) General conceptual questions answerable from common knowledge: 'What is a KG?', 'What is an ontology?', 'What is RDF?', 'What is SPARQL?', 'What is OWL?', 'What is a triple?'. "
            "(2) Greetings or casual conversation. "
            "IMPORTANT: Questions that name a SPECIFIC entity or ontology (e.g. 'Pressure', 'Velocity', 'CMP data ontology') are ALWAYS requires_graphdb=true. "
            "IMPORTANT: ONLY output valid JSON. Nothing else."
        )

        messages = [{"role": "system", "content": system}]
        if history:
            messages.extend(history)
        else:
            messages.append({"role": "user", "content": user_text})

        ans = self._call_kiste(messages, json_mode=True)
        try:
            return json.loads(ans)
        except json.JSONDecodeError:
            # Fallback if the LLM didn't return valid JSON
            return {"is_clear": True, "clarification_message": "", "options": [], "entity_term": user_text, "graph_name": "", "requires_graphdb": True}
