import json
import urllib.request
import re
from typing import List, Dict, Any, Optional

OLLAMA_API_URL = "http://localhost:11434/api/chat"
MODEL_NAME = "llama3.2:latest"


def strip_markdown(text: str) -> str:
    if not text:
        return text
    text = re.sub(r"^\s*([-*_]\s*){3,}\s*$", "", text, flags=re.MULTILINE)
    text = re.sub(r"^\s{0,3}#{1,6}\s*", "", text, flags=re.MULTILINE)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return text


class LocalLLMService:
    def _call_ollama(self, messages: List[Dict[str, str]], json_mode: bool = False) -> str:
        data = {
            "model": MODEL_NAME,
            "messages": messages,
            "stream": False
        }
        if json_mode:
            data["format"] = "json"

        req = urllib.request.Request(
            OLLAMA_API_URL,
            data=json.dumps(data).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req) as response:
                result = json.loads(response.read().decode("utf-8"))
                return result.get("message", {}).get("content", "")
        except Exception as e:
            print(f"Ollama API error: {e}")
            return "Error: Could not reach local LLM."

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

        ans = self._call_ollama(messages)
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

        ans = self._call_ollama(messages)
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
            "Set 'requires_graphdb' to true if the user is asking about domain knowledge, ontology, classes, instances, or properties. Set it to false ONLY if it's a pure greeting or general chat."
            "IMPORTANT: ONLY output valid JSON. Nothing else."
        )

        messages = [{"role": "system", "content": system}]
        if history:
            messages.extend(history)
        else:
            messages.append({"role": "user", "content": user_text})

        ans = self._call_ollama(messages, json_mode=True)
        try:
            return json.loads(ans)
        except json.JSONDecodeError:
            # Fallback if the LLM didn't return valid JSON
            return {"is_clear": True, "clarification_message": "", "options": [], "entity_term": user_text, "graph_name": "", "requires_graphdb": True}
