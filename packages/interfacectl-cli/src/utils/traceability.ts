import type {
  DiffEntry,
  FixEntry,
  FixError,
  ContractRef,
  RuleRef,
} from "@surfaces/interfacectl-validator";
import { computeStableId, hashValues } from "./stable-id.js";

export interface EnrichedDiffEntry extends DiffEntry {
  stableId: string;
  contractRef?: ContractRef;
  ruleRef?: RuleRef;
}

/**
 * Derive contractRef from a diff entry when deterministically known.
 */
function deriveContractRef(entry: DiffEntry): ContractRef | undefined {
  const path = entry.path ?? "";
  const ref: ContractRef = {};

  if (entry.surfaceId) {
    ref.surfaceId = entry.surfaceId;
  }

  // Path maps to contract when it describes a contract node.
  // Skip when the surface is not in the contract (surface-missing). This is a narrow guard because
  // the contract is not in scope here. Ideal invariant would verify node existence against the contract.
  if (
    (path.startsWith("surfaces/") || path.startsWith("constraints/")) &&
    entry.rule !== "contract.surface-missing"
  ) {
    ref.path = "/" + path.replace(/\./g, "/");
  }

  // sectionId when the entry concerns a section
  if (path.includes("requiredSections") && entry.contractValue !== undefined) {
    ref.sectionId = String(entry.contractValue);
  } else if (path.includes("sections") && entry.observedValue !== undefined) {
    const val = entry.observedValue;
    ref.sectionId =
      typeof val === "object" && val !== null && "id" in val
        ? String((val as { id: unknown }).id)
        : String(val);
  }

  // constraintId for motion
  if (path.includes("motion")) {
    ref.constraintId = "motion";
  }

  if (Object.keys(ref).length === 0) return undefined;
  return ref;
}

/**
 * Enrich a diff entry with stableId, contractRef, and ruleRef.
 */
export function enrichDiffEntry(entry: DiffEntry, command = "diff"): EnrichedDiffEntry {
  const contractRef = deriveContractRef(entry);
  const ruleRef: RuleRef | undefined = entry.rule
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
export function enrichFixEntry(
  fix: FixEntry,
  entry: DiffEntry,
  command = "enforce",
): FixEntry {
  const contractRef = deriveContractRef(entry);
  const ruleRef: RuleRef = { id: fix.ruleId };

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
export function enrichFixError(
  error: FixError,
  command = "enforce",
): FixError {
  const ruleRef: RuleRef = { id: error.ruleId };

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
