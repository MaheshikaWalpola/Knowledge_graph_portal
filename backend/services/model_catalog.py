"""
The AI model catalog: backend/models.yaml (every model the portal knows, and which ones are in the study)
merged with the live Kiste model list (GET <KISTE_BASE_URL>/v1/models, read once at startup) and the cloud
providers whose API keys are set. GET /validation/models serves the merged list; the dropdown shows it.

Each merged entry:
  id              the id as the API lists it (from models.yaml)
  model           the value to send in the `model` form field: the bare id for Kiste, "provider/id" for the cloud
  label, provider, provider_label, host, include_in_study, description, context_window, tag   from models.yaml
  available       Kiste: the live list contains the id (None when the live list could not be read);
                  cloud: the provider's API key is set
  in_catalog      False for a model the Kiste server lists but models.yaml does not (shown with its raw id);
                  ids under `exclude` in models.yaml (speech, embedding, converter models) are left out entirely
"""
import json
import logging
import os
import ssl
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional

import yaml

from services.llm_providers import PROVIDERS

logger = logging.getLogger("uvicorn.error")

CATALOG_PATH = Path(__file__).resolve().parent.parent / "models.yaml"
PROVIDER_LABELS = {"kiste": "Kiste", "anthropic": "Claude", "openai": "OpenAI"}
REQUIRED_KEYS = ("id", "label", "provider", "host", "include_in_study")

# id -> entry of the live Kiste list; None until read, and None again when the read failed
_kiste_live: Optional[Dict[str, Dict[str, Any]]] = None


def kiste_base_url() -> str:
    """KISTE_BASE_URL, or the host part of KISTE_API_URL (which is the full /v1/chat/completions URL)."""
    base = os.getenv("KISTE_BASE_URL", "").strip()
    if not base:
        api_url = os.getenv("KISTE_API_URL", "").strip()
        base = api_url.split("/v1/")[0] if "/v1/" in api_url else api_url
    return base.rstrip("/")


def fetch_kiste_models(timeout: float = 10) -> List[Dict[str, Any]]:
    """GET <base>/v1/models (OpenAI format: {"data": [{"id": ..., "max_model_len": ...}, ...]})."""
    base = kiste_base_url()
    if not base:
        raise RuntimeError("KISTE_BASE_URL / KISTE_API_URL is not set")
    req = urllib.request.Request(f"{base}/v1/models", headers={"Authorization": f"Bearer {os.getenv('KISTE_API_KEY', '')}"})
    ctx = ssl.create_default_context()
    ctx.check_hostname = False  # same as the chat call: the Kiste certificate is not in the default store
    ctx.verify_mode = ssl.CERT_NONE
    with urllib.request.urlopen(req, context=ctx, timeout=timeout) as response:
        payload = json.loads(response.read().decode("utf-8"))
    items = payload.get("data", payload) if isinstance(payload, dict) else payload
    return [m for m in items if isinstance(m, dict) and m.get("id")]


def refresh_kiste_models() -> Optional[List[str]]:
    """Read the live Kiste list into the cache and print it. Returns the ids, or None when the read failed."""
    global _kiste_live
    try:
        models = fetch_kiste_models()
    except Exception as e:
        _kiste_live = None
        logger.warning("Kiste model list could not be read from %s/v1/models (%s); offering the catalog as is", kiste_base_url(), e)
        return None
    _kiste_live = {m["id"]: m for m in models}
    ids = sorted(_kiste_live)
    logger.info("Kiste models (%d): %s", len(ids), ", ".join(ids))
    missing = [e["id"] for e in load_catalog() if e["provider"] == "kiste" and e["id"] not in _kiste_live]
    if missing:
        logger.warning("models.yaml lists Kiste models the server does not offer right now: %s", ", ".join(missing))
    return ids


def kiste_live_models() -> Optional[Dict[str, Dict[str, Any]]]:
    return _kiste_live


