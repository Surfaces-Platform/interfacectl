export type SurfaceType = "web" | "cli";

export interface PageFrameLayout {
  containerSelector: string;
  containerMaxWidthPx: number;
  containerMinWidthPx?: number;
  paddingXpx: number;
  alignment?: "center" | "left";
  enforcement?: "strict" | "warn";
}

export type ChromePolicyTarget =
  | "page-container"
  | "top-level-section"
  | "layout-container";

export interface ChromePolicy {
  policy: "off" | "warn" | "strict";
  targets: ChromePolicyTarget[];
  maxBorderRadiusPx: number;
  allowOuterShadow: boolean;
  allowInsetShadow: boolean;
}

export type ChromeShadowKind = "none" | "outer" | "inset" | "mixed";

export interface LandingPatternPolicy {
  policy: "off" | "warn" | "strict";
  requireTopLevelSections?: string[];
  sectionOrder?: string[];
  pageBackgroundMode?: "solid" | "custom";
  marketingLayoutProfile?: string;
  marketingLayoutPolicy?: "off" | "warn" | "strict";
}

export interface FlowTransitionRequirement {
  from: string;
  to: string;
}

export interface FlowRequirement {
  flowId: string;
  minSteps?: number;
  requiredSteps?: string[];
  requiredTransitions?: FlowTransitionRequirement[];
  terminalSteps?: string[];
}

export interface FlowPolicy {
  policy: "off" | "warn" | "strict";
  requirements: FlowRequirement[];
}

export type ExternalReferenceSystem =
  | "figma"
  | "code"
  | "story"
  | "url"
  | "asset";

export type AuthoringSource = "contract" | ExternalReferenceSystem;

export interface ExternalReference {
  system: ExternalReferenceSystem;
  kind: string;
  ref: string;
  name?: string;
}

export type ContractSlotKind =
  | "text"
  | "richText"
  | "media"
  | "action"
  | "icon"
  | "container"
  | "item-list";

export interface ContractSlotContentRules {
  minLength?: number;
  maxLength?: number;
  allowHtml?: boolean;
  allowedMimeTypes?: string[];
}

export interface ContractSlot {
  id: string;
  kind: ContractSlotKind;
  required: boolean;
  repeatable?: boolean;
  minItems?: number;
  maxItems?: number;
  textRole?: string;
  acceptsComponents?: string[];
  contentRules?: ContractSlotContentRules;
}

export interface ContractComponentVariant {
  id: string;
  label?: string;
  description?: string;
  when?: string;
}

export interface ContractState {
  id: string;
  label?: string;
  when?: string;
  requiredSlots?: string[];
  hiddenSlots?: string[];
  notes?: string;
}

export type ContractInteractionEffect =
  | "navigate"
  | "open"
  | "close"
  | "submit"
  | "filter"
  | "toggle"
  | "expand"
  | "collapse"
  | "select"
  | "set-state";

export interface ContractInteraction {
  id: string;
  trigger: string;
  effect: ContractInteractionEffect;
  target?: string;
  resultingState?: string;
  navigationTarget?: string;
  notes?: string;
}

export interface ContractComponentImplementation {
  preferredSource?: AuthoringSource;
  allowedSources?: AuthoringSource[];
  htmlFallback?: string;
  accessibilityNotes?: string[];
}

export interface ContractComponent {
  id: string;
  intent: string;
  description?: string;
  variants?: ContractComponentVariant[];
  slots: ContractSlot[];
  states?: ContractState[];
  interactions?: ContractInteraction[];
  implementation?: ContractComponentImplementation;
  references?: ExternalReference[];
}

export interface SectionAnatomy {
  pattern: string;
  defaultComponent?: string;
  allowedComponents?: string[];
  slots?: ContractSlot[];
}

export type SectionEditMode = "locked" | "slot-bound" | "freeform";

