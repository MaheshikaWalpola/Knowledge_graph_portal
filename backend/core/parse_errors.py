"""Friendly RDF parse error formatting."""
import re


def friendly_parse_error(raw: str, filename: str | None = None) -> str:
    """Turn a raw rdflib parse exception into a human-readable sentence."""
    fname = filename or "your file"
    raw_lower = raw.lower()

    # Try to extract a line number
    line_match = re.search(r"at line (\d+)", raw)
    line_hint = f" (line {line_match.group(1)})" if line_match else ""

    if "bad syntax" in raw_lower and "prefix" in raw_lower and "not bound" in raw_lower:
        prefix_match = re.search(r'[Pp]refix "([^"]+)"', raw)
        prefix_name = prefix_match.group(1) if prefix_match else "a prefix"
        return (
            f'The namespace prefix "{prefix_name}" is not properly defined in '
            f'"{fname}"{line_hint}. Make sure all @prefix declarations are correct.'
        )

    if "bad syntax" in raw_lower:
        return (
            f'"{fname}" contains invalid syntax{line_hint}. '
            f"Please check the file for formatting errors."
        )

    if "not a valid" in raw_lower or "could not guess" in raw_lower or "plugin" in raw_lower:
        return (
            f'"{fname}" does not appear to be a valid RDF file. '
            f"Supported formats: Turtle (.ttl), RDF/XML (.rdf, .owl), N-Triples (.nt), N3 (.n3)."
        )

    if "encoding" in raw_lower or "utf" in raw_lower or "codec" in raw_lower:
        return (
            f'"{fname}" has encoding issues. '
            f"Please save the file as UTF-8 and try again."
        )

    # Generic fallback
    return (
        f'"{fname}" could not be parsed{line_hint}. '
        f"Please verify it is a valid RDF/Turtle file."
    )
