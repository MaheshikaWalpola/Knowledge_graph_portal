// ========================================
// 🏷️ Label Utilities
// Convert CamelCase to readable format
// ========================================

/**
 * Converts CamelCase or PascalCase to human-readable format
 * e.g., "InnerTubePressure" → "Inner Tube Pressure"
 * e.g., "subClassOf" → "subclass of"
 */
export const camelToReadable = (str = "") => {
  if (!str) return "";

  // Insert space before capital letters and handle consecutive caps
  return str
    .replace(/([a-z])([A-Z])/g, "$1 $2") // lowercase followed by uppercase
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2") // consecutive uppercase followed by proper case
    .replace(/([a-z])(\d)/g, "$1 $2") // letter followed by number
    .replace(/(\d)([a-zA-Z])/g, "$1 $2") // number followed by letter
    .trim();
};

/**
 * Converts CamelCase to Title Case readable format
 * e.g., "innerTubePressure" → "Inner Tube Pressure"
 */
export const camelToTitleCase = (str = "") => {
  if (!str) return "";
  const readable = camelToReadable(str);
  return readable
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
};

/**
 * Maps RDF predicates to mathematical symbols and readable names
 */
export const PREDICATE_DISPLAY = {
  subClassOf: { symbol: "⊆", name: "is subclass of" },
  "rdfs:subClassOf": { symbol: "⊆", name: "is subclass of" },
  subclass: { symbol: "⊆", name: "is subclass of" },
  hasInputParameter: { symbol: "←", name: "input" },
  hasOutputParameter: { symbol: "→", name: "output" },
  type: { symbol: "∈", name: "is type of" },
  "rdf:type": { symbol: "∈", name: "is type of" },
  sameAs: { symbol: "≡", name: "same as" },
  equivalentClass: { symbol: "≡", name: "equivalent to" },
  differentFrom: { symbol: "≠", name: "different from" },
  domain: { symbol: "⊂", name: "domain" },
  range: { symbol: "⊃", name: "range" },
  inverseOf: { symbol: "⇔", name: "inverse of" },
  hasPart: { symbol: "◇", name: "has part" },
  partOf: { symbol: "◆", name: "part of" },
  hasValue: { symbol: "=", name: "has value" },
};

/**
 * Get the display info for a predicate
 * Returns { symbol, name, readable }
 */
export const getPredicateDisplay = (predicate = "") => {
  const local = predicate.split("#").pop().split("/").pop();

  // Check if we have a known predicate
  const known = PREDICATE_DISPLAY[local] || PREDICATE_DISPLAY[predicate];

  if (known) {
    return {
      symbol: known.symbol,
      name: known.name,
      readable: `${known.symbol} ${known.name}`,
      original: local,
    };
  }

  // Default: convert to readable format
  return {
    symbol: "→",
    name: camelToReadable(local).toLowerCase(),
    readable: camelToReadable(local).toLowerCase(),
    original: local,
  };
};

/**
 * Format a node label for display
 * Handles both IRIs and plain labels
 */
export const formatNodeLabel = (iriOrLabel = "") => {
  if (!iriOrLabel) return "";

  // Extract local name from IRI
  const local = iriOrLabel.split("#").pop().split("/").pop();

  // Convert CamelCase to readable
  return camelToTitleCase(local);
};

/**
 * Get the local name from an IRI
 */
export const getLocalName = (iri = "") => {
  return (iri || "").split("#").pop().split("/").pop();
};

export default {
  camelToReadable,
  camelToTitleCase,
  getPredicateDisplay,
  formatNodeLabel,
  getLocalName,
  PREDICATE_DISPLAY,
};
