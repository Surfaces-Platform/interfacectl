import type { DiffEntry, FixEntry, FixError, ContractRef, RuleRef } from "@surfaces/interfacectl-validator";
export interface EnrichedDiffEntry extends DiffEntry {
    stableId: string;
    contractRef?: ContractRef;
    ruleRef?: RuleRef;
}
/**
 * Enrich a diff entry with stableId, contractRef, and ruleRef.
 */
export declare function enrichDiffEntry(entry: DiffEntry, command?: string): EnrichedDiffEntry;
/**
 * Enrich a fix entry with stableId, contractRef, and ruleRef from a diff entry.
 */
export declare function enrichFixEntry(fix: FixEntry, entry: DiffEntry, command?: string): FixEntry;
/**
 * Enrich a fix error with stableId, contractRef, and ruleRef.
 */
export declare function enrichFixError(error: FixError, command?: string): FixError;
//# sourceMappingURL=traceability.d.ts.map