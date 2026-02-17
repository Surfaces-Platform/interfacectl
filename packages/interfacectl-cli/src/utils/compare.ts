import type {
  InterfaceContract,
  ContractSurface,
  SurfaceDescriptor,
  DiffEntry,
  DiffChangeType,
  Severity,
} from "@surfaces/interfacectl-validator";
import { normalizeColorValue } from "@surfaces/interfacectl-validator";
import type { NormalizedContract, NormalizedDescriptor } from "./normalize.js";

/**
 * Build a stable JSON Pointer-style path
 */
export function buildDiffPath(
  prefix: string,
  field: string,
  index?: number,
): string {
  if (index !== undefined) {
    return `${prefix}/${field}/${index}`;
  }
  return prefix ? `${prefix}/${field}` : field;
}

/**
 * Calculate string similarity using Levenshtein distance ratio
 * Returns a value between 0 and 1, where 1 is identical
 */
function stringSimilarity(a: string, b: string): number {
  if (a === b) return 1.0;
  if (a.length === 0 || b.length === 0) return 0.0;

  const maxLen = Math.max(a.length, b.length);
  const distance = levenshteinDistance(a, b);
  return 1 - distance / maxLen;
}

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j] + 1, // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Classify a change based on contract and observed values
 */
export function classifyChange(
  contractVal: unknown,
  observedVal: unknown,
): DiffChangeType {
  if (contractVal === undefined && observedVal !== undefined) {
    return "added";
  }
  if (contractVal !== undefined && observedVal === undefined) {
    return "removed";
  }
  if (contractVal !== undefined && observedVal !== undefined) {
    const contractStr = JSON.stringify(contractVal);
    const observedStr = JSON.stringify(observedVal);
    if (contractStr !== observedStr) {
      return "modified";
    }
  }
  // Should not reach here in practice, but handle gracefully
  return "modified";
}

/**
 * Detect potential renames by comparing old and new paths/IDs
 * Returns pairs with confidence scores
 */
export function detectRename(
  oldPaths: string[],
  newPaths: string[],
  threshold: number = 0.8,
): Array<{ old: string; new: string; confidence: number }> {
  const results: Array<{ old: string; new: string; confidence: number }> = [];
  const usedNewPaths = new Set<string>();

  for (const oldPath of oldPaths) {
    let bestMatch: { path: string; confidence: number } | null = null;

    for (const newPath of newPaths) {
      if (usedNewPaths.has(newPath)) {
        continue;
      }

      const similarity = stringSimilarity(oldPath, newPath);
      if (similarity >= threshold) {
        if (!bestMatch || similarity > bestMatch.confidence) {
          bestMatch = { path: newPath, confidence: similarity };
        }
      }
    }

    if (bestMatch) {
      results.push({
        old: oldPath,
        new: bestMatch.path,
        confidence: bestMatch.confidence,
      });
      usedNewPaths.add(bestMatch.path);
    }
  }

  return results;
}

/**
 * Determine severity based on violation type and context
 */
function determineSeverity(
  changeType: DiffChangeType,
  path: string,
  surface: ContractSurface,
): Severity {
  // Missing required sections are errors
  if (path.includes("requiredSections") && changeType === "removed") {
    return "error";
  }

  // Unknown sections are warnings (they exist but aren't in contract)
  if (path.includes("sections") && changeType === "added") {
    return "warning";
  }

  // Font/color violations are errors (design system constraints)
  if (path.includes("allowedFonts") || path.includes("color/allowedValues")) {
    return "error";
  }

  // Layout width exceeded is error
  if (path.includes("maxContentWidth") && changeType === "modified") {
    return "error";
  }

  // Layout width undetermined is warning
  if (path.includes("maxContentWidth") && changeType === "removed") {
    return "warning";
  }

  // Missing containers are errors if required
  if (path.includes("requiredContainers") && changeType === "removed") {
    return "error";
  }

  // Motion violations are warnings (less critical)
  if (path.includes("motion")) {
    return "warning";
  }

  // Default to warning for unknown cases
  return "warning";
}

/**
 * Compare a normalized contract against a normalized descriptor for a specific surface
 */
