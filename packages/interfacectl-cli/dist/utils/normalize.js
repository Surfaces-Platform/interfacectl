/**
 * Fields that are set-like (order doesn't matter) and should be sorted
 */
const SET_LIKE_FIELDS = new Set([
    "allowedFonts",
    "allowedColors",
    "requiredSections",
    "requiredContainers",
    "allowedDurationsMs",
    "allowedTimingFunctions",
    "containers",
]);
/**
 * Fields to strip from observed artifacts (ephemeral metadata)
 * Only applied to descriptors, never to contracts
 */
const EPHEMERAL_FIELDS = new Set([
    "source",
    "containerSources",
    "timestamp",
    "buildId",
    "commitHash",
    "_metadata",
]);
/**
 * Sort a set-like array (treats array as a set, sorts for determinism)
 */
export function normalizeSetField(arr) {
    if (!Array.isArray(arr)) {
        return arr;
    }
    // Create a new array to avoid mutating input
    const sorted = [...arr].sort((a, b) => {
        if (typeof a === "string" && typeof b === "string") {
            return a.localeCompare(b);
        }
        const aStr = JSON.stringify(a);
        const bStr = JSON.stringify(b);
        return aStr.localeCompare(bStr);
    });
    return sorted;
}
/**
 * Strip ephemeral fields from an object (only for observed artifacts)
 * Returns a new object without the ephemeral fields
 */
export function stripEphemeralFields(obj, pathPrefix = "", strippedPaths = []) {
    if (obj === null || obj === undefined) {
        return { result: obj, strippedPaths };
    }
    if (typeof obj !== "object") {
        return { result: obj, strippedPaths };
    }
    if (Array.isArray(obj)) {
        const result = [];
        for (let i = 0; i < obj.length; i++) {
            const item = obj[i];
            const itemPath = `${pathPrefix}[${i}]`;
            const { result: normalizedItem, strippedPaths: itemStripped } = stripEphemeralFields(item, itemPath, strippedPaths);
            result.push(normalizedItem);
            strippedPaths = itemStripped;
        }
        return { result, strippedPaths };
    }
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
        const currentPath = pathPrefix ? `${pathPrefix}.${key}` : key;
        if (EPHEMERAL_FIELDS.has(key)) {
            strippedPaths.push(currentPath);
            continue;
        }
        if (typeof value === "object" && value !== null) {
            const { result: normalizedValue, strippedPaths: nestedStripped } = stripEphemeralFields(value, currentPath, strippedPaths);
            result[key] = normalizedValue;
            strippedPaths = nestedStripped;
        }
        else {
            result[key] = value;
        }
    }
    return { result, strippedPaths };
}
/**
 * Normalize a contract to canonical form
 * - Sorts set-like arrays
 * - Does NOT strip ephemeral fields (contracts are source of truth)
 */
export function normalizeContract(contract) {
    const metadata = {
        reorderedPaths: [],
        strippedPaths: [],
    };
    const normalized = {
        ...contract,
        surfaces: contract.surfaces.map((surface, surfaceIdx) => {
            const normalizedSurface = { ...surface };
            // Normalize set-like fields
            if (SET_LIKE_FIELDS.has("requiredSections")) {
                const original = surface.requiredSections;
                const sorted = normalizeSetField(original);
                if (JSON.stringify(original) !== JSON.stringify(sorted)) {
                    metadata.reorderedPaths.push(`surfaces[${surfaceIdx}].requiredSections`);
                    normalizedSurface.requiredSections = sorted;
                }
            }
            if (SET_LIKE_FIELDS.has("allowedFonts")) {
                const original = surface.allowedFonts;
                const sorted = normalizeSetField(original);
                if (JSON.stringify(original) !== JSON.stringify(sorted)) {
                    metadata.reorderedPaths.push(`surfaces[${surfaceIdx}].allowedFonts`);
                    normalizedSurface.allowedFonts = sorted;
                }
            }
            if (SET_LIKE_FIELDS.has("allowedColors")) {
                const original = surface.allowedColors;
                if (original) {
                    const sorted = normalizeSetField(original);
                    if (JSON.stringify(original) !== JSON.stringify(sorted)) {
                        metadata.reorderedPaths.push(`surfaces[${surfaceIdx}].allowedColors`);
                        normalizedSurface.allowedColors = sorted;
                    }
                }
            }
            if (surface.layout.requiredContainers &&
                SET_LIKE_FIELDS.has("requiredContainers")) {
                const original = surface.layout.requiredContainers;
                const sorted = normalizeSetField(original);
                if (JSON.stringify(original) !== JSON.stringify(sorted)) {
                    metadata.reorderedPaths.push(`surfaces[${surfaceIdx}].layout.requiredContainers`);
                    normalizedSurface.layout = {
                        ...surface.layout,
                        requiredContainers: sorted,
                    };
                }
            }
            return normalizedSurface;
        }),
        sections: contract.sections.map((section, sectionIdx) => {
            // Sections are ordered, so we don't sort them
            return { ...section };
        }),
        constraints: {
            motion: {
                allowedDurationsMs: (() => {
                    const original = contract.constraints.motion.allowedDurationsMs;
                    const sorted = normalizeSetField(original);
                    if (JSON.stringify(original) !== JSON.stringify(sorted)) {
                        metadata.reorderedPaths.push("constraints.motion.allowedDurationsMs");
                    }
                    return sorted;
                })(),
                allowedTimingFunctions: (() => {
                    const original = contract.constraints.motion.allowedTimingFunctions;
                    const sorted = normalizeSetField(original);
                    if (JSON.stringify(original) !== JSON.stringify(sorted)) {
                        metadata.reorderedPaths.push("constraints.motion.allowedTimingFunctions");
                    }
                    return sorted;
                })(),
            },
        },
    };
    return {
        contract: normalized,
        metadata,
    };
}
/**
 * Normalize a descriptor to canonical form
 * - Sorts set-like arrays
 * - Strips ephemeral fields (source, containerSources, etc.)
 */
