import type {
  SurfaceApprovalRecord,
  SurfaceApprovalRole,
  SurfaceApprovalStatus,
} from "./types.js";
import { diffUiAst, type UiAstDiffEntry } from "./ui-ast-authoring.js";
import type {
  UiAstActionIntent,
  UiAstNode,
  UiAstNodeKind,
  UiAstPlatform,
  UiAstSurface,
  UiSurfaceAst,
} from "./ui-ast.js";

export const UI_AST_LIFECYCLE_SCHEMA_URL =
  "https://contracts.surfaces.local/ui.ast.lifecycle.schema.json";
export const UI_AST_REVIEW_SCHEMA_URL =
  "https://contracts.surfaces.local/ui.ast.review.schema.json";
export const UI_AST_PROPOSAL_REQUEST_SCHEMA_URL =
  "https://contracts.surfaces.local/ui.ast.proposal.request.schema.json";
export const UI_AST_PROPOSAL_RESPONSE_SCHEMA_URL =
  "https://contracts.surfaces.local/ui.ast.proposal.response.schema.json";
export const UI_AST_INTEGRATION_SCHEMA_URL =
  "https://contracts.surfaces.local/ui.ast.integration.schema.json";
export const UI_AST_INTEGRATION_EVIDENCE_SCHEMA_URL =
  "https://contracts.surfaces.local/ui.ast.integration.evidence.schema.json";
export const UI_AST_OBSERVATION_SCHEMA_URL =
  "https://contracts.surfaces.local/ui.ast.observation.schema.json";
export const UI_AST_OBSERVED_EVIDENCE_SCHEMA_URL =
  "https://contracts.surfaces.local/ui.ast.observed.evidence.schema.json";
export const UI_AST_RUNTIME_VERDICT_SCHEMA_URL =
  "https://contracts.surfaces.local/ui.ast.runtime.verdict.schema.json";
export const UI_AST_PROMOTION_SCHEMA_URL =
  "https://contracts.surfaces.local/ui.ast.promotion.schema.json";

export type UiAstLifecycleStage =
  | "draft"
  | "validated"
  | "approved"
  | "published"
  | "observed";
export type UiAstLifecycleStatus = "pending" | "passed" | "failed";
export type UiAstProposalVerdict = "pass" | "warn" | "block";
export type UiAstRuntimeVerdictStatus = "allow" | "warn" | "block" | "degrade";
export type UiAstReviewStatus =
  | "accepted"
  | "proposed"
  | "rejected"
  | "needs-human-review";
export type UiAstReviewHint =
  | "structural"
  | "interaction"
  | "state"
  | "governance"
  | "platform"
  | "content";
export type UiAstPrimitiveFamily =
  | "layout.section"
  | "layout.group"
  | "content.heading"
  | "content.body"
  | "form.field"
  | "form.toggle"
  | "form.selection"
  | "action.button"
  | "feedback.alert"
  | "feedback.confirmation"
  | "feedback.empty-state"
  | "data.list"
  | "data.table"
  | "data.detail"
  | "flow.progress-steps";
export type UiAstAllowedDivergence =
  | "presentation"
  | "native-control-mapping"
  | "density"
  | "layout-tuning"
  | "copy-length";
export type UiAstObservationSource =
  | "browser-remote"
  | "edge-runtime"
  | "device-runtime"
  | "server-renderer";

export interface UiAstSurfaceRef {
  astId: string;
  astVersion: string;
  surfaceId: string;
}

export interface UiAstLifecycleRecord {
  $schema: string;
  schemaVersion: "surfaces.ui.ast.lifecycle@1";
  ast: UiAstSurfaceRef;
  stage: UiAstLifecycleStage;
  governanceStatus: string;
  validation: {
    status: UiAstLifecycleStatus;
    validatedAt?: string;
  };
  approval: {
    status: SurfaceApprovalStatus | "pending";
    requiredRoles: SurfaceApprovalRole[];
    records: SurfaceApprovalRecord[];
    approvedAt?: string;
  };
  publication: {
    status: "pending" | "published";
    publishedAt?: string;
  };
  observation: {
    status: "pending" | "observed";
    observedAt?: string;
    lastVerdict?: UiAstRuntimeVerdictStatus;
  };
}

export interface UiAstReviewedChange extends UiAstDiffEntry {
  surfaceId?: string;
  nodeId?: string;
  nodeKind?: UiAstNodeKind;
  actionIntent?: UiAstActionIntent;
  stateId?: string;
  platforms?: UiAstPlatform[];
  reviewHint: UiAstReviewHint;
}

export interface UiAstReviewArtifact {
  $schema: string;
  schemaVersion: "surfaces.ui.ast.review@1";
  ast: UiAstSurfaceRef;
  review: {
    status: UiAstReviewStatus;
    requiresHumanReview: boolean;
  };
  summary: {
    changeCount: number;
    nodeChangeCount: number;
    stateChangeCount: number;
    governanceChangeCount: number;
    platformChangeCount: number;
  };
  changes: UiAstReviewedChange[];
}

