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

    def suggest_validation_rules(self, user_explanation: Optional[str] = None, schema_content: Optional[str] = None) -> List[str]:
        """
        Uses Kiste LLM to suggest 10 data validation rules in plain English based on the ontology schema.
        """
        schema_text = schema_content or "No schema provided. Suggest general CMP (Chemical Mechanical Planarization) validation rules."
        explanation = user_explanation or "General CMP data validation."
        
        prompt = (
            "You are a Senior Data Quality and Process Engineer in semiconductor manufacturing. "
            "Your task is to analyze the provided RDF/OWL Ontology Schema for CMP (Chemical Mechanical Planarization) "
            "and suggest exactly 10 highly relevant data quality rules in plain English.\n\n"
            f"User's Goals/Context: {explanation}\n\n"
            "Guidelines:\n"
            "- Suggest exactly 10 rules.\n"
            "- Express rules in clear, direct English, like:\n"
            "  'Every CMP process must have a start timestamp'\n"
            "  'Pressure must be a positive float value'\n"
            "  'Slurry flow rates should not be negative'\n"
            "  'Polishing pad age must be a positive integer'\n"
            "- Tailor the rules to classes and properties in the schema.\n"
            "- Output EXACTLY a JSON object with this key structure: {\"rules\": [\"rule 1\", ..., \"rule 10\"]}.\n"
            "- DO NOT return any explanatory text or markdown code blocks outside of the JSON.\n\n"
            f"SCHEMA CONTEXT:\n{schema_text}"
        )
        
        messages = [
            {"role": "system", "content": "You are a SPARQL/SHACL validation rules assistant. You output only structured JSON."},
            {"role": "user", "content": prompt}
        ]
        
        try:
            # We call the Kiste API using the JSON output mode
            response = self.llm._call_kiste(messages, json_mode=True, temperature=0.2)
            data = json.loads(response)
            rules = data.get("rules", [])
            if len(rules) < 10:
                # Pad to 10 if necessary
                rules.extend(["Pressure value must be a positive float" for _ in range(10 - len(rules))])
            return rules[:10]
        except Exception as e:
            print(f"Error suggesting rules: {e}")
            # Fallback default rules
            return [
                "Every CMP process must have a measurement timestamp.",
                "Every CMP process must act on at least one Wafer.",
                "Every CMP process must specify the Chamber used.",
                "Pressure parameter values must be positive floats.",
                "Stage/platen rotation speeds must be non-negative.",
                "Slurry flow rates must be non-negative.",
                "Slurry pH must be a float between 1.0 and 14.0.",
                "Polishing pad age must be a non-negative integer.",
                "Every wafer must have a wafer material specified.",
                "Lot size must be a positive integer."
            ]

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
            "Instructions:\n"
            "1. Output ONLY valid Turtle syntax. Do NOT write any explanations, markdown code fences, or text before/after the Turtle.\n"
            "2. Define common prefixes: \n"
            "   @prefix sh: <http://www.w3.org/ns/shacl#> .\n"
            "   @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\n"
            "   @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .\n"
            "   @prefix cmpo: <https://tucid/cpmo/> .\n"
            "   @prefix inst: <https://tucid/cpmo/instance/> .\n"
            "3. Target correct classes. For example, if a rule applies to pressure parameter values, use sh:targetClass cmpo:Pressure, and check sh:path cmpo:hasNumericValue.\n"
            "4. Add descriptive sh:message strings matching the rule descriptions.\n\n"
            f"ONTOLOGY SCHEMA:\n{schema_text}"
        )
        
        messages = [
            {"role": "system", "content": "You are a SHACL code generator. You output only valid Turtle (.ttl) code without markdown wrappers or conversational text."},
            {"role": "user", "content": prompt}
        ]
        
        try:
            response = self.llm._call_kiste(messages, json_mode=False, temperature=0.1)
            # Remove any markdown wrappers if the model didn't follow instructions
            clean_ttl = re.sub(r"^```[a-zA-Z]*\n", "", response)
            clean_ttl = re.sub(r"```$", "", clean_ttl.strip())
            return clean_ttl.strip()
        except Exception as e:
            print(f"Error generating SHACL shapes: {e}")
            # Return default shapes from file
            default_path = r"d:\Masters\KG_Portal\Knowledge_graph_portal\backend\ontology\default_shapes.ttl"
            if os.path.exists(default_path):
                with open(default_path, "r", encoding="utf-8") as f:
                    return f.read()
            return "@prefix sh: <http://www.w3.org/ns/shacl#> .\n# Failed to generate shapes."

    def validate_rdf(self, data_ttl: str, shapes_ttl: str, schema_ttl: Optional[str] = None) -> Dict[str, Any]:
        """
        Validates the data turtle against the SHACL shapes using pyshacl.
        Merges schema_ttl into the data graph if provided.
        """
        try:
            g_data = Graph()
            g_data.parse(data=data_ttl, format="turtle")
            
            g_shapes = Graph()
            g_shapes.parse(data=shapes_ttl, format="turtle")
            
            # Combine schema and data for subclass reasoning
            g_combined = g_data
            if schema_ttl:
                g_schema = Graph()
                g_schema.parse(data=schema_ttl, format="turtle")
                g_combined = g_data + g_schema
                
            conforms, results_graph, results_text = validate(
                g_combined,
                shacl_graph=g_shapes,
                inference="rdfs",
                serialize_results_format="turtle"
            )
            
            # Parse violations
            SH = Namespace("http://www.w3.org/ns/shacl#")
            violations = []
            
            # Track which source shapes violated constraints
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
                
            # Now, attempt to list all shapes and mark them as Passed if not violated
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
                
            return {
                "conforms": conforms,
                "total_triples": len(g_data),
                "total_violations": len(violations),
                "rules": all_shapes,
                "violations": violations
            }
            
        except Exception as e:
            print(f"Error in SHACL validation: {e}")
            import traceback
            traceback.print_exc()
            return {
                "conforms": False,
                "error": str(e),
                "total_violations": 0,
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