export function normalizeDescriptor(descriptor) {
    const metadata = {
        reorderedPaths: [],
        strippedPaths: [],
    };
    // Strip ephemeral fields first (source fields)
    const { result: stripped, strippedPaths } = stripEphemeralFields(descriptor, `descriptors[${descriptor.surfaceId}]`, []);
    metadata.strippedPaths = strippedPaths;
    const strippedDescriptor = stripped;
    // Normalize set-like arrays
    const normalized = {
        ...strippedDescriptor,
        sections: (() => {
            const original = strippedDescriptor.sections.map((s) => s.id);
            const sorted = normalizeSetField(strippedDescriptor.sections.map((s) => ({ ...s })));
            if (JSON.stringify(original) !== JSON.stringify(sorted.map((s) => s.id))) {
                metadata.reorderedPaths.push(`descriptors[${descriptor.surfaceId}].sections`);
            }
            return sorted;
        })(),
        fonts: (() => {
            const original = strippedDescriptor.fonts.map((f) => f.value);
            const sorted = normalizeSetField(strippedDescriptor.fonts.map((f) => ({ ...f })));
            if (JSON.stringify(original) !== JSON.stringify(sorted.map((f) => f.value))) {
                metadata.reorderedPaths.push(`descriptors[${descriptor.surfaceId}].fonts`);
            }
            return sorted;
        })(),
        colors: (() => {
            const original = strippedDescriptor.colors.map((c) => c.value);
            const sorted = normalizeSetField(strippedDescriptor.colors.map((c) => ({ ...c })));
            if (JSON.stringify(original) !== JSON.stringify(sorted.map((c) => c.value))) {
                metadata.reorderedPaths.push(`descriptors[${descriptor.surfaceId}].colors`);
            }
            return sorted;
        })(),
        layout: {
            ...strippedDescriptor.layout,
            containers: strippedDescriptor.layout.containers
                ? (() => {
                    const original = strippedDescriptor.layout.containers;
                    const sorted = normalizeSetField(original);
                    if (JSON.stringify(original) !== JSON.stringify(sorted)) {
                        metadata.reorderedPaths.push(`descriptors[${descriptor.surfaceId}].layout.containers`);
                    }
                    return sorted;
                })()
                : undefined,
        },
        motion: (() => {
            // Motion descriptors are ordered by duration+timing, but we can sort for determinism
            const sorted = normalizeSetField(strippedDescriptor.motion.map((m) => ({
                ...m,
                // Create a sort key for deterministic ordering
                _sortKey: `${m.durationMs}:${m.timingFunction}`,
            })));
            // Remove the temporary sort key
            return sorted.map(({ _sortKey, ...m }) => m);
        })(),
    };
    return {
        descriptor: normalized,
        metadata,
    };
}
/**
 * Canonicalize JSON for deterministic serialization
 * Sorts keys and ensures consistent formatting
 */
export function canonicalizeJson(value) {
    return JSON.stringify(value, (key, val) => {
        if (val === null || val === undefined) {
            return val;
        }
        if (typeof val === "object" && !Array.isArray(val)) {
            // Sort object keys
            const sorted = {};
            for (const k of Object.keys(val).sort()) {
                sorted[k] = val[k];
            }
            return sorted;
        }
        return val;
    });
}
