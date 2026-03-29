import type { SurfaceApprovalRecord, SurfaceApprovalRole, SurfaceApprovalStatus } from "./types.js";
import { type UiAstDiffEntry } from "./ui-ast-authoring.js";
import type { UiAstActionIntent, UiAstNodeKind, UiAstPlatform, UiSurfaceAst } from "./ui-ast.js";
export declare const UI_AST_LIFECYCLE_SCHEMA_URL = "https://contracts.surfaces.local/ui.ast.lifecycle.schema.json";
export declare const UI_AST_REVIEW_SCHEMA_URL = "https://contracts.surfaces.local/ui.ast.review.schema.json";
export declare const UI_AST_PROPOSAL_REQUEST_SCHEMA_URL = "https://contracts.surfaces.local/ui.ast.proposal.request.schema.json";
export declare const UI_AST_PROPOSAL_RESPONSE_SCHEMA_URL = "https://contracts.surfaces.local/ui.ast.proposal.response.schema.json";
export declare const UI_AST_INTEGRATION_SCHEMA_URL = "https://contracts.surfaces.local/ui.ast.integration.schema.json";
export declare const UI_AST_INTEGRATION_EVIDENCE_SCHEMA_URL = "https://contracts.surfaces.local/ui.ast.integration.evidence.schema.json";
export declare const UI_AST_OBSERVATION_SCHEMA_URL = "https://contracts.surfaces.local/ui.ast.observation.schema.json";
export declare const UI_AST_OBSERVED_EVIDENCE_SCHEMA_URL = "https://contracts.surfaces.local/ui.ast.observed.evidence.schema.json";
export declare const UI_AST_RUNTIME_VERDICT_SCHEMA_URL = "https://contracts.surfaces.local/ui.ast.runtime.verdict.schema.json";
export declare const UI_AST_PROMOTION_SCHEMA_URL = "https://contracts.surfaces.local/ui.ast.promotion.schema.json";
export type UiAstLifecycleStage = "draft" | "validated" | "approved" | "published" | "observed";
export type UiAstLifecycleStatus = "pending" | "passed" | "failed";
export type UiAstProposalVerdict = "pass" | "warn" | "block";
export type UiAstRuntimeVerdictStatus = "allow" | "warn" | "block" | "degrade";
export type UiAstReviewStatus = "accepted" | "proposed" | "rejected" | "needs-human-review";
export type UiAstReviewHint = "structural" | "interaction" | "state" | "governance" | "platform" | "content";
export type UiAstPrimitiveFamily = "layout.section" | "layout.group" | "content.heading" | "content.body" | "form.field" | "form.toggle" | "form.selection" | "action.button" | "feedback.alert" | "feedback.confirmation" | "feedback.empty-state" | "data.list" | "data.table" | "data.detail" | "flow.progress-steps";
export type UiAstAllowedDivergence = "presentation" | "native-control-mapping" | "density" | "layout-tuning" | "copy-length";
export type UiAstObservationSource = "browser-remote" | "edge-runtime" | "device-runtime" | "server-renderer";
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
interface ProposalOptions {
    lifecycle?: UiAstLifecycleRecord;
    repairMap?: {
        repairs?: unknown[];
    } | null;
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
export declare function buildUiAstLifecycleRecord(ast: UiSurfaceAst, options?: LifecycleOptions): UiAstLifecycleRecord;
export declare function buildUiAstReviewArtifact(before: UiSurfaceAst, after: UiSurfaceAst, surfaceId?: string): UiAstReviewArtifact;
export declare function buildUiAstProposalContract(ast: UiSurfaceAst, options?: ProposalOptions, surfaceId?: string): UiAstProposalContract;
export declare function buildUiAstIntegrationContract(ast: UiSurfaceAst, lifecycle: UiAstLifecycleRecord | undefined, surfaceId?: string): UiAstIntegrationContract;
export declare function buildUiAstIntegrationEvidence(options: IntegrationEvidenceOptions): UiAstIntegrationEvidence;
export declare function buildUiAstObservationContract(ast: UiSurfaceAst, lifecycle: UiAstLifecycleRecord | undefined, surfaceId?: string): UiAstObservationContract;
export declare function buildUiAstObservedEvidence(options: ObservationEvidenceOptions): UiAstObservedEvidence;
export declare function buildUiAstRuntimeVerdict(contract: UiAstObservationContract, evidence: UiAstObservedEvidence, policy?: "off" | "warn" | "strict"): UiAstRuntimeVerdict;
export declare function buildUiAstPromotionRecord(input: {
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
}): UiAstPromotionRecord;
export declare function summarizeUiAstLifecycle(ast: UiSurfaceAst, surfaceId?: string): UiAstLifecycleRecord;
export declare function summarizeUiAstReview(before: UiSurfaceAst, after: UiSurfaceAst, surfaceId?: string): UiAstReviewArtifact;
export {};
//# sourceMappingURL=ui-ast-control-plane.d.ts.map