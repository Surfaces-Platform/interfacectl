import type { AsyncStateKind, ChromePolicy, ColorPolicy, ContractConstraints, ContractTokenPolicies, FlowPolicy, IconPolicy, PageFrameLayout, ShellSpec, SurfaceGovernance, SurfacePhase0, SurfaceRuntimePolicy, TargetAcquisitionPolicy } from "./types.js";
export type UiAstSurfaceKind = "application";
export type UiAstPlatform = "web" | "ios" | "android";
export type UiAstNodeKind = "section" | "group" | "heading" | "body" | "field" | "toggle" | "selection" | "action" | "alert" | "confirmation" | "empty-state" | "list" | "table" | "detail" | "progress-steps";
export type UiAstActionIntent = "submit" | "save" | "continue" | "cancel" | "confirm" | "dismiss" | "retry" | "navigate" | "filter" | "select";
export type UiAstTextRole = "title" | "subtitle" | "body" | "label" | "helper" | "caption" | "error";
export type UiAstFieldType = "text" | "email" | "password" | "number" | "date" | "textarea";
export type UiAstSelectionMode = "single" | "multiple";
export type UiAstAlertSeverity = "info" | "success" | "warning" | "error";
export interface UiAstLayoutPolicy {
    maxContentWidth: number;
    requiredContainers?: string[];
    pageFrame?: PageFrameLayout;
    chromePolicy?: ChromePolicy;
    targetAcquisition?: TargetAcquisitionPolicy;
}
export interface UiAstPlatformProjection {
    platform: UiAstPlatform;
    path?: string;
    domain?: string;
    allowedFonts?: string[];
    layout?: UiAstLayoutPolicy;
    mustNotEmit?: string[];
    shellOwnedPrimitiveAllowSources?: string[];
    notes?: string;
}
export interface UiAstStateRef {
    id: string;
    kind?: AsyncStateKind;
    description?: string;
}
export interface UiAstNode {
    id: string;
    kind: UiAstNodeKind;
    label?: string;
    description?: string;
    children?: string[];
    sectionId?: string;
    intent?: string;
    textRole?: UiAstTextRole;
    headingLevel?: number;
    fieldType?: UiAstFieldType;
    selectionMode?: UiAstSelectionMode;
    actionId?: string;
    actionIntent?: UiAstActionIntent;
    severity?: UiAstAlertSeverity;
    stateRefs?: string[];
    platformVisibility?: UiAstPlatform[];
}
export interface UiAstMigrationEscalation {
    surfaceId?: string;
    code: string;
    message: string;
}
export interface UiAstMigrationMetadata {
    sourceFormat: string;
    escalations: UiAstMigrationEscalation[];
}
export interface UiAstSurface {
    id: string;
    displayName: string;
    kind: UiAstSurfaceKind;
    rootNodeId: string;
    nodes: UiAstNode[];
    platforms: UiAstPlatformProjection[];
    states?: UiAstStateRef[];
    owner?: string;
    phase0?: SurfacePhase0;
    governance?: SurfaceGovernance;
    icons?: IconPolicy;
    flows?: FlowPolicy;
    runtime?: SurfaceRuntimePolicy;
}
export interface UiSurfaceAst {
    $schema?: string;
    astId: string;
    version: string;
    description?: string;
    constraints: ContractConstraints;
    color: ColorPolicy;
    tokens?: ContractTokenPolicies;
    shell?: ShellSpec;
    surfaces: UiAstSurface[];
    migration?: UiAstMigrationMetadata;
}
export interface UiAstStructureValidation {
    ok: boolean;
    errors: string[];
    ast?: UiSurfaceAst;
}
export declare function getBundledUiAstSchema(): object;
export declare function validateUiAstStructure(astData: unknown, schema?: object): UiAstStructureValidation;
//# sourceMappingURL=ui-ast.d.ts.map