export interface UiAstProposalRepairGuidance {
  code: string;
  priority: "high" | "medium" | "low";
  category: string;
  actionType: string;
  nextAction: string;
}

export interface UiAstProposalContract {
  $schema: string;
  schemaVersion: "surfaces.ui.ast.proposal@1";
  ast: UiAstSurfaceRef;
  lifecycleStage: UiAstLifecycleStage;
  adapter: {
    requestSchemaId: string;
    responseSchemaId: string;
  };
  invariants: {
    stableNodeIds: "required";
    namedActionIntents: "required";
    requiredStateIds: string[];
    supportedPlatforms: UiAstPlatform[];
    boundedVocabulary: UiAstNodeKind[];
  };
  provenance: {
    requiredFields: string[];
  };
  verdicts: {
    pass: string;
    warn: string;
    block: string;
  };
  retryLoop: {
    guidanceSource: "repair-map";
    deterministic: true;
  };
  repairGuidance: UiAstProposalRepairGuidance[];
}

export interface UiAstIntegrationNodeBinding {
  nodeKind: UiAstNodeKind;
  primitiveFamily: UiAstPrimitiveFamily;
  allowedDivergence: UiAstAllowedDivergence[];
}

export interface UiAstIntegrationContract {
  $schema: string;
  schemaVersion: "surfaces.ui.ast.integration@1";
  ast: UiAstSurfaceRef;
  lifecycleStage: UiAstLifecycleStage;
  rendererBindings: Array<{
    platform: UiAstPlatform;
    nodeBindings: UiAstIntegrationNodeBinding[];
    requiredProvenanceFields: string[];
  }>;
  compatibilityChecks: Array<{
    code: string;
    required: boolean;
    description: string;
  }>;
  evidence: {
    schemaId: string;
    requiredChecks: string[];
  };
}

export interface UiAstIntegrationEvidence {
  $schema: string;
  schemaVersion: "surfaces.ui.ast.integration.evidence@1";
  consumer: string;
  integratedAt: string;
  ast: UiAstSurfaceRef;
  platform: UiAstPlatform;
  bundleVersion: string;
  projectionId: UiAstPlatform;
  compatibilityChecks: Array<{
    code: string;
    status: UiAstProposalVerdict;
    message: string;
  }>;
  exceptions: Array<{
    code: string;
    approvedBy: string;
    note?: string;
  }>;
  provenance: {
    embeddedFields: string[];
  };
}

export interface UiAstObservationContract {
  $schema: string;
  schemaVersion: "surfaces.ui.ast.observation@1";
  ast: UiAstSurfaceRef;
  lifecycleStage: UiAstLifecycleStage;
  mutationEnvelope: {
    mode: string;
    adaptableNodeIds: string[];
    immutableNodeIds: string[];
  };
  allowedActionIntents: UiAstActionIntent[];
  requiredStateIds: string[];
  allowedTransitions: Array<{
    from: string;
    to: string;
  }>;
  fallbacks: Array<{
    verdict: UiAstRuntimeVerdictStatus;
    action: string;
  }>;
  evidence: {
    schemaId: string;
    requiredNodeIds: string[];
    requiredActionIntents: UiAstActionIntent[];
    requiredStateIds: string[];
    requiredProvenanceFields: string[];
  };
  verdictSchemaId: string;
}

export interface UiAstObservedEvidence {
  $schema: string;
  schemaVersion: "surfaces.ui.ast.observed.evidence@1";
  source: UiAstObservationSource;
  observedAt: string;
  ast: UiAstSurfaceRef;
  platform: UiAstPlatform;
  observedNodeIds: string[];
  observedActionIntents: UiAstActionIntent[];
  observedStateIds: string[];
  drift: {
    missingNodeIds: string[];
    unexpectedNodeIds: string[];
    missingActionIntents: UiAstActionIntent[];
    unexpectedActionIntents: UiAstActionIntent[];
    missingStateIds: string[];
    unexpectedStateIds: string[];
  };
}

export interface UiAstRuntimeVerdict {
  $schema: string;
  schemaVersion: "surfaces.ui.ast.runtime.verdict@1";
  ast: UiAstSurfaceRef;
  platform: UiAstPlatform;
  observedAt: string;
  source: UiAstObservationSource;
  verdict: UiAstRuntimeVerdictStatus;
  code: string;
  policy: "off" | "warn" | "strict";
  fallbackTaken: string;
  drift: UiAstObservedEvidence["drift"];
}

