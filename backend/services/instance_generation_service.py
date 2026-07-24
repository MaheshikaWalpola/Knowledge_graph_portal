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
    rows_processed: int


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


def _infer_unit(header: str) -> str:
    """Infer unit from column header string matching Instances_v2.ttl units."""
    h = header.lower()
    if "pressure" in h:
        if "kpa" in h:
            return "kPa"
        return "psi"
    if "rotation" in h or "speed" in h:
        return "rpm"
    if "rate" in h or "flow" in h:
        if "ml/min" in h or "flow" in h:
            return "ml/min"
        return "nm/min"
    if "status" in h:
        return "status"
    if "velocity" in h:
        return "m/s"
    if "usage" in h or "lifetime" in h or "minutes" in h:
        if "wafer" in h or "count" in h:
            return "count"
        return "min"
    if "temperature" in h:
        return "degC"
    if "humidity" in h or "percent" in h or "concentration" in h or "content" in h:
        return "%"
    if "force" in h or "downforce" in h:
        return "N"
    if "sweep" in h or "spm" in h:
        return "spm"
    if "ionic" in h or "mm" in h:
        return "mM"
    if "particle" in h or "size" in h or "amount" in h or "nm" in h:
        return "nm"
    if "ratio" in h:
        return "ratio"
    if "ph" in h:
        return "pH"
    if "viscosity" in h or "cp" in h:
        return "cP"
    if "mv" in h:
        return "mV"
    return ""


DEFAULT_CMPO_NS = "https://tucid/cpmo/"
DEFAULT_INST_NS = "https://tucid/cpmo/instance/"

WELL_KNOWN_NAMESPACES = {
    "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
    "http://www.w3.org/2000/01/rdf-schema#",
    "http://www.w3.org/2002/07/owl#",
    "http://www.w3.org/2001/XMLSchema#",
    "http://www.w3.org/ns/shacl#",
    "http://www.w3.org/2004/02/skos/core#",
    "http://purl.org/dc/elements/1.1/",
    "http://purl.org/dc/terms/",
}


def extract_primary_namespace(schema_bytes: bytes) -> tuple[str, str]:
    """
    Parse schema RDF, find the primary domain ontology namespace from subject & object URIs.
    Returns (ontology_ns, instance_ns).
    """
    if not schema_bytes:
        return DEFAULT_CMPO_NS, DEFAULT_INST_NS

    try:
        g = Graph()
        try:
            g.parse(data=schema_bytes, format="turtle")
        except Exception:
            g.parse(data=schema_bytes)

        ns_counter = {}
        for s, p, o in g:
            for term in (s, o):
                if hasattr(term, "startswith") and str(term).startswith("http"):
                    uri = str(term)
                    if "#" in uri:
                        ns = uri.rsplit("#", 1)[0] + "#"
                    elif "/" in uri:
                        ns = uri.rsplit("/", 1)[0] + "/"
                    else:
                        continue
                    if ns not in WELL_KNOWN_NAMESPACES:
                        ns_counter[ns] = ns_counter.get(ns, 0) + 1

        if not ns_counter:
            return DEFAULT_CMPO_NS, DEFAULT_INST_NS

        primary_ns = max(ns_counter, key=ns_counter.get)

        if primary_ns.endswith("#"):
            base = primary_ns.rstrip("#")
            instance_ns = base + "/instance/"
        else:
            instance_ns = primary_ns.rstrip("/") + "/instance/"

        return primary_ns, instance_ns
    except Exception as e:
        print(f"[WARNING] Could not extract namespace from schema: {e}")
        return DEFAULT_CMPO_NS, DEFAULT_INST_NS