export type SectionAllowedOperation =
  | "update-copy"
  | "swap-variant"
  | "reorder-items"
  | "change-media"
  | "adjust-layout"
  | "bind-data"
  | "wire-interaction";

export interface SectionEditPolicy {
  mode: SectionEditMode;
  allowedOperations?: SectionAllowedOperation[];
}

export type ResponsiveLayoutIntent =
  | "stack"
  | "columns"
  | "auto-fit-grid"
  | "sidebar-main"
  | "single-column-form";

export type ResponsiveSlotBehaviorKind =
  | "stack"
  | "inline"
  | "grid"
  | "hide"
  | "collapse"
  | "pin";

export interface ResponsiveSlotBehavior {
  slotId: string;
  behavior: ResponsiveSlotBehaviorKind;
  notes?: string;
}

export interface SectionResponsiveRule {
  viewport: string;
  layoutIntent: ResponsiveLayoutIntent;
  slotBehaviors?: ResponsiveSlotBehavior[];
  notes?: string;
}

export interface SectionResponsive {
  rules: SectionResponsiveRule[];
}

export interface ViewportProfile {
  id: string;
  label?: string;
  minWidthPx?: number;
  maxWidthPx?: number;
  density?: "compact" | "comfortable" | "spacious";
  notes?: string;
}

export interface SurfaceAuthoringStyling {
  strategy?: string;
  tokenPrefix?: string;
}

export interface SurfaceAuthoringLibraries {
  components?: string[];
  icons?: string[];
  data?: string[];
}

export interface SurfaceAuthoring {
  framework?: string;
  routing?: string;
  styling?: SurfaceAuthoringStyling;
  preferredLibraries?: SurfaceAuthoringLibraries;
  sourcePriority: AuthoringSource[];
}

export interface SurfacePhase0 {
  authPosture?: "public" | "auth-aware" | "auth-first";
  requiresShell?: boolean;
  expectsAuthRoutes?: boolean;
  expectsDesignSystem?: boolean;
}

export interface SurfaceGovernanceRoles {
  designers?: string[];
  engineers?: string[];
  approvers?: string[];
}

export type SurfaceApprovalRole =
  | "designer"
  | "engineering"
  | "product"
  | "qa"
  | "operations"
  | "other";

export type SurfaceApprovalStatus = "pending" | "approved" | "rejected";

export interface SurfaceApprovalRecord {
  role: SurfaceApprovalRole;
  owner: string;
  status: SurfaceApprovalStatus;
  note?: string;
  timestamp?: string;
}

export interface SurfaceGovernance {
  status?: "draft" | "review" | "approved" | "published";
  roles?: SurfaceGovernanceRoles;
  approvals?: SurfaceApprovalRecord[];
}

export type SurfaceMutationMode =
  | "locked"
  | "content-only"
  | "slot-bound"
  | "layout-tuning"
  | "section-assembly"
  | "freeform";

export type SurfaceMutationScope =
  | "content"
  | "components"
  | "layout"
  | "sections"
  | "interactions";

export type SurfaceMutationAction =
  | SectionAllowedOperation
  | "add-section"
  | "remove-section"
  | "reorder-sections"
  | "swap-component";

export interface SurfaceMutationEnvelope {
  mode: SurfaceMutationMode;
  scopes?: SurfaceMutationScope[];
  allowedActions?: SurfaceMutationAction[];
  allowedSections?: string[];
  prohibitedSections?: string[];
}

export interface SurfaceRuntimeContextRule {
  id: string;
  when: string;
  policy?: "off" | "warn" | "strict";
  requiredSections?: string[];
  prohibitedSections?: string[];
  allowedLayoutIntents?: ResponsiveLayoutIntent[];
  notes?: string;
}

export interface SurfaceRuntimePolicy {
  policy?: "off" | "warn" | "strict";
  mutationEnvelope?: SurfaceMutationEnvelope;
  contexts?: SurfaceRuntimeContextRule[];
}