def _read_yaml(path: Path) -> Dict[str, Any]:
    with open(path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    return data if isinstance(data, dict) else {"models": data}


def load_exclusions(path: Path = CATALOG_PATH) -> Dict[str, str]:
    """Server models that can never chat (speech, embeddings, converters): id -> reason. Never offered."""
    return {e["id"]: e.get("reason", "") for e in _read_yaml(path).get("exclude") or [] if isinstance(e, dict) and e.get("id")}


def load_catalog(path: Path = CATALOG_PATH) -> List[Dict[str, Any]]:
    """The entries of models.yaml, validated."""
    data = _read_yaml(path)
    entries = data.get("models")
    if not isinstance(entries, list):
        raise ValueError(f"{path}: expected a top-level 'models' list")
    seen = set()
    for e in entries:
        missing = [k for k in REQUIRED_KEYS if k not in e]
        if missing:
            raise ValueError(f"{path}: model {e.get('id')!r} lacks {', '.join(missing)}")
        if e["provider"] not in PROVIDER_LABELS:
            raise ValueError(f"{path}: model {e['id']!r} has unknown provider {e['provider']!r}")
        if e["id"] in seen:
            raise ValueError(f"{path}: duplicate model id {e['id']!r}")
        seen.add(e["id"])
    return entries


def model_value(provider: str, model_id: str) -> str:
    """What the frontend sends as `model`: bare id for Kiste, provider/id for the cloud (see llm_providers.split_model)."""
    return model_id if provider == "kiste" else f"{provider}/{model_id}"


def format_context(tokens: Any) -> Optional[str]:
    """131072 -> "131K", 1048576 -> "1M"."""
    try:
        n = int(tokens)
    except (TypeError, ValueError):
        return None
    if n >= 1_000_000:
        return f"{n / 1_000_000:.0f}M" if n % 1_000_000 < 100_000 else f"{n / 1_000_000:.1f}M"
    return f"{n // 1000}K"


def _cloud_key_set(provider: str) -> bool:
    spec = next((p for p in PROVIDERS if p["id"] == provider), None)
    return bool(spec and os.getenv(spec["key_env"], "").strip())


def list_models(live: Optional[Dict[str, Dict[str, Any]]] = None, catalog: Optional[List[Dict[str, Any]]] = None) -> List[Dict[str, Any]]:
    """The merged list (see the module docstring). `live` defaults to the cached Kiste list."""
    live = kiste_live_models() if live is None else live
    rows = []
    for e in (catalog if catalog is not None else load_catalog()):
        provider = e["provider"]
        row = {
            "id": e["id"],
            "model": model_value(provider, e["id"]),
            "label": e["label"],
            "provider": provider,
            "provider_label": PROVIDER_LABELS[provider],
            "host": e["host"],
            "include_in_study": bool(e["include_in_study"]),
            "description": e.get("description") or "",
            "context_window": e.get("context_window") or "",
            "tag": e.get("tag"),
            "in_catalog": True,
        }
        if provider == "kiste":
            row["available"] = (e["id"] in live) if live is not None else None
            if live is not None and e["id"] in live:
                row["context_window"] = format_context(live[e["id"]].get("max_model_len")) or row["context_window"]
        else:
            row["available"] = _cloud_key_set(provider)
        rows.append(row)

    known = {r["id"] for r in rows}
    excluded = load_exclusions() if catalog is None else {}
    for model_id, entry in sorted((live or {}).items()):
        if model_id not in known and model_id not in excluded:
            rows.append({
                "id": model_id, "model": model_id, "label": model_id, "provider": "kiste", "provider_label": "Kiste",
                "host": "kiste", "include_in_study": False, "description": "",
                "context_window": format_context(entry.get("max_model_len")) or "", "tag": None,
                "in_catalog": False, "available": True,
            })
    return rows


def study_models() -> List[Dict[str, Any]]:
    """The nine models of the study (include_in_study: true), whatever their availability right now."""
    return [r for r in list_models() if r["include_in_study"]]
