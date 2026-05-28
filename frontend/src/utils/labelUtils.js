// ========================================
// Label Utilities
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

// ============================================================
// 📊 Semantic Chart Detection
// Mirrors the backend _classify_predicate_semantics logic.
// Used to guard whether numeric values are real measurements.
// ============================================================

/**
 * Keywords whose presence in a predicate local-name (lowercase)
 * strongly signals it is an IDENTIFIER / non-measurement value.
 */
const SKIP_PRED_FRAGMENTS = new Set([
  // Primary identifiers
  "id", "identifier", "uuid", "guid", "key", "code",
  // Row / index tracking
  "index", "indexvalue", "rowid", "row", "syntheticrowid",
  // Domain-specific IDs
  "waferid", "usageid", "usagetype", "usagecount",
  // Ordinal / enumeration
  "number", "num", "no", "seq", "sequence", "position", "rank", "order",
  // Categorical / structural
  "flag", "enabled", "active", "status", "state", "kind", "mode",
  "category", "class", "group", "label", "name", "title", "tag",
  // Temporal (not physical measurements)
  "timestamp", "datetime", "date", "time", "epoch", "duration",
  "year", "month", "day",
  // Boolean-like
  "isnull", "isempty", "isvalid", "isactive",
  // Version / revision / hash
  "version", "revision", "build", "hash", "checksum", "crc",
]);

/**
 * Keywords whose presence in a predicate local-name (lowercase)
 * positively signals a continuous MEASUREMENT value suitable for charting.
 */
const MEASUREMENT_PRED_SIGNALS = new Set([
  // Generic measurement vocabulary
  "value", "measurement", "reading", "sample", "observation",
  "datum", "data", "record", "signal", "trace",
  // Physical quantities
  "pressure", "temperature", "velocity", "speed", "flow", "flux",
  "force", "torque", "power", "energy", "current", "voltage", "resistance",
  "frequency", "amplitude", "magnitude", "intensity",
  "acceleration", "displacement", "distance", "length", "width", "height",
  "mass", "weight", "density", "volume", "concentration",
  "humidity", "conductivity", "viscosity", "load",
  // Rate / level / amount
  "rate", "level", "amount", "quantity", "ratio", "fraction",
  "delta", "diff", "change", "deviation", "error", "noise",
  // Dimension / geometry
  "angle", "radius", "diameter", "area",
  // Time-series numeric markers
  "elapsed", "interval", "latency", "period", "cycle",
  // Sensor / instrumentation
  "sensor", "output", "input", "channel", "threshold", "limit", "setpoint",
]);

/**
 * Determine whether a predicate IRI / label represents a real measurement.
 *
 * Logic (mirrors backend _classify_predicate_semantics):
 *   1. If backend already sent `is_measurement: true` → trust it.
 *   2. Otherwise: check local-name against skip list (→ false)
 *   3. Check local-name against measurement signal list (→ true)
 *   4. Default: false (conservative — do not chart unknown predicates)
 *
 * @param {object} opts
 * @param {boolean} [opts.backendFlag]   - Value of `is_measurement` from API response
 * @param {string}  [opts.predicateIri]  - Full predicate IRI (uses local name)
 * @param {string}  [opts.label]         - Human-readable label / group label
 * @returns {boolean}
 */
export const isMeasurementPredicate = ({
  backendFlag = undefined,
  predicateIri = "",
  label = "",
} = {}) => {
  // Backend already classified it
  if (backendFlag === true) return true;
  if (backendFlag === false) return false;

  // Extract local name from IRI or use label
  const local = (predicateIri
    ? getLocalName(predicateIri)
    : label
  ).toLowerCase().replace(/[_\s-]+/g, "");

  if (!local) return false;

  // Exclusion rules first (conservative)
  for (const skip of SKIP_PRED_FRAGMENTS) {
    if (local === skip || local.endsWith(skip) || local.startsWith(skip)) {
      return false;
    }
  }

  // Positive signals
  for (const sig of MEASUREMENT_PRED_SIGNALS) {
    if (local.includes(sig)) return true;
  }

  // Default: unknown — do not chart
  return false;
};

/**
 * Given an array of raw values and metadata about their source predicate,
 * return only the numeric values if the predicate is a real measurement.
 * Returns null when the predicate is not a measurement.
 *
 * @param {Array}   rawValues     - Array of values (strings or numbers)
 * @param {object}  predicateMeta - { backendFlag?, predicateIri?, label? }
 * @returns {number[]|null}
 */
export const getMeasurementValues = (rawValues = [], predicateMeta = {}) => {
  if (!Array.isArray(rawValues) || rawValues.length === 0) return null;
  if (!isMeasurementPredicate(predicateMeta)) return null;

  const nums = rawValues.map(Number).filter(Number.isFinite);
  return nums.length > 0 ? nums : null;
};

/**
 * Pick at most `n` values evenly distributed across the full array.
 * Guarantees the first and last values are always included, and
 * intermediate values are stride-sampled.
 */
export const strideSample = (arr, n) => {
  if (!arr || arr.length === 0) return [];
  if (arr.length <= n) return arr;
  const result = [];
  const step = (arr.length - 1) / (n - 1);
  for (let i = 0; i < n; i++) {
    result.push(arr[Math.round(i * step)]);
  }
  return result;
};

export default {
  camelToReadable,
  camelToTitleCase,
  getPredicateDisplay,
  formatNodeLabel,
  getLocalName,
  PREDICATE_DISPLAY,
  isMeasurementPredicate,
  getMeasurementValues,
  strideSample,
};
