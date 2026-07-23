import os
import io
import json
import re
from typing import List, Dict, Any, Optional
from rdflib import Graph, Namespace, RDF, URIRef
from pyshacl import validate

from services.local_llm_service import LocalLLMService
from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors

class ValidationService:
    def __init__(self):
        self.llm = LocalLLMService()

    def _shorten_iri(self, iri: str) -> str:
        """Helper to shorten IRIs into pre-defined prefixes for readability."""
        if not iri:
            return ""
        iri_str = str(iri)
        mappings = {
            "https://tucid/cpmo/instance/": "inst:",
            "https://tucid/cpmo/": "cmpo:",
            "http://www.w3.org/1999/02/22-rdf-syntax-ns#": "rdf:",
            "http://www.w3.org/2000/01/rdf-schema#": "rdfs:",
            "http://www.w3.org/2002/07/owl#": "owl:",
            "http://www.w3.org/2001/XMLSchema#": "xsd:",
            "http://www.w3.org/ns/shacl#": "sh:"
        }
        for full, short in mappings.items():
            if iri_str.startswith(full):
                return iri_str.replace(full, short)
        # Fallback if no matching namespace
        if "#" in iri_str:
            return iri_str.rsplit("#", 1)[-1]
        if "/" in iri_str:
            return iri_str.rsplit("/", 1)[-1]
        return iri_str

    def suggest_validation_rules(self, user_explanation: Optional[str] = None, schema_content: Optional[str] = None, instance_content: Optional[str] = None, num_questions: int = 10) -> List[str]:
        """
        Uses Kiste LLM to suggest data validation rules in plain English based on the ontology schema
        and optionally instance data.
        """
        schema_text = schema_content or "No schema provided. Suggest general CMP (Chemical Mechanical Planarization) validation rules."
        explanation = user_explanation or "General CMP data validation."
        target_count = max(1, min(50, num_questions))
        
        instance_section = ""
        if instance_content:
            # Truncate instance content to avoid token overflow
            truncated = instance_content[:8000]
            instance_section = f"\n\nINSTANCE DATA SAMPLE:\n{truncated}"
        
        prompt = (
            "You are a Senior Data Quality and Process Engineer in semiconductor manufacturing. "
            f"Your task is to analyze the provided RDF/OWL Ontology Schema for CMP (Chemical Mechanical Planarization) "
            f"and suggest exactly {target_count} highly relevant data quality validation questions in plain English.\n\n"
            f"User's Goals/Context: {explanation}\n\n"
            "Guidelines:\n"
            f"- Suggest exactly {target_count} validation questions.\n"
            "- Express questions in clear, direct English, like:\n"
            "  'Every CMP process must have a start timestamp'\n"
            "  'Pressure must be a positive float value'\n"
            "  'Slurry flow rates should not be negative'\n"
            "  'Polishing pad age must be a positive integer'\n"
            "- Tailor the questions to classes and properties in the schema.\n"
            "- If instance data is provided, also consider patterns and potential issues visible in the data.\n"
            f"- Output EXACTLY a JSON object with this key structure: {{\"rules\": [\"rule 1\", ..., \"rule {target_count}\"]}}.\n"
            "- DO NOT return any explanatory text or markdown code blocks outside of the JSON.\n\n"
            f"SCHEMA CONTEXT:\n{schema_text}"
            f"{instance_section}"
        )
        
        messages = [
            {"role": "system", "content": "You are a SPARQL/SHACL validation rules assistant. You output only structured JSON."},
            {"role": "user", "content": prompt}
        ]
        
        fallback_rules = [
            "Every CMP process must have a measurement timestamp.",
            "Every CMP process must act on at least one Wafer.",
            "Every CMP process must specify the Chamber used.",
            "Pressure parameter values must be positive floats.",
            "Stage/platen rotation speeds must be non-negative.",
            "Slurry flow rates must be non-negative.",
            "Slurry pH must be a float between 1.0 and 14.0.",
            "Polishing pad age must be a non-negative integer.",
            "Every wafer must have a wafer material specified.",
            "Lot size must be a positive integer.",
            "Backing film usage must be a non-negative number.",
            "Dresser table usage must be a non-negative integer.",
            "Every CMP process must specify the recipe used.",
            "Wafer diameter must be specified.",
            "Abrasive concentration percentage must be between 0 and 100.",
            "Air exchange rate in cleanroom must be a positive integer.",
            "Every tool component must belong to a parent tool.",
            "Downforce value must be a positive float.",
            "Sweep per minute must be a positive integer.",
            "Cleanroom area must be a positive float."
        ]
        
        try:
            response = self.llm._call_kiste(messages, json_mode=True, temperature=0.2)
            data = json.loads(response)
            rules = data.get("rules", [])
            if len(rules) < target_count:
                rules.extend([f"Validation rule #{i+1} must be satisfied." for i in range(len(rules), target_count)])
            return rules[:target_count]
        except Exception as e:
            print(f"Error suggesting rules: {e}")
            while len(fallback_rules) < target_count:
                fallback_rules.append(f"Parameter rule #{len(fallback_rules)+1} must be positive.")
            return fallback_rules[:target_count]


    def generate_shacl_shapes(self, rules: List[str], schema_content: Optional[str] = None) -> str:
        """
        Uses Kiste LLM to turn a list of plain English rules and an ontology schema into SHACL shapes (TTL).
        """
        schema_text = schema_content or "No schema provided."
        rules_text = "\n".join(f"- {r}" for r in rules)
        
        prompt = (
            "You are a Semantic Web and SHACL developer. "
            "Turn the following list of plain-English data quality rules into a SHACL shape file in Turtle (.ttl) format "
            "that conforms to the provided RDF/OWL Ontology Schema.\n\n"
            f"Rules to implement:\n{rules_text}\n\n"
            "Instructions and Constraints:\n"
            "1. Output ONLY valid Turtle syntax. Do NOT write any explanations, markdown code fences, or text before/after the Turtle.\n"
            "2. Define common prefixes: \n"
            "   @prefix sh: <http://www.w3.org/ns/shacl#> .\n"
            "   @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\n"
            "   @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .\n"
            "   @prefix cmpo: <https://tucid/cpmo/> .\n"
            "   @prefix inst: <https://tucid/cpmo/instance/> .\n"
            "3. Structure your shapes correctly. A `sh:NodeShape` targets a class (e.g. `sh:targetClass cmpo:Pressure`).\n"
            "   CRITICAL ERROR PREVENTION: A shape defined as a `sh:NodeShape` cannot be the subject of a `sh:path` predicate. "
            "   Always nest the path and constraint details inside `sh:property [ sh:path ... ]` block. For example:\n"
            "   ```turtle\n"
            "   cmpo:PressureShape a sh:NodeShape ;\n"
            "       sh:targetClass cmpo:Pressure ;\n"
            "       sh:property [\n"
            "           sh:path cmpo:hasNumericValue ;\n"
            "           sh:datatype xsd:float ;\n"
            "           sh:minInclusive 0.0 ;\n"
            "           sh:message \"Pressure parameter value must be a positive float.\"\n"
            "       ] .\n"
            "   ```\n"
            "4. Add descriptive sh:message strings matching the rule descriptions.\n\n"
            f"ONTOLOGY SCHEMA:\n{schema_text}"
        )
        
        messages = [
            {"role": "system", "content": "You are a SHACL code generator. You output only valid Turtle (.ttl) code. You structure shapes correctly and never place sh:path directly inside a sh:NodeShape."},
            {"role": "user", "content": prompt}
        ]
        
        try:
            response = self.llm._call_kiste(messages, json_mode=False, temperature=0.1)
            # Remove any markdown wrappers if the model didn't follow instructions
            clean_ttl = re.sub(r"^```[a-zA-Z]*\n", "", response)
            clean_ttl = re.sub(r"```$", "", clean_ttl.strip())
            print("=== GENERATED SHACL SHAPES ===")
            print(clean_ttl)
            print("==============================")
            return clean_ttl.strip()
        except Exception as e:
            print(f"Error generating SHACL shapes: {e}")
            # Return default shapes from file
            default_path = r"d:\Masters\KG_Portal\Knowledge_graph_portal\backend\ontology\default_shapes.ttl"
            if os.path.exists(default_path):
                with open(default_path, "r", encoding="utf-8") as f:
                    return f.read()
            return "@prefix sh: <http://www.w3.org/ns/shacl#> .\n# Failed to generate shapes."

    async def generate_shacl_shapes_stream(self, rules: List[str], schema_content: Optional[str] = None):
        """
        Generates SHACL shapes rule by rule concurrently and streams progress and snippets.
        """
        import asyncio
        from concurrent.futures import ThreadPoolExecutor
        from rdflib import Graph
        
        schema_text = schema_content or "No schema provided."
        completed_shapes = {}
        
        def generate_single_shape(index: int, rule: str) -> dict:
            prompt = (
                "You are a Semantic Web and SHACL developer. "
                "Turn the following plain-English data quality rule into a SHACL shape block in Turtle (.ttl) format "
                "that conforms to the provided RDF/OWL Ontology Schema.\n\n"
                f"Rule to implement:\n- {rule}\n\n"
                "Instructions and Constraints:\n"
                "1. Output ONLY valid Turtle syntax. Do NOT write any explanations, markdown code fences, or text before/after the Turtle.\n"
                "2. Define common prefixes (if needed/used in this shape) but focus on producing the NodeShape/PropertyShape details:\n"
                "   @prefix sh: <http://www.w3.org/ns/shacl#> .\n"
                "   @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\n"
                "   @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .\n"
                "   @prefix cmpo: <https://tucid/cpmo/> .\n"
                "   @prefix inst: <https://tucid/cpmo/instance/> .\n"
                "3. Structure your shapes correctly. A `sh:NodeShape` targets a class (e.g. `sh:targetClass cmpo:Pressure`).\n"
                "   CRITICAL ERROR PREVENTION: A shape defined as a `sh:NodeShape` cannot be the subject of a `sh:path` predicate. "
                "   Always nest the path and constraint details inside `sh:property [ sh:path ... ]` block. For example:\n"
                "   ```turtle\n"
                "   cmpo:PressureShape a sh:NodeShape ;\n"
                "       sh:targetClass cmpo:Pressure ;\n"
                "       sh:property [\n"
                "           sh:path cmpo:hasNumericValue ;\n"
                "           sh:datatype xsd:float ;\n"
                "           sh:minInclusive 0.0 ;\n"
                "           sh:message \"Pressure parameter value must be a positive float.\"\n"
                "       ] .\n"
                "   ```\n"
                "4. Add a descriptive sh:message matching the rule description.\n\n"
                f"ONTOLOGY SCHEMA:\n{schema_text}"
            )
            messages = [
                {"role": "system", "content": "You are a SHACL code generator. You output only valid Turtle (.ttl) code. You structure shapes correctly and never place sh:path directly inside a sh:NodeShape."},
                {"role": "user", "content": prompt}
            ]
            try:
                response = self.llm._call_kiste(messages, json_mode=False, temperature=0.1)
                # Clean up any wrappers
                clean_ttl = re.sub(r"^```[a-zA-Z]*\n", "", response)
                clean_ttl = re.sub(r"```$", "", clean_ttl.strip())
                return {"index": index, "rule": rule, "status": "success", "shacl": clean_ttl.strip()}
            except Exception as e:
                print(f"Error generating shape for rule '{rule}': {e}")
                return {"index": index, "rule": rule, "status": "error", "message": str(e), "shacl": f"# Failed to generate shape for rule: {rule}"}

        loop = asyncio.get_running_loop()
        
        yield {"status": "start", "total": len(rules)}
        
        with ThreadPoolExecutor(max_workers=min(len(rules), 10)) as executor:
            tasks = [
                loop.run_in_executor(executor, generate_single_shape, i, rule)
                for i, rule in enumerate(rules)
            ]
            
            for future in asyncio.as_completed(tasks):
                res = await future
                if res["status"] == "success":
                    completed_shapes[res["index"]] = res["shacl"]
                yield {
                    "status": "progress",
                    "index": res["index"],
                    "rule": res["rule"],
                    "result_status": res["status"],
                    "shacl": res["shacl"],
                    "message": f"Generated shape for rule: {res['rule'][:50]}..." if res["status"] == "success" else f"Failed rule: {res['rule'][:50]}..."
                }

        # Merge all shapes into a final RDF graph to prettify and deduplicate prefixes
        final_ttl = ""
        if completed_shapes:
            g = Graph()
            # Sort by index to keep ordering consistent
            for idx in sorted(completed_shapes.keys()):
                chunk = completed_shapes[idx]
                try:
                    g.parse(data=chunk, format="turtle")
                except Exception as parse_err:
                    print(f"rdflib failed to parse chunk {idx}: {parse_err}. Using fallback concatenation later if needed.")
            
            try:
                g.bind("sh", Namespace("http://www.w3.org/ns/shacl#"))
                g.bind("xsd", Namespace("http://www.w3.org/2001/XMLSchema#"))
                g.bind("rdfs", Namespace("http://www.w3.org/2000/01/rdf-schema#"))
                g.bind("cmpo", Namespace("https://tucid/cpmo/"))
                g.bind("inst", Namespace("https://tucid/cpmo/instance/"))
                
                final_ttl = g.serialize(format="turtle")
            except Exception as ser_err:
                print(f"rdflib serialization failed: {ser_err}")
                final_ttl = "\n\n".join(completed_shapes[idx] for idx in sorted(completed_shapes.keys()))
        else:
            final_ttl = "@prefix sh: <http://www.w3.org/ns/shacl#> .\n# Failed to generate any shapes."
            
        yield {"status": "completed", "shacl_ttl": final_ttl.strip()}

    def validate_rdf_stream(self, data_ttl: str, shapes_ttl: str, schema_ttl: Optional[str] = None):
        """
        Generator that yields JSON progress events for SSE streaming.
        Each yield is a dict that will be JSON-serialized.
        """
        import time

        # Step 1: Parse SHACL shapes
        yield {"step": "parsing_shapes", "message": "Parsing SHACL shapes..."}
        try:
            g_shapes = Graph()
            g_shapes.parse(data=shapes_ttl, format="turtle")
        except Exception as e:
            error_str = str(e)
            # Extract a user-friendly message from the rdflib BadSyntax error
            friendly = "Invalid SHACL Turtle syntax. "
            if "Bad syntax" in error_str:
                friendly += error_str.split("Bad syntax")[-1].split("at ^")[0].strip().strip("(").strip(")")
                friendly += ". Please check the generated SHACL shapes for syntax errors."
            else:
                friendly += f"Parser error: {error_str[:200]}"
            yield {"step": "error", "message": friendly, "error": True}
            return

        num_shapes = len(list(g_shapes.subjects(RDF.type, Namespace("http://www.w3.org/ns/shacl#").NodeShape)))
        yield {"step": "shapes_parsed", "message": f"SHACL shapes parsed successfully ({num_shapes} shapes found)"}

        # Step 2: Parse data graph
        yield {"step": "parsing_data", "message": "Parsing instance data graph..."}
        try:
            g_data = Graph()
            g_data.parse(data=data_ttl, format="turtle")
        except Exception as e:
            yield {"step": "error", "message": f"Failed to parse instance data: {str(e)[:200]}", "error": True}
            return
        yield {"step": "data_parsed", "message": f"Data graph loaded ({len(g_data)} triples)"}

        # Step 3: Parse and merge schema
        g_combined = g_data
        if schema_ttl:
            yield {"step": "parsing_schema", "message": "Parsing and merging schema graph..."}
            try:
                g_schema = Graph()
                g_schema.parse(data=schema_ttl, format="turtle")
                g_combined = g_data + g_schema
            except Exception as e:
                yield {"step": "error", "message": f"Failed to parse schema: {str(e)[:200]}", "error": True}
                return
            yield {"step": "schema_merged", "message": f"Schema merged ({len(g_combined)} total triples)"}

        # Step 4: Run SHACL validation
        yield {"step": "validating", "message": f"Running SHACL validation on {len(g_combined)} triples..."}
        try:
            start_time = time.time()
            conforms, results_graph, results_text = validate(
                g_combined,
                shacl_graph=g_shapes,
                inference="none",
                serialize_results_format="turtle"
            )
            elapsed = round(time.time() - start_time, 1)
        except Exception as e:
            yield {"step": "error", "message": f"SHACL validation engine error: {str(e)[:200]}", "error": True}
            return
        yield {"step": "validation_done", "message": f"Validation completed in {elapsed}s"}

        # Step 5: Collect results
        yield {"step": "collecting", "message": "Collecting results..."}

        SH = Namespace("http://www.w3.org/ns/shacl#")
        violations = []
        violated_shapes = set()

        for result_node in results_graph.subjects(RDF.type, SH.ValidationResult):
            focus_node = results_graph.value(result_node, SH.focusNode)
            path = results_graph.value(result_node, SH.resultPath)
            severity = results_graph.value(result_node, SH.resultSeverity)
            source_shape = results_graph.value(result_node, SH.sourceShape)
            message = results_graph.value(result_node, SH.resultMessage)
            val = results_graph.value(result_node, SH.value)

            if source_shape:
                violated_shapes.add(str(source_shape))

            violations.append({
                "focus_node": str(focus_node),
                "focus_node_short": self._shorten_iri(focus_node),
                "path": str(path) if path else "",
                "path_short": self._shorten_iri(path) if path else "",
                "severity": str(severity).split("#")[-1] if severity else "Violation",
                "source_shape": str(source_shape) if source_shape else "",
                "source_shape_short": self._shorten_iri(source_shape) if source_shape else "",
                "message": str(message) if message else "Validation constraint violated",
                "value": str(val) if val is not None else ""
            })

        all_shapes = []
        for shape_node in g_shapes.subjects(RDF.type, SH.NodeShape):
            label = g_shapes.value(shape_node, Namespace("http://www.w3.org/2000/01/rdf-schema#").label)
            target_cls = g_shapes.value(shape_node, SH.targetClass)

            shape_str = str(shape_node)
            passed = shape_str not in violated_shapes

            all_shapes.append({
                "shape_iri": shape_str,
                "shape_short": self._shorten_iri(shape_node),
                "label": str(label) if label else self._shorten_iri(shape_node),
                "target_class": str(target_cls) if target_cls else "",
                "target_class_short": self._shorten_iri(target_cls) if target_cls else "",
                "status": "Pass" if passed else "Fail"
            })

        # Final result
        yield {
            "step": "result",
            "message": "Done",
            "report": {
                "conforms": conforms,
                "total_triples": len(g_data),
                "total_violations": len(violations),
                "rules": all_shapes,
                "violations": violations
            }
        }

    def validate_rdf(self, data_ttl: str, shapes_ttl: str, schema_ttl: Optional[str] = None) -> Dict[str, Any]:
        """
        Non-streaming wrapper: runs the full validation and returns the report dict.
        """
        result = None
        for event in self.validate_rdf_stream(data_ttl, shapes_ttl, schema_ttl):
            if event.get("error"):
                return {
                    "conforms": False,
                    "error": event["message"],
                    "total_violations": 0,
                    "total_triples": 0,
                    "rules": [],
                    "violations": []
                }
            if event.get("report"):
                result = event["report"]
        return result or {
            "conforms": False,
            "error": "Validation produced no results",
            "total_violations": 0,
            "total_triples": 0,
            "rules": [],
            "violations": []
        }

    def generate_pdf_report(self, report_data: Dict[str, Any]) -> bytes:
        """
        Generates a premium, clean PDF report from validation results.
        """
        buffer = io.BytesIO()
        doc = SimpleDocTemplate(
            buffer,
            pagesize=letter,
            rightMargin=36,
            leftMargin=36,
            topMargin=36,
            bottomMargin=36
        )
        
        styles = getSampleStyleSheet()
        
        # Define clean, curated color palette (no default pure colors)
        color_primary = colors.HexColor("#1e293b")  # Dark Slate Blue/Gray
        color_secondary = colors.HexColor("#475569")
        color_success = colors.HexColor("#10b981")  # Mint Green
        color_danger = colors.HexColor("#ef4444")   # Curated Red
        color_bg_light = colors.HexColor("#f8fafc")  # Cool Light Gray
        
        # Modify existing styles to avoid adding duplicate styles with same name
        styles['Normal'].textColor = color_secondary
        styles['BodyText'].textColor = color_secondary
        
        # Create custom paragraph styles
        style_title = ParagraphStyle(
            name='ReportTitle',
            parent=styles['Normal'],
            fontName='Helvetica-Bold',
            fontSize=24,
            leading=28,
            textColor=color_primary,
            spaceAfter=15
        )
        
        style_h2 = ParagraphStyle(
            name='SectionHeading',
            parent=styles['Normal'],
            fontName='Helvetica-Bold',
            fontSize=16,
            leading=20,
            textColor=color_primary,
            spaceBefore=15,
            spaceAfter=10
        )
        
        style_cell = ParagraphStyle(
            name='TableCell',
            parent=styles['Normal'],
            fontName='Helvetica',
            fontSize=9,
            leading=11,
            textColor=color_secondary
        )
        
        style_cell_bold = ParagraphStyle(
            name='TableCellBold',
            parent=style_cell,
            fontName='Helvetica-Bold',
            textColor=color_primary
        )
        
        story = []
        
        # 1. Header Section
        story.append(Paragraph("Knowledge Graph Portal - Validation Report", style_title))
        story.append(Spacer(1, 10))
        
        # 2. Executive Summary Block
        conforms = report_data.get("conforms", False)
        status_text = "PASSED" if conforms else "FAILED"
        status_color = color_success if conforms else color_danger
        
        summary_data = [
            [Paragraph("<b>Validation Status:</b>", style_cell), Paragraph(f"<font color='{status_color}'><b>{status_text}</b></font>", style_cell_bold)],
            [Paragraph("<b>Total Violations Found:</b>", style_cell), Paragraph(str(report_data.get("total_violations", 0)), style_cell_bold)],
            [Paragraph("<b>Data Graph Size:</b>", style_cell), Paragraph(f"{report_data.get('total_triples', 0)} triples", style_cell)],
            [Paragraph("<b>Report Generated On:</b>", style_cell), Paragraph(str(os.popen("date /t").read().strip()), style_cell)]
        ]
        
        summary_table = Table(summary_data, colWidths=[150, 390])
        summary_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), color_bg_light),
            ('PADDING', (0, 0), (-1, -1), 8),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('LINEBELOW', (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
        ]))
        
        story.append(summary_table)
        story.append(Spacer(1, 20))
        
        # 3. Rules Evaluation Section
        story.append(Paragraph("Rules Evaluation List", style_h2))
        
        rules = report_data.get("rules", [])
        if rules:
            rules_header = [
                Paragraph("<b>Rule / Shape Name</b>", style_cell_bold),
                Paragraph("<b>Target Class</b>", style_cell_bold),
                Paragraph("<b>Status</b>", style_cell_bold)
            ]
            rules_rows = [rules_header]
            for r in rules:
                status_val = r.get("status", "Pass")
                status_color = color_success if status_val == "Pass" else color_danger
                
                rules_rows.append([
                    Paragraph(r.get("label", ""), style_cell),
                    Paragraph(r.get("target_class_short", ""), style_cell),
                    Paragraph(f"<font color='{status_color}'><b>{status_val}</b></font>", style_cell_bold)
                ])
            
            rules_table = Table(rules_rows, colWidths=[240, 200, 100])
            rules_table.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor("#cbd5e1")),
                ('PADDING', (0, 0), (-1, -1), 6),
                ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
                ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, color_bg_light])
            ]))
            story.append(rules_table)
        else:
            story.append(Paragraph("No rules evaluated.", style_cell))
            
        story.append(Spacer(1, 20))
        
        # 4. Detailed Violations Section
        story.append(Paragraph("Detailed Violations Log", style_h2))
        
        violations = report_data.get("violations", [])
        if violations:
            viol_header = [
                Paragraph("<b>Focus Node</b>", style_cell_bold),
                Paragraph("<b>Property Path</b>", style_cell_bold),
                Paragraph("<b>Violated Constraint Message</b>", style_cell_bold),
                Paragraph("<b>Value</b>", style_cell_bold)
            ]
            viol_rows = [viol_header]
            for v in violations:
                viol_rows.append([
                    Paragraph(v.get("focus_node_short", ""), style_cell),
                    Paragraph(v.get("path_short", ""), style_cell),
                    Paragraph(v.get("message", ""), style_cell),
                    Paragraph(str(v.get("value", "")), style_cell)
                ])
            
            viol_table = Table(viol_rows, colWidths=[130, 100, 210, 100])
            viol_table.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor("#cbd5e1")),
                ('PADDING', (0, 0), (-1, -1), 6),
                ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
                ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, color_bg_light])
            ]))
            story.append(viol_table)
        else:
            story.append(Paragraph("No violations found. The dataset conforms to all validation shapes.", style_cell))
            
        # Build document
        doc.build(story)
        pdf_bytes = buffer.getvalue()
        buffer.close()
        return pdf_bytes
