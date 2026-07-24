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


DEFAULT_CMPO_NS = "https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo#"
DEFAULT_INST_NS = "https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo/instance/"

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

def _format_iso_timestamp(timestamp_val: float | int) -> Optional[str]:
    """Convert raw epoch or numeric timestamp to ISO 8601 xsd:dateTime string, or None if invalid/missing."""
    if not timestamp_val or timestamp_val == 0.0:
        return None
    try:
        ts = float(timestamp_val)
        if ts <= 0:
            return None
        # If epoch seconds (> 100,000,000)
        if ts > 100000000:
            dt = datetime.fromtimestamp(ts, tz=timezone.utc)
            return dt.strftime("%Y-%m-%dT%H:%M:%SZ")
        # Relative timestamp: offset from epoch 2026-01-01T00:00:00Z
        base_epoch = 1767225600
        dt = datetime.fromtimestamp(base_epoch + ts, tz=timezone.utc)
        return dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    except Exception:
        return None


def _clean_wafer_id(w_val: Any) -> Optional[str]:
    if pd.isna(w_val):
        return None
    s = str(w_val).strip()
    if not s or s.lower() in ("nan", "none", "null", "0", "0.0"):
        return None
    if s.endswith(".0"):
        s = s[:-2]
    try:
        if "." in s and ("e" in s.lower() or s.replace(".", "").isdigit()):
            f = float(s)
            if f == 0.0:
                return None
            if f.is_integer():
                s = str(int(f))
    except Exception:
        pass
    if s in ("0", "0.0"):
        return None
    return s


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
    Strictly enforces:
    1. Platform predicate: cmpo:madeOnPlatform (never sosa:madeOnPlatform).
    2. Machines typed cmpo:Tool with cmpo:toolId "N"^^xsd:string (never bare sosa:Platform).
    3. Chamber handling: inst:chamber_N a cmpo:Chamber with cmpo:chamberNumber N^^xsd:integer; observation gets second cmpo:madeOnPlatform link.
    4. Wafer key: inst:wafer_<WAFER_ID> with cmpo:hasWaferId "WAFER_ID"^^xsd:string, deduplicated. Invalid/missing/0 wafer rows in process CSVs skipped.
    5. Step key: inst:step_<STAGE>_<WAFER_ID> with cmpo:stageLabel "STAGE"^^xsd:string, cmpo:executedOn machine_uri.
    6. Context entity links via declared properties; sosa:hasFeatureOfInterest ONLY on observations.
    7. Timestamps: omit sosa:resultTime and cmpo:rawTimestamp if missing/zero.
    8. Entity-file mode: dynamically process entity CSVs without requiring WAFER_ID or hardcoded filenames.
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
    observation_class = schema_model.get("observation_class") or "CMPObservation"
    observable_property_classes = set(schema_model.get("observable_property_classes", []))

    # Registries to track deduplicated entities across all files
    created_wafers: Set[str] = set()
    created_machines: Set[str] = set()
    created_chambers: Set[str] = set()
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
        lot_col = None
        recipe_col = None

        # Priority 1 & 2 for wafer_col: Explicit mapping or exact standard header
        for col in df.columns:
            col_strip = col.strip()
            col_lower = col_strip.lower()
            mapped = (mappings.get(col_strip) if mappings else None) or altlabel_map.get(col_strip) or altlabel_map.get(col_strip.upper()) or ""
            mapped_lower = mapped.lower()

            if mapped_lower in ("haswaferid", "waferid", "haswafer"):
                wafer_col = col
                break
            if col_lower in ("wafer_id", "waferid", "wafer"):
                wafer_col = col

        # Priority 3 for wafer_col: Substring matching excluding fractional/numeric headers like wafer_17.20930233
        if wafer_col is None:
            for col in df.columns:
                col_strip = col.strip()
                col_lower = col_strip.lower()
                mapped = (mappings.get(col_strip) if mappings else None) or altlabel_map.get(col_strip) or altlabel_map.get(col_strip.upper()) or ""
                mapped_lower = mapped.lower()

                if ("wafer_id" in col_lower or "waferid" in col_lower or "wafer" in col_lower or "wafer" in mapped_lower) and not re.search(r"wafer_\d+\.\d+", col_lower):
                    wafer_col = col
                    break

        # Other context columns
        for col in df.columns:
            col_strip = col.strip()
            col_lower = col_strip.lower()
            mapped = (mappings.get(col_strip) if mappings else None) or altlabel_map.get(col_strip) or altlabel_map.get(col_strip.upper()) or ""
            mapped_lower = mapped.lower()

            if machine_col is None and ("machine" in col_lower or "tool" in col_lower or "machine" in mapped_lower or "tool" in mapped_lower):
                machine_col = col
            elif stage_col is None and ("stage" in col_lower or "stage" in mapped_lower):
                stage_col = col
            elif chamber_col is None and ("chamber" in col_lower or "chamber" in mapped_lower):
                chamber_col = col
            elif "timestamp" in col_lower or "time" in col_lower or "timestamp" in mapped_lower:
                if time_col is None or len(col_lower) < len(time_col.lower()):
                    time_col = col
            elif lot_col is None and ("lot" in col_lower or "lot" in mapped_lower):
                lot_col = col
            elif recipe_col is None and ("recipe" in col_lower or "recipe" in mapped_lower):
                recipe_col = col

        # Dynamic Mode Detection — Process CSV vs Entity CSV
        # Step 3 fix: A CSV without a WAFER_ID column is processed in entity-file mode (not skipped row-by-row)
        is_entity_file = (wafer_col is None)
        is_process_csv = not is_entity_file

        skipped_rows_file = 0

        for i, row in df.iterrows():
            if is_entity_file:
                # --- Step 8: Generic Dynamic Entity CSV Mode ---
                total_rows += 1
                for col in df.columns:
                    val = row.get(col)
                    if pd.isna(val) or str(val).strip() == "":
                        continue

                    col_strip = col.strip()
                    val_str = str(val).strip()
                    local_term = (mappings.get(col_strip) if mappings else None) or altlabel_map.get(col_strip) or altlabel_map.get(col_strip.upper()) or _local_name_from_header(col_strip)

                    # Check if column is an ID column for a class (e.g. chamber_id, lot_id, spc_limit_id, pad_id, etc.)
                    col_lower = col_strip.lower()
                    target_cls = None
                    if col_lower.endswith("_id"):
                        cls_candidate = col_strip[:-3]
                        matched_cls = [c for c in classes if c.lower() == cls_candidate.replace("_", "").lower()]
                        if matched_cls:
                            target_cls = matched_cls[0]
                        else:
                            target_cls = _local_name_from_header(cls_candidate)
                    elif local_term in classes:
                        target_cls = local_term

                    if target_cls:
                        val_clean = _safe_seg(val_str)
                        ent_uri = INST[f"{target_cls.lower()}_{val_clean}"]
                        if str(ent_uri) not in created_entities:
                            created_entities.add(str(ent_uri))
                            g.add((ent_uri, RDF.type, ONT[target_cls]))

                        # Attach entity properties dynamically if row has attribute columns
                        if target_cls == "Chamber" and "chamberNumber" in df.columns:
                            try:
                                cnum = int(float(row.get("chamberNumber")))
                                g.add((ent_uri, ONT.chamberNumber, Literal(cnum, datatype=XSD.integer)))
                            except Exception:
                                pass

                        if target_cls == "Lot" and "hasLotType" in df.columns and pd.notna(row.get("hasLotType")):
                            ltype = str(row.get("hasLotType")).strip()
                            ltype_uri = INST[f"lottype_{_safe_seg(ltype)}"]
                            g.add((ltype_uri, RDF.type, ONT.LotType))
                            g.add((ent_uri, ONT.hasLotType, ltype_uri))

                        if target_cls in ("SPCLimit", "ProcessWindow") and "targetParameter" in df.columns and pd.notna(row.get("targetParameter")):
                            pname = str(row.get("targetParameter")).strip()
                            pred = ONT.hasSPCLimit if target_cls == "SPCLimit" else ONT.hasProcessWindow
                            g.add((ONT[pname], pred, ent_uri))

                        if target_cls == "PolishingPad" and "hasGroovePattern" in df.columns and pd.notna(row.get("hasGroovePattern")):
                            gp = str(row.get("hasGroovePattern")).strip()
                            gp_uri = INST[f"groovepattern_{_safe_seg(gp)}"]
                            g.add((gp_uri, RDF.type, ONT.GroovePattern))
                            g.add((ent_uri, ONT.hasGroovePattern, gp_uri))

                continue

            # --- Process CSV Mode ---
            wafer_id = _clean_wafer_id(row.get(wafer_col)) if wafer_col else None

            # Skip invalid wafer rows in process CSVs
            if not wafer_id:
                skipped_rows_file += 1
                continue

            total_rows += 1
            run_id = f"{i + 1:05d}"

            # Extract machine ID
            machine_id = "1"
            if machine_col and pd.notna(row.get(machine_col)):
                m_val = row.get(machine_col)
                try:
                    machine_id = str(int(float(m_val)))
                except Exception:
                    machine_id = str(m_val).strip()

            # Extract stage
            stage = "A"
            if stage_col and pd.notna(row.get(stage_col)):
                s_val = str(row.get(stage_col)).strip()
                if s_val and not s_val.replace(".", "").isdigit():
                    stage = s_val

            # Extract chamber
            chamber_num = None
            if chamber_col and pd.notna(row.get(chamber_col)):
                c_val = row.get(chamber_col)
                try:
                    chamber_num = int(float(c_val))
                except Exception:
                    pass

            # Extract raw timestamp
            raw_ts = None
            if time_col and pd.notna(row.get(time_col)):
                try:
                    val_t = float(row.get(time_col))
                    if val_t > 0:
                        raw_ts = val_t
                except Exception:
                    pass

            # Step 2: Machine typed cmpo:Tool with cmpo:toolId "N"^^xsd:string
            machine_uri = INST[f"machine_{machine_id}"]
            if machine_id not in created_machines:
                created_machines.add(machine_id)
                g.add((machine_uri, RDF.type, ONT.Tool))
                g.add((machine_uri, ONT.toolId, Literal(machine_id, datatype=XSD.string)))

            # Step 3: Chamber inst:chamber_N a cmpo:Chamber with cmpo:chamberNumber N^^xsd:integer
            chamber_uri = None
            if chamber_num is not None:
                chamber_key = str(chamber_num)
                chamber_uri = INST[f"chamber_{chamber_key}"]
                if chamber_key not in created_chambers:
                    created_chambers.add(chamber_key)
                    g.add((chamber_uri, RDF.type, ONT.Chamber))
                    g.add((chamber_uri, ONT.chamberNumber, Literal(chamber_num, datatype=XSD.integer)))

            # Step 4: Wafer inst:wafer_<WAFER_ID> with cmpo:hasWaferId "WAFER_ID"^^xsd:string
            wafer_uri = INST[f"wafer_{wafer_id}"]
            if wafer_id not in created_wafers:
                created_wafers.add(wafer_id)
                g.add((wafer_uri, RDF.type, ONT.Wafer))
                g.add((wafer_uri, ONT.hasWaferId, Literal(wafer_id, datatype=XSD.string)))

            # Step 5: Step inst:step_<STAGE>_<WAFER_ID> with cmpo:stageLabel "STAGE"^^xsd:string
            step_key = f"{stage}_{wafer_id}"
            step_uri = INST[f"step_{step_key}"]
            if step_key not in created_steps:
                created_steps.add(step_key)
                g.add((step_uri, RDF.type, ONT.PolishingStep if "PolishingStep" in classes else ONT.ProcessStep))
                g.add((step_uri, ONT.stageLabel, Literal(stage, datatype=XSD.string)))
                g.add((step_uri, ONT.hasInput, wafer_uri))
                g.add((step_uri, ONT.hasOutput, wafer_uri))
                g.add((step_uri, ONT.executedOn, machine_uri))

            # Timestamp parsing (Step 7: omit if missing/zero)
            iso_time_str = _format_iso_timestamp(raw_ts) if raw_ts else None

            # Process observations & parameter columns
            for col in df.columns:
                if col in (wafer_col, machine_col, stage_col, chamber_col, time_col):
                    continue

                val = row.get(col)
                if pd.isna(val) or str(val).strip() == "":
                    continue

                col_strip = col.strip()
                local_term = (mappings.get(col_strip) if mappings else None) or altlabel_map.get(col_strip) or altlabel_map.get(col_strip.upper()) or _local_name_from_header(col_strip)
                if not local_term:
                    continue

                try:
                    fval = float(val)
                    is_numeric = True
                except (ValueError, TypeError):
                    is_numeric = False

                # Step 6: Domain/Range context entity links
                if observable_property_classes and local_term in classes and local_term not in observable_property_classes:
                    entity_val_clean = _safe_seg(str(val).strip())
                    ent_uri = INST[f"{local_term.lower()}_{entity_val_clean}"]
                    if str(ent_uri) not in created_entities:
                        created_entities.add(str(ent_uri))
                        g.add((ent_uri, RDF.type, ONT[local_term]))

                    if local_term == "Recipe":
                        g.add((step_uri, ONT.usesRecipe, ent_uri))
                    elif local_term == "Slurry":
                        g.add((step_uri, ONT.usedSlurry, ent_uri))
                    elif local_term == "Layer":
                        g.add((wafer_uri, ONT.hasLayer, ent_uri))
                    elif local_term == "Lot":
                        g.add((wafer_uri, ONT.isPartOfLot, ent_uri))
                    continue

                if not is_numeric:
                    continue

                # Observation generation
                col_safe = _safe_seg(_local_name_from_header(col_strip))
                obs_uri = INST[f"obs_{wafer_id}_{stage}_{run_id}_{col_safe}"]

                g.add((obs_uri, RDF.type, ONT[observation_class]))
                g.add((obs_uri, SOSA.observedProperty, ONT[local_term]))

                # Step 6: sosa:hasFeatureOfInterest ONLY on observations
                g.add((obs_uri, SOSA.hasFeatureOfInterest, wafer_uri))

                # Step 1 & 3: cmpo:madeOnPlatform carried on observation (machine & chamber)
                g.add((obs_uri, ONT.madeOnPlatform, machine_uri))
                if chamber_uri:
                    g.add((obs_uri, ONT.madeOnPlatform, chamber_uri))

                # Exactly one sosa:hasSimpleResult xsd:float
                g.add((obs_uri, SOSA.hasSimpleResult, Literal(fval, datatype=XSD.float)))
                g.add((obs_uri, ONT.duringStep, step_uri))

                # Step 7: Timestamps added ONLY if present and valid
                if iso_time_str and raw_ts:
                    g.add((obs_uri, SOSA.resultTime, Literal(iso_time_str, datatype=XSD.dateTime)))
                    g.add((obs_uri, ONT.rawTimestamp, Literal(raw_ts, datatype=XSD.decimal)))

        if skipped_rows_file > 0:
            print(f"[SUMMARY] File '{fname}': Skipped {skipped_rows_file} invalid process rows without WAFER_ID out of {len(df)} total rows")

    turtle = g.serialize(format="turtle")
    triples = len(g)
    return InstanceBuildResult(turtle=turtle, triples=triples, rows_processed=total_rows)
