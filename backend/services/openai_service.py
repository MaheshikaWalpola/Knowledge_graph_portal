# services/openai_service.py
import os
import re
from openai import OpenAI


def strip_markdown(text: str) -> str:
    if not text:
        return text
    text = re.sub(r"^\s*([-*_]\s*){3,}\s*$", "", text, flags=re.MULTILINE)
    text = re.sub(r"^\s{0,3}#{1,6}\s*", "", text, flags=re.MULTILINE)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return text


class OpenAIService:
    def __init__(self) -> None:
        api_key = os.getenv("OPENAI_API_KEY2")
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY2 is not set in environment.")
        self.client = OpenAI(api_key=api_key)

    def chat_general(self, user_text: str) -> str:
        """
        Normal ChatGPT-style responses. No GraphDB grounding required.
        """
        system = (
            "You are a helpful assistant for a Knowledge Graph Portal. "
            "Return plain text only. Do NOT use Markdown formatting."
        )

        resp = self.client.responses.create(
            model="gpt-4.1-mini",
            input=[
                {"role": "system", "content": system},
                {"role": "user", "content": user_text},
            ],
        )
        return strip_markdown(resp.output_text or "No text returned.")

    def chat_grounded(self, user_text: str, evidence: str) -> str:
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

        resp = self.client.responses.create(
            model="gpt-4.1-mini",
            input=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        )
        return strip_markdown(resp.output_text or "No text returned.")
