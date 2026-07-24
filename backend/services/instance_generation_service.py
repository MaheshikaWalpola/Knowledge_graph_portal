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


DEFAULT_CMPO_NS = "https://tucid/cmpo/"
DEFAULT_INST_NS = "https://tucid/cmpo/instance/"

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


from datetime import datetime, timezone

def _format_iso_timestamp(timestamp_val: float | int) -> str:
    """Convert raw epoch or numeric timestamp to ISO 8601 xsd:dateTime string."""
    try:
        ts = float(timestamp_val)
        # If epoch seconds (> 100,000,000)
        if ts > 100000000:
            dt = datetime.fromtimestamp(ts, tz=timezone.utc)
            return dt.strftime("%Y-%m-%dT%H:%M:%SZ")
        # Relative timestamp: offset from epoch 2026-01-01T00:00:00Z
        base_epoch = 1767225600
        dt = datetime.fromtimestamp(base_epoch + ts, tz=timezone.utc)
        return dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    except Exception:
        return "2026-01-01T00:00:00Z"


def build_instances_from_csvs(
    files: List[bytes],
    filenames: List[str],
    user_key: str,
    schema_id: str,
    mappings: Dict[str, str] = None,
    schema_bytes: bytes = None,
) -> InstanceBuildResult:
    """
    Generate RDF instance file from CSVs according to the structure of the uploaded schema.
    Applies the 5 core quality fixes:
    1. Only classes inheriting from ObservableProperty/CMPParameter become sosa:observedProperty targets. Entity classes & properties are created/attached directly.
    2. Exactly one sosa:hasSimpleResult (xsd:float) per observation; empty/non-numeric cells create no observation.
    3. Every observation receives cmpo:rawTimestamp (numeric) and sosa:resultTime (xsd:dateTime).
    4. PolishingStep nodes are fully populated with stageLabel and entity links.
    5. Wafer, Machine, and Step nodes are deduplicated across all uploaded files.
    """
    from services.instance_analysis_service import extract_schema_model

    schema_model = extract_schema_model(schema_bytes) if schema_bytes else {}

    ont_ns_str = schema_model.get("namespace") or (extract_primary_namespace(schema_bytes)[0] if schema_bytes else DEFAULT_CMPO_NS)
    inst_ns_str = extract_primary_namespace(schema_bytes)[1] if schema_bytes else DEFAULT_INST_NS

    ONT = Namespace(ont_ns_str)
    INST = Namespace(inst_ns_str)
    SOSA = Namespace("http://www.w3.org/ns/sosa/")

    g = Graph()
    g.bind("cmpo", ONT)
    g.bind("inst", INST)
    g.bind("sosa", SOSA)
    g.bind("xsd", XSD)
    g.bind("rdf", RDF)
    g.bind("rdfs", RDF.RDFS if hasattr(RDF, "RDFS") else Namespace("http://www.w3.org/2000/01/rdf-schema#"))

    classes = set(schema_model.get("classes", []))
    properties = set(schema_model.get("properties", []))
    altlabel_map = schema_model.get("altlabel_map", {})
    observation_class = schema_model.get("observation_class")
    observable_property_classes = set(schema_model.get("observable_property_classes", []))

    # Registries to track deduplicated entities across all files
    created_wafers: Set[str] = set()
    created_machines: Set[str] = set()
    created_steps: Set[str] = set()
    created_entities: Set[str] = set()

    total_rows = 0

    for content, fname in zip(files, filenames):
        df = pd.read_csv(BytesIO(content), encoding="utf-8", on_bad_lines="skip")
        if df.empty:
            continue

        # Find critical context columns dynamically
        wafer_col = None
        machine_col = None
        stage_col = None
        chamber_col = None
        time_col = None

        for col in df.columns:
            col_strip = col.strip()
            col_lower = col_strip.lower()
            mapped = (mappings.get(col_strip) if mappings else None) or altlabel_map.get(col_strip) or altlabel_map.get(col_strip.upper()) or ""
            mapped_lower = mapped.lower()

            if "wafer" in col_lower or "wafer" in mapped_lower:
                wafer_col = col
            elif "machine" in col_lower or "tool" in col_lower or "machine" in mapped_lower or "tool" in mapped_lower:
                machine_col = col
            elif "stage" in col_lower or "stage" in mapped_lower:
                stage_col = col
            elif "chamber" in col_lower or "chamber" in mapped_lower:
                chamber_col = col
            elif "timestamp" in col_lower or "time" in col_lower or "timestamp" in mapped_lower:
                if time_col is None or len(col_lower) < len(time_col.lower()):
                    time_col = col

        for i, row in df.iterrows():
            total_rows += 1
            run_id = f"{i + 1:05d}"

            # Extract context values
            wafer_id = "0000000000"
            if wafer_col and pd.notna(row.get(wafer_col)):
                w_val = row.get(wafer_col)
                try:
                    wafer_id = str(int(float(w_val)))
                except Exception:
                    wafer_id = str(w_val).strip()

            machine_id = "1"
            if machine_col and pd.notna(row.get(machine_col)):
                m_val = row.get(machine_col)
                try:
                    machine_id = str(int(float(m_val)))
                except Exception:
                    machine_id = str(m_val).strip()

            stage = "A"
            if stage_col and pd.notna(row.get(stage_col)):
                stage = str(row.get(stage_col)).strip()

            chamber = "1"
            if chamber_col and pd.notna(row.get(chamber_col)):
                chamber = str(row.get(chamber_col)).strip()

            timestamp_val = 0.0
            if time_col and pd.notna(row.get(time_col)):
                try:
                    timestamp_val = float(row.get(time_col))
                except Exception:
                    pass

            # --- Fix 5: Deduplicated Wafer, Machine, and Step node creation ---
            wafer_uri = INST[f"wafer_{wafer_id}"]
            if wafer_id not in created_wafers:
                created_wafers.add(wafer_id)
                wafer_class = "Wafer" if "Wafer" in classes else "FeatureOfInterest"
                g.add((wafer_uri, RDF.type, ONT[wafer_class] if wafer_class in classes else SOSA.FeatureOfInterest))
                if "hasWaferId" in properties:
                    g.add((wafer_uri, ONT.hasWaferId, Literal(wafer_id)))

            machine_uri = INST[f"machine_{machine_id}"]
            if machine_id not in created_machines:
                created_machines.add(machine_id)
                machine_class = "Tool" if "Tool" in classes else ("Platform" if "Platform" in classes else "Machine")
                g.add((machine_uri, RDF.type, ONT[machine_class] if machine_class in classes else SOSA.Platform))
                if "toolId" in properties:
                    g.add((machine_uri, ONT.toolId, Literal(machine_id)))

            # --- Fix 4: Fully populated PolishingStep nodes ---
            step_key = f"{stage}_{wafer_id}"
            step_uri = INST[f"step_{step_key}"]
            if step_key not in created_steps:
                created_steps.add(step_key)
                step_class = "PolishingStep" if "PolishingStep" in classes else "ProcessStep"
                if step_class in classes:
                    g.add((step_uri, RDF.type, ONT[step_class]))
                if "stageLabel" in properties:
                    g.add((step_uri, ONT.stageLabel, Literal(stage)))
                if "actsOn" in properties:
                    g.add((step_uri, ONT.actsOn, wafer_uri))

            # Timestamp ISO string
            iso_time_str = _format_iso_timestamp(timestamp_val)

            # Check if schema uses SOSA Observation pattern
            if observation_class:
                # --- PATH A: SOSA Observation Pattern ---
                for col in df.columns:
                    if col in (wafer_col, machine_col, stage_col, chamber_col, time_col):
                        continue

                    val = row.get(col)
                    # Fix 2: Skip empty/NaN values completely
                    if pd.isna(val) or str(val).strip() == "":
                        continue

                    col_strip = col.strip()
                    local_term = (mappings.get(col_strip) if mappings else None) or altlabel_map.get(col_strip) or altlabel_map.get(col_strip.upper()) or _local_name_from_header(col_strip)
                    if not local_term:
                        continue

                    # Attempt numeric cast for observation result
                    try:
                        fval = float(val)
                        is_numeric = True
                    except (ValueError, TypeError):
                        is_numeric = False

                    # Fix 1: Check term classification
                    # If term is a property in the schema, attach directly as predicate
                    if local_term in properties and local_term not in classes:
                        if is_numeric:
                            g.add((wafer_uri, ONT[local_term], Literal(fval, datatype=XSD.float)))
                        else:
                            g.add((wafer_uri, ONT[local_term], Literal(str(val).strip())))
                        continue

                    # If term is an entity class (e.g., Recipe, Layer, Equipment) and NOT an ObservableProperty:
                    # Do NOT create an observation! Create/link the entity instance directly.
                    if observable_property_classes and local_term in classes and local_term not in observable_property_classes:
                        entity_val_clean = _safe_seg(str(val).strip())
                        ent_uri = INST[f"{local_term.lower()}_{entity_val_clean}"]
                        if str(ent_uri) not in created_entities:
                            created_entities.add(str(ent_uri))
                            g.add((ent_uri, RDF.type, ONT[local_term]))
                        # Link entity to step / wafer
                        g.add((step_uri, SOSA.hasFeatureOfInterest, ent_uri))
                        continue

                    # Non-numeric string value for a parameter class -> attach as string predicate on wafer, don't create invalid float observation
                    if not is_numeric:
                        g.add((wafer_uri, ONT[local_term], Literal(str(val).strip())))
                        continue

                    # Valid numeric observation of an ObservableProperty class
                    col_safe = _safe_seg(_local_name_from_header(col_strip))
                    obs_uri = INST[f"obs_{wafer_id}_{stage}_{run_id}_{col_safe}"]

                    # Fix 2: Exactly one sosa:hasSimpleResult xsd:float
                    g.add((obs_uri, RDF.type, ONT[observation_class]))
                    g.add((obs_uri, SOSA.observedProperty, ONT[local_term]))
                    g.add((obs_uri, SOSA.hasFeatureOfInterest, wafer_uri))
                    g.add((obs_uri, SOSA.madeOnPlatform, machine_uri))
                    g.add((obs_uri, SOSA.hasSimpleResult, Literal(fval, datatype=XSD.float)))

                    if "duringStep" in properties or "duringStep" in schema_model.get("object_properties", []):
                        g.add((obs_uri, ONT.duringStep, step_uri))

                    # Fix 3: Every observation gets rawTimestamp & sosa:resultTime
                    g.add((obs_uri, SOSA.resultTime, Literal(iso_time_str, datatype=XSD.dateTime)))
                    if "rawTimestamp" in properties or True:
                        g.add((obs_uri, ONT.rawTimestamp, Literal(timestamp_val, datatype=XSD.decimal)))

            else:
                # --- PATH B: Generic Fallback Pattern (Non-SOSA schema) ---
                container_class = list(classes)[0] if classes else "ProcessRun"
                run_uri = INST[f"run_{wafer_id}_{stage}_{run_id}"]
                g.add((run_uri, RDF.type, ONT[container_class]))

                for col in df.columns:
                    if col in (wafer_col, stage_col, time_col):
                        continue

                    val = row.get(col)
                    if pd.isna(val) or str(val).strip() == "":
                        continue

                    col_strip = col.strip()
                    local_term = (mappings.get(col_strip) if mappings else None) or altlabel_map.get(col_strip) or altlabel_map.get(col_strip.upper()) or _local_name_from_header(col_strip)
                    if not local_term:
                        continue

                    if local_term in properties:
                        try:
                            fval = float(val)
                            g.add((run_uri, ONT[local_term], Literal(fval, datatype=XSD.float)))
                        except Exception:
                            g.add((run_uri, ONT[local_term], Literal(str(val).strip())))
                    else:
                        col_safe = _safe_seg(_local_name_from_header(col_strip))
                        param_uri = INST[f"param_{wafer_id}_{stage}_{run_id}_{col_safe}"]
                        g.add((param_uri, RDF.type, ONT[local_term]))
                        try:
                            fval = float(val)
                            g.add((param_uri, ONT.hasNumericValue, Literal(fval, datatype=XSD.float)))
                        except Exception:
                            g.add((param_uri, ONT.hasValue, Literal(str(val).strip())))
                        g.add((param_uri, ONT.isMeasurementOf, run_uri))

    turtle = g.serialize(format="turtle")
    triples = len(g)
    return InstanceBuildResult(turtle=turtle, triples=triples, rows_processed=total_rows)
