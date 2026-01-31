export interface ContractRef {
    path?: string;
    surfaceId?: string;
    sectionId?: string;
    constraintId?: string;
}
export interface RuleRef {
    id: string;
    version?: string;
}
export interface StableIdParams {
    command: string;
    surfaceId?: string;
    type: string;
    path: string;
    contractRefPath?: string;
    ruleRefId?: string;
    valueHash?: string;
}
/**
 * Compute a deterministic stable identifier for correlation across runs.
 * Same logical diff entry yields same id on any OS/Node version.
 *
 * NOT a globally unique identifier. Use for correlation and deduplication within
 * a repo or CI workflow. 64-bit (16 hex chars). For cross-repo or large-fleet
 * indexing, consider extending to 128 bits in a future phase.
 */
export declare function computeStableId(params: StableIdParams): string;
/**
 * Create a value hash for inclusion in stableId when values distinguish entries.
 */
export declare function hashValues(contractValue?: unknown, observedValue?: unknown): string;
//# sourceMappingURL=stable-id.d.ts.map