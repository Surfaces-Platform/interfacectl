export type SurfaceType = "web" | "cli";

export interface PageFrameLayout {
  containerSelector: string;
  containerMaxWidthPx: number;
  paddingXpx: number;
  alignment?: "center" | "left";
  enforcement?: "strict" | "warn";
}

export interface ContractSurface {
  id: string;
  displayName: string;
  type: SurfaceType;
  requiredSections: string[];
  allowedFonts: string[];
  layout: {
    maxContentWidth: number;
    requiredContainers?: string[];
    pageFrame?: PageFrameLayout;
  };
  icons?: IconPolicy;
  mustNotEmit?: string[];
  shellOwnedPrimitiveAllowSources?: string[];
}

export interface ContractSection {
  id: string;
  intent: string;
  description: string;
}

export interface ContractConstraints {
  motion: {
    allowedDurationsMs: number[];
    allowedTimingFunctions: string[];
  };
}

export interface ShellSpec {
  owns?: string[];
  contentSlot?: string;
}

export interface ColorPolicy {
  policy: "off" | "warn" | "strict";
  allowedValues: string[];
}

export interface IconPolicy {
  policy: "off" | "warn" | "strict";
  allowedSources: string[];
}

export interface InterfaceContract {
  contractId: string;
  version: string;
  description?: string;
  surfaces: ContractSurface[];
  sections: ContractSection[];
  constraints: ContractConstraints;
  color: ColorPolicy;
  x_extracted?: {
    routes?: string[];
    hasShell?: boolean;
    designSystemComponents?: string[];
    authAware?: boolean;
    iconSources?: string[];
    [key: string]: unknown;
  };
  shell?: ShellSpec;
}

export interface SurfaceSectionDescriptor {
  id: string;
  source?: string;
}

export interface SurfaceFontDescriptor {
  value: string;
  source?: string;
}

export interface SurfaceColorDescriptor {
  value: string;
  source?: string;
}

export interface SurfaceIconDescriptor {
  value: string;
  source?: string;
}

export interface SurfaceMotionDescriptor {
  durationMs: number;
  timingFunction: string;
  source?: string;
}

export interface SurfacePrimitiveDescriptor {
  role: string;
  count: number;
  sources?: string[];
}

export interface PageFrameLayoutDescriptor {
  containerSelector: string;
  maxWidthPx?: number | null;
  paddingLeftPx?: number | null;
  paddingRightPx?: number | null;
  source?: string;
  maxWidthHasClampCalc?: boolean;
  paddingHasClampCalc?: boolean;
}

export interface SurfaceLayoutDescriptor {
  maxContentWidth?: number | null;
  containers?: string[];
  containerSources?: string[];
  source?: string;
  pageFrame?: PageFrameLayoutDescriptor;
}

export interface SurfaceDescriptor {
  surfaceId: string;
  sections: SurfaceSectionDescriptor[];
  fonts: SurfaceFontDescriptor[];
  colors: SurfaceColorDescriptor[];
  icons?: SurfaceIconDescriptor[];
  layout: SurfaceLayoutDescriptor;
  motion: SurfaceMotionDescriptor[];
  primitives?: SurfacePrimitiveDescriptor[];
}

export type DriftViolationType =
  | "unknown-surface"
  | "missing-section"
  | "unknown-section"
  | "font-not-allowed"
  | "color-not-allowed"
  | "icon-source-not-allowed"
  | "layout-width-exceeded"
  | "layout-width-undetermined"
  | "layout-container-missing"
  | "layout-pageframe-selector-unsupported"
  | "layout-pageframe-container-not-found"
  | "layout-pageframe-maxwidth-mismatch"
  | "layout-pageframe-padding-mismatch"
  | "layout-pageframe-non-deterministic-value"
  | "layout-pageframe-unextractable-value"
  | "motion-duration-not-allowed"
  | "motion-timing-not-allowed"
  | "descriptor-missing"
  | "descriptor-unused"
  | "shell-owned-primitive-emitted";

export interface DriftViolation {
  surfaceId: string;
  type: DriftViolationType;
  message: string;
  details?: Record<string, unknown>;
}

export interface SurfaceReport {
  surfaceId: string;
  violations: DriftViolation[];
}