export interface UiAstPromotionRecord {
  $schema: string;
  schemaVersion: "surfaces.ui.ast.promotion@1";
  promotionId: string;
  promotedAt: string;
  ast: UiAstSurfaceRef;
  lifecycleStage: Extract<UiAstLifecycleStage, "published" | "observed">;
  sourceRunId?: string | null;
  artifacts: {
    astPath: string;
    bundleRoot: string;
    generationPayloadPath: string;
    runtimePayloadPath: string;
    integrationEvidencePath?: string;
  };
}

interface LifecycleOptions {
  surfaceId?: string;
  validationStatus?: UiAstLifecycleStatus;
  validatedAt?: string;
  publishedAt?: string;
  observedAt?: string;
  lastRuntimeVerdict?: UiAstRuntimeVerdictStatus;
}

interface LifecycleComputationState {
  governanceStatus: string;
  validation: UiAstLifecycleRecord["validation"];
  approval: UiAstLifecycleRecord["approval"];
  publication: UiAstLifecycleRecord["publication"];
  observation: UiAstLifecycleRecord["observation"];
}

interface ProposalOptions {
  lifecycle?: UiAstLifecycleRecord;
  repairMap?: { repairs?: unknown[] } | null;
}

interface IntegrationEvidenceOptions {
  contract: UiAstIntegrationContract;
  consumer: string;
  platform: UiAstPlatform;
  bundleVersion: string;
  integratedAt: string;
  checks?: Array<{
    code: string;
    status: UiAstProposalVerdict;
    message: string;
  }>;
  exceptions?: Array<{
    code: string;
    approvedBy: string;
    note?: string;
  }>;
  embeddedFields?: string[];
}

interface ObservationEvidenceOptions {
  contract: UiAstObservationContract;
  source: UiAstObservationSource;
  observedAt: string;
  platform: UiAstPlatform;
  observedNodeIds: string[];
  observedActionIntents: UiAstActionIntent[];
  observedStateIds: string[];
}

function uniqueSortedStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function findSurface(ast: UiSurfaceAst, surfaceId?: string): UiAstSurface {
  if (surfaceId) {
    const match = ast.surfaces.find((surface) => surface.id === surfaceId);
    if (match) {
      return match;
    }
  }
  if (ast.surfaces.length === 1) {
    return ast.surfaces[0];
  }
  throw new Error(`Surface "${surfaceId ?? "unknown"}" not found in AST.`);
}

function makeSurfaceRef(ast: UiSurfaceAst, surface: UiAstSurface): UiAstSurfaceRef {
  return {
    astId: ast.astId,
    astVersion: ast.version,
    surfaceId: surface.id,
  };
}

function governanceStatus(surface: UiAstSurface): string {
  return surface.governance?.status ?? "draft";
}

function isHighRiskSurface(surface: UiAstSurface): boolean {
  return (
    surface.runtime?.policy === "strict" ||
    surface.phase0?.authPosture === "auth-first" ||
    surface.flows?.policy === "strict"
  );
}

function resolveRequiredApprovalRoles(surface: UiAstSurface): SurfaceApprovalRole[] {
  const recordedRoles = uniqueSortedStrings(
    (surface.governance?.approvals ?? []).map((entry) => entry.role),
  ) as SurfaceApprovalRole[];
  if (recordedRoles.length > 0) {
    return recordedRoles;
  }

  const defaults: SurfaceApprovalRole[] = ["designer", "engineering"];
  if (isHighRiskSurface(surface)) {
    defaults.push("product", "operations");
  }
  return defaults;
}

function defaultOwnerForRole(surface: UiAstSurface, role: SurfaceApprovalRole): string {
  switch (role) {
    case "designer":
      return surface.governance?.roles?.designers?.[0] ?? "designer";
    case "engineering":
      return surface.governance?.roles?.engineers?.[0] ?? "engineering";
    case "product":
    case "operations":
    case "qa":
    case "other":
      return surface.governance?.roles?.approvers?.[0] ?? role;
    default:
      return role;
  }
}

function resolveApprovalRecords(surface: UiAstSurface): SurfaceApprovalRecord[] {
  const existing = surface.governance?.approvals ?? [];
  const byRole = new Map(existing.map((record) => [record.role, record]));
  return resolveRequiredApprovalRoles(surface).map((role) => {
    const match = byRole.get(role);
    if (match) {
      return match;
    }
    return {
      role,
      owner: defaultOwnerForRole(surface, role),
      status: "pending",
    };
  });
}

function deriveApprovalStatus(records: SurfaceApprovalRecord[]): SurfaceApprovalStatus | "pending" {
  if (records.some((record) => record.status === "rejected")) {
    return "rejected";
  }
  if (records.length > 0 && records.every((record) => record.status === "approved")) {
    return "approved";
  }
  return "pending";
}

function latestApprovedTimestamp(records: SurfaceApprovalRecord[]): string | undefined {
  const approved = records
    .filter((record) => record.status === "approved" && record.timestamp)
    .map((record) => record.timestamp as string)
    .sort((left, right) => right.localeCompare(left));
  return approved[0];
}