def build_instances_from_csvs(
    files: List[bytes],
    filenames: List[str],
    user_key: str,
    schema_id: str,
    mappings: Dict[str, str] = None,
    schema_bytes: bytes = None,
) -> InstanceBuildResult:
    """
    Generate RDF instance file from CSVs matching the style of Instances_v2.ttl.
    Dynamically extracts ontology and instance namespaces from schema_bytes if provided.
    """

    if schema_bytes:
        cmpo_ns_str, inst_ns_str = extract_primary_namespace(schema_bytes)
    else:
        cmpo_ns_str, inst_ns_str = DEFAULT_CMPO_NS, DEFAULT_INST_NS

    CMPO = Namespace(cmpo_ns_str)
    INST = Namespace(inst_ns_str)

    g = Graph()
    g.bind("cmpo", CMPO)
    g.bind("inst", INST)
    g.bind("xsd", XSD)

    total_rows = 0

    for content, fname in zip(files, filenames):
        df = pd.read_csv(BytesIO(content), encoding="utf-8", on_bad_lines="skip")
        if df.empty:
            continue

        # Find critical columns dynamically (case-insensitive)
        wafer_col = None
        stage_col = None
        time_col = None

        for col in df.columns:
            col_lower = col.lower()
            if "wafer" in col_lower:
                wafer_col = col
            elif "stage" in col_lower:
                stage_col = col
            elif "timestamp" in col_lower or "time" in col_lower:
                if time_col is None or len(col_lower) < len(time_col.lower()):
                    time_col = col

        for i, row in df.iterrows():
            total_rows += 1

            # Extract wafer_id
            wafer_id = "0000000000"
            if wafer_col:
                w_val = row.get(wafer_col)
                if pd.notna(w_val):
                    try:
                        wafer_id = str(int(float(w_val)))
                    except Exception:
                        wafer_id = str(w_val).strip()

            # Extract stage
            stage = "A"
            if stage_col:
                s_val = row.get(stage_col)
                if pd.notna(s_val):
                    stage = str(s_val).strip()

            # Extract timestamp
            timestamp_val = 0.0
            if time_col:
                t_val = row.get(time_col)
                if pd.notna(t_val):
                    try:
                        timestamp_val = float(t_val)
                    except Exception:
                        pass

            # Format run_id padded to 5 digits
            run_id = f"{i:05d}"

            # Create process/run URI
            run_uri = INST[f"cmp_run_{wafer_id}_{stage}_{run_id}"]
            g.add((run_uri, RDF.type, CMPO.Measurement))
            if time_col:
                g.add((run_uri, CMPO.atTime, Literal(timestamp_val, datatype=XSD.float)))
            if wafer_col:
                wafer_uri = INST[f"wafer_{wafer_id}"]
                g.add((wafer_uri, RDF.type, CMPO.Wafer))
                g.add((run_uri, CMPO.hasInput, wafer_uri))

            # Add parameters for columns
            for col in df.columns:
                if col in (wafer_col, stage_col, time_col):
                    continue

                val = row.get(col)
                if pd.isna(val):
                    continue

                if mappings and col in mappings:
                    local = mappings[col]
                else:
                    local = _local_name_from_header(col)
                if not local:
                    continue

                param_uri = INST[f"parameter_{wafer_id}_{stage}_{run_id}_{col}"]

                # Set type to the mapped schema class
                g.add((param_uri, RDF.type, CMPO[local]))

                if time_col:
                    g.add((param_uri, CMPO.atTime, Literal(timestamp_val, datatype=XSD.float)))

                g.add((param_uri, CMPO.hasParameterName, Literal(col, datatype=XSD.string)))
                g.add((param_uri, CMPO.hasStage, Literal(stage)))

                unit = _infer_unit(col)
                if unit:
                    g.add((param_uri, CMPO.hasUnit, Literal(unit, datatype=XSD.string)))

                try:
                    fval = float(val)
                    g.add((param_uri, CMPO.hasNumericValue, Literal(fval, datatype=XSD.float)))
                except Exception:
                    g.add((param_uri, CMPO.hasValue, Literal(str(val))))

                # Link parameter to run
                g.add((param_uri, CMPO.isMeasurementOf, run_uri))
                g.add((run_uri, CMPO.hasMeasurement, param_uri))

    turtle = g.serialize(format="turtle")
    triples = len(g)
    return InstanceBuildResult(turtle=turtle, triples=triples, rows_processed=total_rows)
