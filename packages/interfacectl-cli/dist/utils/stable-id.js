import { createHash } from "node:crypto";
/**
 * Normalize a path for deterministic hashing.
 * Uses forward slashes and collapses repeated slashes.
 */
function normalizePath(p) {
    if (p === undefined || p === null)
        return "";
    return String(p)
        .replace(/\\/g, "/")
        .replace(/\/+/g, "/")
        .replace(/^\//, "")
        .replace(/\/$/, "");
}
/**
 * Produce a deterministic JSON string for values.
 * Sorts object keys to ensure same logical value yields same string.
 */
function normalizeValue(value) {
    if (value === undefined)
        return "";
    if (value === null)
        return "null";
    if (typeof value === "string")
        return JSON.stringify(value);
    if (typeof value === "number")
        return String(value);
    if (typeof value === "boolean")
        return String(value);
    if (Array.isArray(value)) {
        return "[" + value.map(normalizeValue).join(",") + "]";
    }
    if (typeof value === "object") {
        const keys = Object.keys(value).sort();
        const pairs = keys.map((k) => JSON.stringify(k) + ":" + normalizeValue(value[k]));
        return "{" + pairs.join(",") + "}";
    }
    return String(value);
}
/**
 * Compute a deterministic stable identifier for correlation across runs.
 * Same logical diff entry yields same id on any OS/Node version.
 *
 * NOT a globally unique identifier. Use for correlation and deduplication within
 * a repo or CI workflow. 64-bit (16 hex chars). For cross-repo or large-fleet
 * indexing, consider extending to 128 bits in a future phase.
 */
export function computeStableId(params) {
    const parts = [
        normalizePath(params.command),
        normalizePath(params.surfaceId ?? ""),
        normalizePath(params.type),
        normalizePath(params.path),
        normalizePath(params.contractRefPath ?? ""),
        normalizePath(params.ruleRefId ?? ""),
        params.valueHash ?? "",
    ];
    const input = parts.join("\0");
    const hash = createHash("sha256").update(input, "utf8").digest("hex");
    return hash.slice(0, 16);
}
/**
 * Create a value hash for inclusion in stableId when values distinguish entries.
 */
export function hashValues(contractValue, observedValue) {
    const combined = normalizeValue(contractValue) + "\0" + normalizeValue(observedValue);
    if (!combined || combined === "\0")
        return "";
    return createHash("sha256").update(combined, "utf8").digest("hex").slice(0, 8);
}