function deriveLifecycleStage(record: LifecycleComputationState): UiAstLifecycleStage {
  if (record.observation.status === "observed") {
    return "observed";
  }
  if (record.publication.status === "published") {
    return "published";
  }
  if (record.approval.status === "approved") {
    return "approved";
  }
  if (record.validation.status === "passed") {
    return "validated";
  }
  return "draft";
}

function parsePathContext(path: string): {
  surfaceId?: string;
  nodeId?: string;
  stateId?: string;
  platform?: UiAstPlatform;
  hint: UiAstReviewHint;
} {
  const nodeMatch = path.match(/^surfaces\[([^\]]+)\]\.nodes\[([^\]]+)\]/);
  if (nodeMatch) {
    const suffix = nodeMatch.input?.slice(nodeMatch[0].length) ?? "";
    return {
      surfaceId: nodeMatch[1],
      nodeId: nodeMatch[2],
      hint: suffix.includes("actionIntent") ? "interaction" : "content",
    };
  }
  const stateMatch = path.match(/^surfaces\[([^\]]+)\]\.states\[([^\]]+)\]/);
  if (stateMatch) {
    return {
      surfaceId: stateMatch[1],
      stateId: stateMatch[2],
      hint: "state",
    };
  }
  const platformMatch = path.match(/^surfaces\[([^\]]+)\]\.platforms\[([^\]]+)\]/);
  if (platformMatch) {
    return {
      surfaceId: platformMatch[1],
      platform: platformMatch[2] as UiAstPlatform,
      hint: "platform",
    };
  }
  const governanceMatch = path.match(/^surfaces\[([^\]]+)\]\.governance/);
  if (governanceMatch) {
    return {
      surfaceId: governanceMatch[1],
      hint: "governance",
    };
  }
  return {
    hint: path.includes("runtime") ? "interaction" : "structural",
  };
}

function nodeById(surface: UiAstSurface, nodeId?: string): UiAstNode | undefined {
  return nodeId ? surface.nodes.find((node) => node.id === nodeId) : undefined;
}

function primitiveFamilyForNodeKind(kind: UiAstNodeKind): UiAstPrimitiveFamily {
  switch (kind) {
    case "section":
      return "layout.section";
    case "group":
      return "layout.group";
    case "heading":
      return "content.heading";
    case "body":
      return "content.body";
    case "field":
      return "form.field";
    case "toggle":
      return "form.toggle";
    case "selection":
      return "form.selection";
    case "action":
      return "action.button";
    case "alert":
      return "feedback.alert";
    case "confirmation":
      return "feedback.confirmation";
    case "empty-state":
      return "feedback.empty-state";
    case "list":
      return "data.list";
    case "table":
      return "data.table";
    case "detail":
      return "data.detail";
    case "progress-steps":
      return "flow.progress-steps";
  }
}

function allowedDivergenceForNodeKind(kind: UiAstNodeKind): UiAstAllowedDivergence[] {
  switch (kind) {
    case "heading":
    case "body":
      return ["presentation", "copy-length"];
    case "field":
    case "toggle":
    case "selection":
    case "action":
      return ["presentation", "native-control-mapping", "density"];
    case "section":
    case "group":
      return ["presentation", "layout-tuning"];
    default:
      return ["presentation", "native-control-mapping"];
  }
}

function visibleNodeKindsForPlatform(surface: UiAstSurface, platform: UiAstPlatform): UiAstNodeKind[] {
  return uniqueSortedStrings(
    surface.nodes
      .filter(
        (node) =>
          !node.platformVisibility ||
          node.platformVisibility.length === 0 ||
          node.platformVisibility.includes(platform),
      )
      .map((node) => node.kind),
  ) as UiAstNodeKind[];
}

function actionIntents(surface: UiAstSurface): UiAstActionIntent[] {
  return uniqueSortedStrings(
    surface.nodes
      .map((node) => node.actionIntent)
      .filter((value): value is UiAstActionIntent => Boolean(value)),
  ) as UiAstActionIntent[];
}

function stateIds(surface: UiAstSurface): string[] {
  return uniqueSortedStrings((surface.states ?? []).map((state) => state.id));
}

