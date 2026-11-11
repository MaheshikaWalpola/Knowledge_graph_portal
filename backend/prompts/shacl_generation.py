"""
The per-rule SHACL generation prompt (one plain-English rule -> one SHACL shape).

PROMPT_VERSION is stored with every generated shape in the generation log, so results can always be
traced to the exact prompt that produced them. Bump it whenever a single character of the prompt
text below changes.
"""
from services.shacl_verifier import SHAPE_STRUCTURE_GUIDE

PROMPT_VERSION = "p3"

SYSTEM_PROMPT = (
    "You are a SHACL code generator. You output only valid Turtle (.ttl) code. "
    "You structure shapes correctly, attach rdfs:label for each rule, and never place sh:path directly inside a sh:NodeShape."
)


def build_user_prompt(rule: str, index: int, prompt_schema: str) -> str:
    """The user message for rule number `index` (0-based) against the compact ontology text `prompt_schema`."""
    clean_rule_str = rule.replace('"', '')
    return (
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
        "   @prefix cmpo: <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo#> .\n"
        "   @prefix inst: <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo/instance/> .\n"
        f"3. Name the shape URI specifically like `inst:Question_{index+1}_Shape` or similar.\n"
        f"4. Include `rdfs:label \"{clean_rule_str}\" ;` on the shape so the exact plain English rule/question is attached to the shape.\n"
        "5. Use only classes and properties that exist in the ontology schema or the standard vocabularies it uses.\n"
        "6. Add a descriptive sh:message matching the rule description.\n\n"
        f"{SHAPE_STRUCTURE_GUIDE}\n"
        f"ONTOLOGY SCHEMA:\n{prompt_schema}"
    )


def render_override(template: str, rule: str, index: int, prompt_schema: str) -> str:
    """
    A caller-supplied prompt (experiment runs with a foreign benchmark prompt). The placeholders
    {rule}, {schema} and {index} are filled in if present; otherwise the text is sent as it is.
    """
    return (template.replace("{rule}", rule)
                    .replace("{schema}", prompt_schema)
                    .replace("{index}", str(index + 1)))
