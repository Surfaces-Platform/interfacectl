/**
 * Serialize to JSON with stable key order (deterministic output).
 * No timestamps or non-deterministic values.
 */
export function stableStringify(value) {
    return JSON.stringify(sortKeys(value), null, 2);
}
function sortKeys(value) {
    if (value === null || typeof value !== "object") {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map(sortKeys);
    }
    const obj = value;
    const keys = Object.keys(obj).sort();
    const out = {};
    for (const k of keys) {
        out[k] = sortKeys(obj[k]);
    }
    return out;
}
