import { computeStableId, hashValues } from "./stable-id.js";
/**
 * Derive contractRef from a diff entry when deterministically known.
 */
function deriveContractRef(entry) {
    const path = entry.path ?? "";
    const ref = {};
    if (entry.surfaceId) {
        ref.surfaceId = entry.surfaceId;
    }
    // Path maps to contract when it describes a contract node.
    // Skip when the surface is not in the contract (surface-missing). This is a narrow guard because
    // the contract is not in scope here. Ideal invariant would verify node existence against the contract.
    if ((path.startsWith("surfaces/") || path.startsWith("constraints/")) &&
        entry.rule !== "contract.surface-missing") {
        ref.path = "/" + path.replace(/\./g, "/");
    }
    // sectionId when the entry concerns a section
    if (path.includes("requiredSections") && entry.contractValue !== undefined) {
        ref.sectionId = String(entry.contractValue);
    }
    else if (path.includes("sections") && entry.observedValue !== undefined) {
        const val = entry.observedValue;
        ref.sectionId =
            typeof val === "object" && val !== null && "id" in val
                ? String(val.id)
                : String(val);
    }
    // constraintId for motion
    if (path.includes("motion")) {
        ref.constraintId = "motion";
    }
    if (Object.keys(ref).length === 0)
        return undefined;
    return ref;
}
/**
 * Enrich a diff entry with stableId, contractRef, and ruleRef.
 */
export function enrichDiffEntry(entry, command = "diff") {
    const contractRef = deriveContractRef(entry);
    const ruleRef = entry.rule
        ? { id: entry.rule }
        : undefined;
    const valueHash = hashValues(entry.contractValue, entry.observedValue);
    const stableId = computeStableId({
        command,
        surfaceId: entry.surfaceId,
        type: entry.type,
        path: entry.path,
        contractRefPath: contractRef?.path,
        ruleRefId: ruleRef?.id,
        valueHash: valueHash || undefined,
    });
    return {
        ...entry,
        stableId,
        ...(contractRef && Object.keys(contractRef).length > 0 ? { contractRef } : {}),
        ...(ruleRef ? { ruleRef } : {}),
    };
}
/**
 * Enrich a fix entry with stableId, contractRef, and ruleRef from a diff entry.
 */
export function enrichFixEntry(fix, entry, command = "enforce") {
    const contractRef = deriveContractRef(entry);
    const ruleRef = { id: fix.ruleId };
    const valueHash = hashValues(fix.oldValue, fix.newValue);
    const stableId = computeStableId({
        command,
        surfaceId: entry.surfaceId,
        type: "fix",
        path: fix.path,
        contractRefPath: contractRef?.path,
        ruleRefId: ruleRef.id,
        valueHash: valueHash || undefined,
    });
    return {
        ...fix,
        stableId,
        ...(contractRef && Object.keys(contractRef).length > 0 ? { contractRef } : {}),
        ruleRef,
    };
}
/**
 * Enrich a fix error with stableId, contractRef, and ruleRef.
 */
export function enrichFixError(error, command = "enforce") {
    const ruleRef = { id: error.ruleId };
    const stableId = computeStableId({
        command,
        type: "error",
        path: error.path,
        ruleRefId: ruleRef.id,
    });
    return {
        ...error,
        stableId,
        ruleRef,
    };
}
