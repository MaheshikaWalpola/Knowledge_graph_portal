from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
from typing import List, Dict
import urllib.parse
import re

import pandas as pd

from rdflib import Graph, Namespace, Literal
from rdflib.namespace import RDF, XSD

from core.config import settings


@dataclass
class InstanceBuildResult:
    turtle: str
    triples: int


def _safe_seg(s: str) -> str:
    return urllib.parse.quote(str(s), safe="")


def _local_name_from_header(header: str) -> str:
    h = str(header).strip()
    if not h:
        return ""

    # Keep existing CamelCase (e.g., NewSpeed, HeadSpeed) exactly
    alnum = "".join(ch for ch in h if ch.isalnum())
    if any(ch.islower() for ch in alnum) and any(ch.isupper() for ch in alnum):
        return alnum

    # Otherwise normalize (e.g., NEW_SPEED -> NewSpeed)
    cleaned = "".join(ch if ch.isalnum() else " " for ch in h).strip()
    parts = cleaned.split()
    return "".join(p[:1].upper() + p[1:].lower() for p in parts)


def build_instances_from_csvs(
    files: List[bytes],
    filenames: List[str],
    user_key: str,
    schema_id: str,
) -> InstanceBuildResult:
    """
    Assumptions:
    - CSV headers match schema terms (after normalization)
    - Values are numeric (float) when present
    - Each row becomes a CMPProcess + associated value nodes

    Result:
    - Turtle string to be uploaded into the user's instance named graph
    """

    CMPO = Namespace(settings.CMP_NS)
    EX = Namespace(settings.CMP_INSTANCE_NS)

    g = Graph()
    g.bind("cmpo", CMPO)
    g.bind("ex", EX)

    # For uniqueness across uploads:
    user_part = _safe_seg(user_key)
    schema_part = _safe_seg(schema_id)

    total_rows = 0

    for content, fname in zip(files, filenames):
        df = pd.read_csv(BytesIO(content), encoding="utf-8", on_bad_lines="skip")
        if df.empty:
            continue

        file_tag = _safe_seg(fname.rsplit(".", 1)[0])

        for i, row in df.iterrows():
            total_rows += 1

            process_uri = EX[f"process/{user_part}/{schema_part}/{file_tag}/{i}"]
            g.add((process_uri, RDF.type, CMPO.CMPProcess))

            # If a wafer id exists, link wafer (optional)
            if "WAFER_ID" in df.columns and pd.notna(row.get("WAFER_ID")):
                wafer_id = _safe_seg(row.get("WAFER_ID"))
                wafer_uri = EX[f"wafer/{user_part}/{schema_part}/{wafer_id}"]
                g.add((wafer_uri, RDF.type, CMPO.Wafer))
                g.add((process_uri, CMPO.actsOn, wafer_uri))

            # If timestamp exists, store as literal (optional)
            if "TIMESTAMP" in df.columns and pd.notna(row.get("TIMESTAMP")):
                g.add((process_uri, CMPO.hasTimestamp, Literal(str(row.get("TIMESTAMP")), datatype=XSD.string)))

            # For each column header (excluding identifiers), create a value node
            for col in df.columns:
                if col in ("WAFER_ID", "TIMESTAMP"):
                    continue

                val = row.get(col)
                if pd.isna(val):
                    continue

                local = _local_name_from_header(col)
                if not local:
                    continue

                # Schema class assumed to exist: cmpo:<LocalName>
                class_iri = CMPO[local]

                # Create an instance node for this variable measurement
                inst_uri = EX[f"value/{user_part}/{schema_part}/{file_tag}/{i}/{_safe_seg(local)}"]
                g.add((inst_uri, RDF.type, class_iri))

                # Numeric value
                try:
                    fval = float(val)
                    g.add((inst_uri, CMPO.hasNumericValue, Literal(fval, datatype=XSD.float)))
                except Exception:
                    # fallback to string if not numeric
                    g.add((inst_uri, CMPO.hasStringValue, Literal(str(val), datatype=XSD.string)))

                # Link it to the process
                g.add((process_uri, CMPO.hasInputParameter, inst_uri))

    turtle = g.serialize(format="turtle")
    triples = len(g)
    return InstanceBuildResult(turtle=turtle, triples=triples)
