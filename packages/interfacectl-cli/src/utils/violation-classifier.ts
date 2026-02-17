import type { DriftViolationType, DiffEntry, Severity } from "@surfaces/interfacectl-validator";
import type { ExitCodeVersion } from "./exit-codes.js";

export type ViolationCategory = "E0" | "E1" | "E2" | "E3";

/**
 * Classify a violation type into E1 (Token Policy) or E2 (Interface Contract).
 * E0 is handled separately in commands (artifact invalid).
 * E3 is determined by severity in diff command (all entries are info).
 */
export function classifyViolationType(
  type: DriftViolationType,
): "E1" | "E2" {
  // E1 (Token Policy violations)
  const e1Types: DriftViolationType[] = [
    "font-not-allowed",
    "color-not-allowed",
    "motion-duration-not-allowed",
    "motion-timing-not-allowed",
  ];

  if (e1Types.includes(type)) {
    return "E1";
  }

  // E2 (Interface Contract violations)
  // All other violation types are E2
  return "E2";
}

/**
 * Get exit code for a violation category and version.
 */
export function getExitCodeForCategory(
  category: ViolationCategory,
  version: ExitCodeVersion,
): number {
  if (version === "v2") {
    switch (category) {
      case "E0":
        return 10;
      case "E1":
        return 20;
      case "E2":
        return 30;
      case "E3":
        return 40;
    }
  } else {
    // v1 (legacy)
    switch (category) {
      case "E0":
        // v1 E0: 2 for validate/enforce, 3 for diff internal errors
        // This is handled per-command, so we return 2 as default
        return 2;
      case "E1":
      case "E2":
        return 1;
      case "E3":
        // E3 does not exist in v1
        // This should not be called for v1, but return 1 as fallback
        return 1;
    }
  }
}

/**
 * Get the maximum severity from diff entries.
 * Returns null if no entries.
 */
export function getMaxSeverity(
  entries: DiffEntry[],
): Severity | null {
  if (entries.length === 0) {
    return null;
  }

  const severities: Severity[] = ["error", "warning", "info"];
  const severityOrder: Record<Severity, number> = {
    error: 3,
    warning: 2,
    info: 1,
  };

  let maxSeverity: Severity | null = null;
  let maxOrder = 0;

  for (const entry of entries) {
    const order = severityOrder[entry.severity];
    if (order > maxOrder) {
      maxOrder = order;
      maxSeverity = entry.severity;
    }
  }

  return maxSeverity;
}