export interface ValidationSummary {
  contract: InterfaceContract;
  surfaceReports: SurfaceReport[];
}

// Diff and enforce types

export type DiffChangeType = "added" | "removed" | "modified" | "renamed";
export type Severity = "error" | "warning" | "info";
export type SafetyLevel = "safe" | "mechanical" | "semantic";
export type EnforcementMode = "fail" | "fix" | "pr";

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

export interface DiffEntry {
  surfaceId?: string;
  type: DiffChangeType;
  path: string; // JSON Pointer or dot-path, must be stable
  contractValue?: unknown;
  observedValue?: unknown;
  severity: Severity;
  rule?: string; // Contract clause or rule ID (required for semantic clarity)
  autofixable?: boolean; // Only true when policy rule allows safe/mechanical autofix
  rename?: {
    fromPath: string;
    toPath: string;
    confidence: number; // 0-1
  }; // Only present when type=renamed
  /** Deterministic id for correlation across runs (Phase 2 traceability) */
  stableId?: string;
  /** Reference to contract structure when deterministically derivable */
  contractRef?: ContractRef;
  /** Reference to the rule that produced this entry */
  ruleRef?: RuleRef;
}

export interface DriftRisk {
  category:
    | "diff-noise"
    | "semantic-ambiguity"
    | "enforcement-overreach"
    | "policy-drift"
    | "contract-evolution"
    | "observed-instability"
    | "rename-inflation"
    | "output-schema-drift"
    | "severity-inflation"
    | "local-ci-mismatch";
  severity: Severity;
  message: string;
  relatedPaths?: string[];
}

export interface DiffOutput {
  schemaVersion: string; // e.g., "1.0.0"
  tool: { name: "interfacectl"; version: string };
  policy?: { version: string; fingerprint: string };
  contract: { path: string; version: string };
  observed: { root: string; captureProfile?: Record<string, unknown> };
  normalization: {
    enabled: boolean;
    reorderedPaths: string[];
    strippedPaths: string[];
  };
  summary: {
    totalChanges: number;
    byType: { added: number; removed: number; modified: number; renamed: number };
    bySeverity: { error: number; warning: number; info: number };
  };
  entries: DiffEntry[]; // Deterministically sorted: surfaceId asc, path asc, type asc
  driftRisks?: DriftRisk[];
  repro?: { command: string };
}

export interface AutofixRule {
  id: string;
  pattern: string; // JSONPath/glob pattern, must be documented
  autofixable: boolean;
  description: string;
  safetyLevel: SafetyLevel; // Only safe/mechanical if autofixable=true
  setSeverity?: Severity; // Optional override for matching diffs
}

export interface EnforcementPolicy {
  version: string;
  fingerprint: string; // SHA-256 hash of canonicalized JSON
  extends?: string; // Optional base policy preset
  modes: {
    fail: { exitOnAny: boolean; severityThreshold: "error" | "warning" };
    fix: { rules: string[]; dryRun: boolean };
    pr: { patchFormat: "unified" | "json"; outputPath?: string };
  };
  autofixRules: AutofixRule[];
  budgets?: {
    maxTotalChanges?: number;
    maxBySeverity?: { error?: number; warning?: number; info?: number };
  };
}

export interface FixEntry {
  ruleId: string;
  path: string;
  oldValue: unknown;
  newValue: unknown;
  confidence: number; // 0-1
  file?: string; // Relative path only
  lineDelta?: number;
  /** Deterministic id for correlation across runs (Phase 2 traceability) */
  stableId?: string;
  /** Reference to contract structure when deterministically derivable */
  contractRef?: ContractRef;
  /** Reference to the rule that produced this entry */
  ruleRef?: RuleRef;
}

export interface FixError {
  ruleId: string;
  path: string;
  message: string;
  /** Deterministic id for correlation across runs (Phase 2 traceability) */
  stableId?: string;
  /** Reference to contract structure when deterministically derivable */
  contractRef?: ContractRef;
  /** Reference to the rule that produced this entry */
  ruleRef?: RuleRef;
}

export interface FixSummary {
  schemaVersion: string;
  mode: "fix" | "pr";
  policy: { version: string; fingerprint: string };
  applied: FixEntry[];
  skipped: FixEntry[];
  errors: FixError[];
}