export function compareContractToDescriptor(
  contract: NormalizedContract,
  descriptor: NormalizedDescriptor,
  surfaceId: string,
): DiffEntry[] {
  const entries: DiffEntry[] = [];
  const surface = contract.contract.surfaces.find((s) => s.id === surfaceId);

  if (!surface) {
    entries.push({
      surfaceId,
      type: "added",
      path: `surfaces/${surfaceId}`,
      observedValue: descriptor.descriptor,
      severity: "error",
      rule: "contract.surface-missing",
    });
    return entries;
  }

  const desc = descriptor.descriptor;

  // Compare required sections
  const contractSections = new Set(surface.requiredSections);
  const observedSections = new Set(desc.sections.map((s) => s.id));

  // Check for missing required sections
  for (const requiredSection of surface.requiredSections) {
    if (!observedSections.has(requiredSection)) {
      entries.push({
        surfaceId,
        type: "removed",
        path: buildDiffPath(`surfaces/${surfaceId}`, "requiredSections"),
        contractValue: requiredSection,
        severity: "error",
        rule: `contract.surfaces[${surfaceId}].requiredSections`,
      });
    }
  }

  // Check for unknown sections (present in descriptor but not in contract)
  for (const observedSection of desc.sections) {
    const contractSectionExists = contract.contract.sections.some(
      (s) => s.id === observedSection.id,
    );
    if (!contractSectionExists) {
      entries.push({
        surfaceId,
        type: "added",
        path: buildDiffPath(`surfaces/${surfaceId}`, "sections"),
        observedValue: observedSection.id,
        severity: "warning",
        rule: "contract.sections.unknown",
      });
    }
  }

  // Compare allowed fonts
  const contractFonts = new Set(surface.allowedFonts);
  for (const font of desc.fonts) {
    if (!contractFonts.has(font.value)) {
      entries.push({
        surfaceId,
        type: "added",
        path: buildDiffPath(`surfaces/${surfaceId}`, "allowedFonts"),
        observedValue: font.value,
        severity: "error",
        rule: `contract.surfaces[${surfaceId}].allowedFonts`,
      });
    }
  }

  // Compare allowed colors
  const contractColors = new Set(contract.contract.color.allowedValues);
  for (const color of desc.colors) {
    const normalizedColor = normalizeColorValue(color.value);
    if (!contractColors.has(normalizedColor)) {
      entries.push({
        surfaceId,
        type: "added",
        path: "color/allowedValues",
        observedValue: normalizedColor,
        severity: "error",
        rule: "contract.color.allowedValues",
      });
    }
  }

  // Compare layout maxContentWidth
  const contractWidth = surface.layout.maxContentWidth;
  const observedWidth = desc.layout.maxContentWidth;

  if (observedWidth === null || observedWidth === undefined) {
    entries.push({
      surfaceId,
      type: "removed",
      path: buildDiffPath(`surfaces/${surfaceId}`, "layout.maxContentWidth"),
      contractValue: contractWidth,
      severity: "warning",
      rule: `contract.surfaces[${surfaceId}].layout.maxContentWidth`,
    });
  } else if (observedWidth > contractWidth) {
    entries.push({
      surfaceId,
      type: "modified",
      path: buildDiffPath(`surfaces/${surfaceId}`, "layout.maxContentWidth"),
      contractValue: contractWidth,
      observedValue: observedWidth,
      severity: "error",
      rule: `contract.surfaces[${surfaceId}].layout.maxContentWidth`,
    });
  }

  // Compare required containers
  const requiredContainers = surface.layout.requiredContainers ?? [
    "contract-container",
  ];
  const observedContainers = new Set(desc.layout.containers ?? []);

  for (const requiredContainer of requiredContainers) {
    if (!observedContainers.has(requiredContainer)) {
      entries.push({
        surfaceId,
        type: "removed",
        path: buildDiffPath(
          `surfaces/${surfaceId}`,
          "layout.requiredContainers",
        ),
        contractValue: requiredContainer,
        severity: "error",
        rule: `contract.surfaces[${surfaceId}].layout.requiredContainers`,
      });
    }
  }

  // Compare motion constraints
  const allowedDurations = new Set(
    contract.contract.constraints.motion.allowedDurationsMs,
  );
  const allowedTimingFunctions = new Set(
    contract.contract.constraints.motion.allowedTimingFunctions,
  );

  for (const motion of desc.motion) {
    if (!allowedDurations.has(motion.durationMs)) {
      entries.push({
        surfaceId,
        type: "added",
        path: buildDiffPath(`surfaces/${surfaceId}`, "motion.durationMs"),
        observedValue: motion.durationMs,
        severity: "warning",
        rule: "contract.constraints.motion.allowedDurationsMs",
      });
    }

    if (!allowedTimingFunctions.has(motion.timingFunction)) {
      entries.push({
        surfaceId,
        type: "added",
        path: buildDiffPath(
          `surfaces/${surfaceId}`,
          "motion.timingFunction",
        ),
        observedValue: motion.timingFunction,
        severity: "warning",
        rule: "contract.constraints.motion.allowedTimingFunctions",
      });
    }
  }

  return entries;
}