function runtimePolicy(surface: UiAstSurface): "off" | "warn" | "strict" {
  return surface.runtime?.policy ?? "warn";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function nextActionFromRepair(actionType: string, category: string): string {
  switch (actionType) {
    case "remove-prohibited-primitives":
      return "Remove shell-owned primitives and keep generation inside the surface boundary.";
    case "ensure-required-sections":
      return "Add the missing required sections before retrying generation.";
    case "restore-required-flows":
    case "restore-required-flow-steps":
    case "restore-required-transitions":
      return "Restore the required flow structure and verify the transition markers.";
    case "increase-hit-area":
    case "increase-target-gap":
    case "move-away-from-edge":
    case "separate-destructive-action":
      return "Adjust interactive controls to satisfy target-acquisition policy before retry.";
    case "add-loading-state":
    case "add-empty-state":
    case "add-error-retry":
      return "Add the missing async feedback and recovery states.";
    default:
      return category === "visual"
        ? "Align the visual treatment with the approved policy and retry generation."
        : "Apply the suggested repair before retrying generation.";
  }
}

function sectionDescendantNodeIds(surface: UiAstSurface): Map<string, string[]> {
  const byId = new Map(surface.nodes.map((node) => [node.id, node]));
  const descendants = new Map<string, string[]>();

  function visit(nodeId: string, bucket: Set<string>) {
    const node = byId.get(nodeId);
    if (!node) {
      return;
    }
    bucket.add(node.id);
    for (const childId of node.children ?? []) {
      visit(childId, bucket);
    }
  }

  for (const node of surface.nodes) {
    if (node.kind !== "section") {
      continue;
    }
    const bucket = new Set<string>();
    visit(node.id, bucket);
    descendants.set(node.sectionId ?? node.id, [...bucket]);
  }

  return descendants;
}

function adaptableNodeIds(surface: UiAstSurface): string[] {
  const mode = surface.runtime?.mutationEnvelope?.mode ?? "content-only";
  if (mode === "locked") {
    return [];
  }

  const descendantsBySection = sectionDescendantNodeIds(surface);
  const allowedSections = uniqueSortedStrings(
    surface.runtime?.mutationEnvelope?.allowedSections ??
      [...descendantsBySection.keys()],
  );
  const descendantIds = new Set<string>();
  for (const sectionId of allowedSections) {
    for (const nodeId of descendantsBySection.get(sectionId) ?? []) {
      descendantIds.add(nodeId);
    }
  }

  const contentOnlyKinds = new Set<UiAstNodeKind>([
    "heading",
    "body",
    "field",
    "toggle",
    "selection",
    "action",
    "alert",
    "confirmation",
    "empty-state",
    "list",
    "table",
    "detail",
    "progress-steps",
  ]);

  return uniqueSortedStrings(
    surface.nodes
      .filter((node) => descendantIds.has(node.id))
      .filter((node) => {
        if (mode === "content-only" || mode === "slot-bound") {
          return contentOnlyKinds.has(node.kind);
        }
        if (mode === "layout-tuning") {
          return node.kind !== "section";
        }
        return true;
      })
      .map((node) => node.id),
  );
}

function immutableNodeIds(surface: UiAstSurface): string[] {
  const adaptable = new Set(adaptableNodeIds(surface));
  return uniqueSortedStrings(
    surface.nodes
      .map((node) => node.id)
      .filter((nodeId) => !adaptable.has(nodeId)),
  );
}

export function buildUiAstLifecycleRecord(
  ast: UiSurfaceAst,
  options: LifecycleOptions = {},
): UiAstLifecycleRecord {
  const surface = findSurface(ast, options.surfaceId);
  const approvals = resolveApprovalRecords(surface);
  const record: LifecycleComputationState = {
    governanceStatus: governanceStatus(surface),
    validation: {
      status: options.validationStatus ?? "pending",
      ...(options.validatedAt ? { validatedAt: options.validatedAt } : {}),
    },
    approval: {
      status: deriveApprovalStatus(approvals),
      requiredRoles: resolveRequiredApprovalRoles(surface),
      records: approvals,
      ...(latestApprovedTimestamp(approvals)
        ? { approvedAt: latestApprovedTimestamp(approvals) }
        : {}),
    },
    publication: {
      status:
        options.publishedAt || governanceStatus(surface) === "published"
          ? "published"
          : "pending",
      ...(options.publishedAt ? { publishedAt: options.publishedAt } : {}),
    } as UiAstLifecycleRecord["publication"],
    observation: {
      status: options.observedAt ? "observed" : "pending",
      ...(options.observedAt ? { observedAt: options.observedAt } : {}),
      ...(options.lastRuntimeVerdict
        ? { lastVerdict: options.lastRuntimeVerdict }
        : {}),
    } as UiAstLifecycleRecord["observation"],
  };

  return {
    $schema: UI_AST_LIFECYCLE_SCHEMA_URL,
    schemaVersion: "surfaces.ui.ast.lifecycle@1",
    ast: makeSurfaceRef(ast, surface),
    ...record,
    stage: deriveLifecycleStage(record),
  };
}

export function buildUiAstReviewArtifact(
  before: UiSurfaceAst,
  after: UiSurfaceAst,
  surfaceId?: string,
): UiAstReviewArtifact {
  const targetSurface = findSurface(after, surfaceId);
  const beforeSurface = findSurface(before, targetSurface.id);
  const changes = diffUiAst(before, after)
    .filter((entry) => !surfaceId || entry.path.startsWith(`surfaces[${surfaceId}]`))
    .map((entry) => {
      const context = parsePathContext(entry.path);
      const surface = context.surfaceId
        ? after.surfaces.find((item) => item.id === context.surfaceId) ??
          before.surfaces.find((item) => item.id === context.surfaceId)
        : targetSurface;
      const node = surface ? nodeById(surface, context.nodeId) : undefined;
      return {
        ...entry,
        ...(context.surfaceId ? { surfaceId: context.surfaceId } : {}),
        ...(context.nodeId ? { nodeId: context.nodeId } : {}),
        ...(node?.kind ? { nodeKind: node.kind } : {}),
        ...(node?.actionIntent ? { actionIntent: node.actionIntent } : {}),
        ...(context.stateId ? { stateId: context.stateId } : {}),
        ...(context.platform ? { platforms: [context.platform] } : {}),
        reviewHint:
          context.hint === "content" &&
          (entry.path.includes(".actionIntent") || Boolean(node?.actionIntent))
            ? "interaction"
            : context.hint,
      } satisfies UiAstReviewedChange;
    });

  const summary = {
    changeCount: changes.length,
    nodeChangeCount: changes.filter((change) => Boolean(change.nodeId)).length,
    stateChangeCount: changes.filter((change) => Boolean(change.stateId)).length,
    governanceChangeCount: changes.filter((change) => change.reviewHint === "governance").length,
    platformChangeCount: changes.filter((change) => change.reviewHint === "platform").length,
  };
  const requiresHumanReview = changes.some((change) =>
    ["governance", "interaction", "platform", "state"].includes(change.reviewHint),
  );

  return {
    $schema: UI_AST_REVIEW_SCHEMA_URL,
    schemaVersion: "surfaces.ui.ast.review@1",
    ast: makeSurfaceRef(after, targetSurface),
    review: {
      status:
        changes.length === 0
          ? "accepted"
          : requiresHumanReview
            ? "needs-human-review"
            : "proposed",
      requiresHumanReview,
    },
    summary,
    changes,
  };
}

export function buildUiAstProposalContract(
  ast: UiSurfaceAst,
  options: ProposalOptions = {},
  surfaceId?: string,
): UiAstProposalContract {
  const surface = findSurface(ast, surfaceId);
  const lifecycle =
    options.lifecycle ??
    buildUiAstLifecycleRecord(ast, {
      surfaceId: surface.id,
    });
  const repairs = Array.isArray(options.repairMap?.repairs)
    ? options.repairMap?.repairs
    : [];

  return {
    $schema: UI_AST_PROPOSAL_RESPONSE_SCHEMA_URL,
    schemaVersion: "surfaces.ui.ast.proposal@1",
    ast: makeSurfaceRef(ast, surface),
    lifecycleStage: lifecycle.stage,
    adapter: {
      requestSchemaId: UI_AST_PROPOSAL_REQUEST_SCHEMA_URL,
      responseSchemaId: UI_AST_PROPOSAL_RESPONSE_SCHEMA_URL,
    },
    invariants: {
      stableNodeIds: "required",
      namedActionIntents: "required",
      requiredStateIds: stateIds(surface),
      supportedPlatforms: surface.platforms.map((platform) => platform.platform),
      boundedVocabulary: uniqueSortedStrings(surface.nodes.map((node) => node.kind)) as UiAstNodeKind[],
    },
    provenance: {
      requiredFields: ["requestId", "surfaceId", "astId", "astVersion", "platform", "source"],
    },
    verdicts: {
      pass: "No blocking AST policy findings were detected.",
      warn: "Warnings were detected; explicit review is required before promotion.",
      block: "A strict structural, policy, or platform-projection failure was detected.",
    },
    retryLoop: {
      guidanceSource: "repair-map",
      deterministic: true,
    },
    repairGuidance: repairs.map((repair) => {
      const record = asRecord(repair);
      const actionType = asString(asRecord(record.action).type) ?? "unknown";
      const category = asString(record.category) ?? "unknown";
      return {
        code: asString(record.code) ?? "unknown",
        priority:
          (asString(record.priority) as "high" | "medium" | "low" | null) ?? "medium",
        category,
        actionType,
        nextAction: nextActionFromRepair(actionType, category),
      };
    }),
  };
}

export function buildUiAstIntegrationContract(
  ast: UiSurfaceAst,
  lifecycle: UiAstLifecycleRecord | undefined,
  surfaceId?: string,
): UiAstIntegrationContract {
  const surface = findSurface(ast, surfaceId);
  return {
    $schema: UI_AST_INTEGRATION_SCHEMA_URL,
    schemaVersion: "surfaces.ui.ast.integration@1",
    ast: makeSurfaceRef(ast, surface),
    lifecycleStage: lifecycle?.stage ?? buildUiAstLifecycleRecord(ast, { surfaceId: surface.id }).stage,
    rendererBindings: surface.platforms.map((platform) => ({
      platform: platform.platform,
      nodeBindings: visibleNodeKindsForPlatform(surface, platform.platform).map((nodeKind) => ({
        nodeKind,
        primitiveFamily: primitiveFamilyForNodeKind(nodeKind),
        allowedDivergence: allowedDivergenceForNodeKind(nodeKind),
      })),
      requiredProvenanceFields: ["surfaceId", "astId", "astVersion", "bundleVersion", "platform"],
    })),
    compatibilityChecks: [
      {
        code: "integration.projection-present",
        required: true,
        description: "A platform projection must exist for the integrated target.",
      },
      {
        code: "integration.stable-node-ids",
        required: true,
        description: "Integrated output must preserve approved AST node ids.",
      },
      {
        code: "integration.bounded-vocabulary",
        required: true,
        description: "Integrated output may use only approved AST node kinds and bound primitives.",
      },
      {
        code: "integration.provenance-embedded",
        required: true,
        description: "Integrated output must embed AST and bundle provenance.",
      },
    ],
    evidence: {
      schemaId: UI_AST_INTEGRATION_EVIDENCE_SCHEMA_URL,
      requiredChecks: [
        "integration.projection-present",
        "integration.stable-node-ids",
        "integration.bounded-vocabulary",
        "integration.provenance-embedded",
      ],
    },
  };
}

export function buildUiAstIntegrationEvidence(
  options: IntegrationEvidenceOptions,
): UiAstIntegrationEvidence {
  return {
    $schema: UI_AST_INTEGRATION_EVIDENCE_SCHEMA_URL,
    schemaVersion: "surfaces.ui.ast.integration.evidence@1",
    consumer: options.consumer,
    integratedAt: options.integratedAt,
    ast: options.contract.ast,
    platform: options.platform,
    bundleVersion: options.bundleVersion,
    projectionId: options.platform,
    compatibilityChecks:
      options.checks ??
      options.contract.evidence.requiredChecks.map((code) => ({
        code,
        status: "pass",
        message: `${code} passed.`,
      })),
    exceptions: options.exceptions ?? [],
    provenance: {
      embeddedFields:
        options.embeddedFields ??
        ["surfaceId", "astId", "astVersion", "bundleVersion", "platform"],
    },
  };
}

export function buildUiAstObservationContract(
  ast: UiSurfaceAst,
  lifecycle: UiAstLifecycleRecord | undefined,
  surfaceId?: string,
): UiAstObservationContract {
  const surface = findSurface(ast, surfaceId);
  const requiredNodeIds = uniqueSortedStrings(
    [
      surface.rootNodeId,
      ...surface.nodes
        .filter((node) => node.kind === "section")
        .map((node) => node.id),
    ],
  );
  const requiredActionIntents = actionIntents(surface);
  const requiredStateIds = stateIds(surface);

  return {
    $schema: UI_AST_OBSERVATION_SCHEMA_URL,
    schemaVersion: "surfaces.ui.ast.observation@1",
    ast: makeSurfaceRef(ast, surface),
    lifecycleStage: lifecycle?.stage ?? buildUiAstLifecycleRecord(ast, { surfaceId: surface.id }).stage,
    mutationEnvelope: {
      mode: surface.runtime?.mutationEnvelope?.mode ?? "content-only",
      adaptableNodeIds: adaptableNodeIds(surface),
      immutableNodeIds: immutableNodeIds(surface),
    },
    allowedActionIntents: requiredActionIntents,
    requiredStateIds,
    allowedTransitions: (surface.flows?.requirements ?? []).flatMap((requirement) =>
      (requirement.requiredTransitions ?? []).map((transition) => ({
        from: transition.from,
        to: transition.to,
      })),
    ),
    fallbacks: [
      { verdict: "allow", action: "allow-change" },
      { verdict: "warn", action: "allow-with-evidence" },
      { verdict: "block", action: "preserve-approved-ui" },
      { verdict: "degrade", action: "preserve-last-good-state" },
    ],
    evidence: {
      schemaId: UI_AST_OBSERVED_EVIDENCE_SCHEMA_URL,
      requiredNodeIds,
      requiredActionIntents,
      requiredStateIds,
      requiredProvenanceFields: ["surfaceId", "astId", "astVersion", "bundleVersion", "platform"],
    },
    verdictSchemaId: UI_AST_RUNTIME_VERDICT_SCHEMA_URL,
  };
}

export function buildUiAstObservedEvidence(
  options: ObservationEvidenceOptions,
): UiAstObservedEvidence {
  const requiredNodeIds = new Set(options.contract.evidence.requiredNodeIds);
  const requiredActionIntents = new Set(options.contract.evidence.requiredActionIntents);
  const requiredStateIds = new Set(options.contract.evidence.requiredStateIds);
  const observedNodeIds = uniqueSortedStrings(options.observedNodeIds);
  const observedActionIntents = uniqueSortedStrings(options.observedActionIntents) as UiAstActionIntent[];
  const observedStateIds = uniqueSortedStrings(options.observedStateIds);

  return {
    $schema: UI_AST_OBSERVED_EVIDENCE_SCHEMA_URL,
    schemaVersion: "surfaces.ui.ast.observed.evidence@1",
    source: options.source,
    observedAt: options.observedAt,
    ast: options.contract.ast,
    platform: options.platform,
    observedNodeIds,
    observedActionIntents,
    observedStateIds,
    drift: {
      missingNodeIds: options.contract.evidence.requiredNodeIds.filter((id) => !observedNodeIds.includes(id)),
      unexpectedNodeIds: observedNodeIds.filter((id) => !requiredNodeIds.has(id)),
      missingActionIntents: options.contract.evidence.requiredActionIntents.filter(
        (intent) => !observedActionIntents.includes(intent),
      ),
      unexpectedActionIntents: observedActionIntents.filter(
        (intent) => !requiredActionIntents.has(intent),
      ),
      missingStateIds: options.contract.evidence.requiredStateIds.filter(
        (id) => !observedStateIds.includes(id),
      ),
      unexpectedStateIds: observedStateIds.filter((id) => !requiredStateIds.has(id)),
    },
  };
}

export function buildUiAstRuntimeVerdict(
  contract: UiAstObservationContract,
  evidence: UiAstObservedEvidence,
  policy: "off" | "warn" | "strict" = "warn",
): UiAstRuntimeVerdict {
  const hasRequiredDrift =
    evidence.drift.missingNodeIds.length > 0 ||
    evidence.drift.missingActionIntents.length > 0 ||
    evidence.drift.missingStateIds.length > 0;
  const hasUnexpectedDrift =
    evidence.drift.unexpectedNodeIds.length > 0 ||
    evidence.drift.unexpectedActionIntents.length > 0 ||
    evidence.drift.unexpectedStateIds.length > 0;

  let verdict: UiAstRuntimeVerdictStatus;
  let code = "runtime.observation.ok";
  if (hasRequiredDrift) {
    verdict = policy === "strict" ? "block" : "warn";
    code = evidence.drift.missingNodeIds.length > 0
      ? "runtime.required-node.missing"
      : evidence.drift.missingActionIntents.length > 0
        ? "runtime.required-action.missing"
        : "runtime.required-state.missing";
  } else if (hasUnexpectedDrift) {
    verdict = "warn";
    code = "runtime.unexpected-observation";
  } else {
    verdict = "allow";
  }

  return {
    $schema: UI_AST_RUNTIME_VERDICT_SCHEMA_URL,
    schemaVersion: "surfaces.ui.ast.runtime.verdict@1",
    ast: contract.ast,
    platform: evidence.platform,
    observedAt: evidence.observedAt,
    source: evidence.source,
    verdict,
    code,
    policy,
    fallbackTaken:
      verdict === "block"
        ? "preserve-approved-ui"
        : verdict === "warn"
            ? "allow-with-evidence"
            : "allow-change",
    drift: evidence.drift,
  };
}

export function buildUiAstPromotionRecord(input: {
  promotionId: string;
  promotedAt: string;
  ast: UiSurfaceAst;
  surfaceId?: string;
  lifecycle: UiAstLifecycleRecord;
  sourceRunId?: string | null;
  astPath: string;
  bundleRoot: string;
  generationPayloadPath: string;
  runtimePayloadPath: string;
  integrationEvidencePath?: string;
}): UiAstPromotionRecord {
  const surface = findSurface(input.ast, input.surfaceId);
  return {
    $schema: UI_AST_PROMOTION_SCHEMA_URL,
    schemaVersion: "surfaces.ui.ast.promotion@1",
    promotionId: input.promotionId,
    promotedAt: input.promotedAt,
    ast: makeSurfaceRef(input.ast, surface),
    lifecycleStage:
      input.lifecycle.stage === "observed" ? "observed" : "published",
    sourceRunId: input.sourceRunId ?? null,
    artifacts: {
      astPath: input.astPath,
      bundleRoot: input.bundleRoot,
      generationPayloadPath: input.generationPayloadPath,
      runtimePayloadPath: input.runtimePayloadPath,
      ...(input.integrationEvidencePath
        ? { integrationEvidencePath: input.integrationEvidencePath }
        : {}),
    },
  };
}

export function summarizeUiAstLifecycle(ast: UiSurfaceAst, surfaceId?: string): UiAstLifecycleRecord {
  return buildUiAstLifecycleRecord(ast, { surfaceId });
}

export function summarizeUiAstReview(
  before: UiSurfaceAst,
  after: UiSurfaceAst,
  surfaceId?: string,
): UiAstReviewArtifact {
  return buildUiAstReviewArtifact(before, after, surfaceId);
}