export interface ContractSurface {
  id: string;
  displayName: string;
  type: SurfaceType;
  requiredSections: string[];
  allowedFonts: string[];
  marketingTypographyProfile?: string;
  marketingTypographyPolicy?: "off" | "warn" | "strict";
  layout: {
    maxContentWidth: number;
    requiredContainers?: string[];
    pageFrame?: PageFrameLayout;
    chromePolicy?: ChromePolicy;
    landingPattern?: LandingPatternPolicy;
  };
  icons?: IconPolicy;
  flows?: FlowPolicy;
  phase0?: SurfacePhase0;
  domain?: string;
  owner?: string;
  mustNotEmit?: string[];
  shellOwnedPrimitiveAllowSources?: string[];
  viewports?: ViewportProfile[];
  authoring?: SurfaceAuthoring;
  governance?: SurfaceGovernance;
  runtime?: SurfaceRuntimePolicy;
}

export interface ContractSection {
  id: string;
  intent: string;
  description: string;
  anatomy?: SectionAnatomy;
  editPolicy?: SectionEditPolicy;
  responsive?: SectionResponsive;
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

export type TokenCategory = "typography" | "layout" | "motion";

export interface TokenMetadata {
  token: string;
  normalizedValue: string;
  attributes: string[];
  aliases: string[];
}

export interface TokenPolicy {
  policy: "off" | "warn" | "strict";
  allowedTokens: string[];
  tokenMetadata?: TokenMetadata[];
}

export interface ContractTokenPolicies {
  typography?: TokenPolicy;
  layout?: TokenPolicy;
  motion?: TokenPolicy;
}

export type MarketingHeroContainerMode = "open-flow" | "framed";
export type MarketingHeroVisualPlacement =
  | "inline-end"
  | "inline-start"
  | "stacked"
  | "none";
export type MarketingSectionDividerMode = "none" | "border-top";
export type MarketingSectionSpacingProfile = "compact" | "roomy";
export type MarketingTypographyRole =
  | "heroEyebrow"
  | "heroTitle"
  | "heroBody"
  | "sectionTitle"
  | "body";

export interface MarketingLayoutProfile {
  id: string;
  description?: string;
  heroContainerMode: MarketingHeroContainerMode;
  heroVisualPlacement: MarketingHeroVisualPlacement;
  sectionDividerMode: MarketingSectionDividerMode;
  sectionSpacingProfile: MarketingSectionSpacingProfile;
}

export interface MarketingTypographyRoleProfile {
  role: MarketingTypographyRole;
  allowedTokens: string[];
}

export interface MarketingTypographyProfile {
  id: string;
  description?: string;
  roles: MarketingTypographyRoleProfile[];
}

export interface ContractMarketingProfiles {
  layout?: MarketingLayoutProfile[];
  typography?: MarketingTypographyProfile[];
}

export interface InterfaceContract {
  contractId: string;
  version: string;
  description?: string;
  surfaces: ContractSurface[];
  sections: ContractSection[];
  components?: ContractComponent[];
  constraints: ContractConstraints;
  color: ColorPolicy;
  tokens?: ContractTokenPolicies;
  marketingProfiles?: ContractMarketingProfiles;
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

export interface SurfaceTokenDescriptor {
  value: string;
  observedValue?: string;
  source?: string;
  attributes?: string[];
  normalizedValue?: string;
}

export interface SurfaceTokenUsage {
  typography: SurfaceTokenDescriptor[];
  layout: SurfaceTokenDescriptor[];
  motion: SurfaceTokenDescriptor[];
}

export interface SurfacePrimitiveDescriptor {
  role: string;
  count: number;
  sources?: string[];
}

export interface SurfaceFlowStepDescriptor {
  id: string;
}

export interface SurfaceFlowTransitionDescriptor {
  from: string;
  to: string;
}

export interface SurfaceFlowDescriptor {
  flowId: string;
  steps: SurfaceFlowStepDescriptor[];
  transitions: SurfaceFlowTransitionDescriptor[];
  source?: string;
}

export interface PageFrameLayoutDescriptor {
  containerSelector: string;
  maxWidthPx?: number | null;
  minWidthPx?: number | null;
  paddingLeftPx?: number | null;
  paddingRightPx?: number | null;
  source?: string;
  maxWidthHasClampCalc?: boolean;
  minWidthHasClampCalc?: boolean;
  paddingHasClampCalc?: boolean;
}

export interface LandingPatternDescriptor {
  sectionOrder: string[];
  topLevelSections: string[];
  nestedSections: string[];
  pageBackgroundMode?: "solid" | "custom" | "unknown";
  marketingLayoutProfile?: string;
  heroContainerMode?: MarketingHeroContainerMode;
  heroVisualPlacement?: MarketingHeroVisualPlacement;
  sectionDividerMode?: MarketingSectionDividerMode;
  sectionSpacingProfile?: MarketingSectionSpacingProfile;
  source?: string;
}

export interface SurfaceMarketingTypographyRoleDescriptor {
  role: MarketingTypographyRole;
  tokens: SurfaceTokenDescriptor[];
  source?: string;
}

export interface SurfaceMarketingTypographyDescriptor {
  profileId?: string;
  roles: SurfaceMarketingTypographyRoleDescriptor[];
  source?: string;
}

export interface ChromeLayoutDescriptor {
  targets: ChromePolicyTarget[];
  maxBorderRadiusPx?: number | null;
  shadowKinds: ChromeShadowKind[];
  source?: string[];
  hasAmbiguousSignals?: boolean;
}

export interface SurfaceLayoutDescriptor {
  maxContentWidth?: number | null;
  containers?: string[];
  containerSources?: string[];
  source?: string;
  pageFrame?: PageFrameLayoutDescriptor;
  chrome?: ChromeLayoutDescriptor;
  landingPattern?: LandingPatternDescriptor;
}

export interface SurfaceDescriptor {
  surfaceId: string;
  sections: SurfaceSectionDescriptor[];
  fonts: SurfaceFontDescriptor[];
  colors: SurfaceColorDescriptor[];
  icons?: SurfaceIconDescriptor[];
  tokenUsage?: SurfaceTokenUsage;
  marketingTypography?: SurfaceMarketingTypographyDescriptor;
  flows?: SurfaceFlowDescriptor[];
  flowDescriptorPath?: string;
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
  | "token-not-allowed"
  | "layout-width-exceeded"
  | "layout-width-undetermined"
  | "layout-container-missing"
  | "layout-pageframe-selector-unsupported"
  | "layout-pageframe-container-not-found"
  | "layout-pageframe-maxwidth-mismatch"
  | "layout-pageframe-minwidth-mismatch"
  | "layout-pageframe-padding-mismatch"
  | "layout-pageframe-non-deterministic-value"
  | "layout-pageframe-unextractable-value"
  | "landing-pattern-signal-missing"
  | "landing-pattern-top-level-missing"
  | "landing-pattern-section-order"
  | "landing-pattern-section-nested"
  | "landing-pattern-background-mode"
  | "landing-pattern-marketing-layout-missing"
  | "landing-pattern-hero-container-mode"
  | "landing-pattern-hero-visual-placement"
  | "landing-pattern-section-divider-mode"
  | "landing-pattern-section-spacing-profile"
  | "marketing-typography-profile-missing"
  | "marketing-typography-role-missing"
  | "marketing-typography-role-token"
  | "motion-duration-not-allowed"
  | "motion-timing-not-allowed"
  | "descriptor-flows-missing"
  | "flow-required-missing"
  | "flow-steps-min"
  | "flow-steps-required"
  | "flow-transition-required"
  | "flow-terminal-invalid"
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
