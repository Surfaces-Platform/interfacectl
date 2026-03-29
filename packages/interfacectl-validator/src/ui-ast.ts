import AjvModule, { type ErrorObject } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import astSchema from "./schema/ui.surface.ast.schema.json" with {
  type: "json",
};
import type {
  AsyncStateKind,
  ChromePolicy,
  ColorPolicy,
  ContractConstraints,
  ContractTokenPolicies,
  FlowPolicy,
  IconPolicy,
  PageFrameLayout,
  ShellSpec,
  SurfaceGovernance,
  SurfacePhase0,
  SurfaceRuntimePolicy,
  TargetAcquisitionPolicy,
} from "./types.js";

const frozenBundledUiAstSchema = Object.freeze(astSchema) as object;

export type UiAstSurfaceKind = "application";
export type UiAstPlatform = "web" | "ios" | "android";
export type UiAstNodeKind =
  | "section"
  | "group"
  | "heading"
  | "body"
  | "field"
  | "toggle"
  | "selection"
  | "action"
  | "alert"
  | "confirmation"
  | "empty-state"
  | "list"
  | "table"
  | "detail"
  | "progress-steps";
export type UiAstActionIntent =
  | "submit"
  | "save"
  | "continue"
  | "cancel"
  | "confirm"
  | "dismiss"
  | "retry"
  | "navigate"
  | "filter"
  | "select";
export type UiAstTextRole =
  | "title"
  | "subtitle"
  | "body"
  | "label"
  | "helper"
  | "caption"
  | "error";
export type UiAstFieldType =
  | "text"
  | "email"
  | "password"
  | "number"
  | "date"
  | "textarea";
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

function createAjvValidator() {
  const ajv = new (AjvModule as unknown as new (
    options?: Record<string, unknown>,
  ) => import("ajv").default)({
    allErrors: true,
    strict: false,
  });
  (addFormats as unknown as (ajv: import("ajv").default) => void)(ajv);
  return ajv;
}

function formatAjvErrors(errors: ErrorObject[] | null | undefined): string[] {
  if (!errors) {
    return [];
  }

  return errors.map((error) => {
    const dataPath = error.instancePath || error.schemaPath;
    const baseMessage = error.message ?? "Validation error";
    if (error.params && Object.keys(error.params).length > 0) {
      return `${dataPath}: ${baseMessage} (${JSON.stringify(error.params)})`;
    }
    return `${dataPath}: ${baseMessage}`;
  });
}

export function getBundledUiAstSchema(): object {
  return frozenBundledUiAstSchema;
}

function findDuplicate(values: string[]): string | null {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      return value;
    }
    seen.add(value);
  }
  return null;
}

function validateSurfaceAst(surface: UiAstSurface): string[] {
  const errors: string[] = [];
  const nodeIds = surface.nodes.map((node) => node.id);
  const duplicateNodeId = findDuplicate(nodeIds);
  if (duplicateNodeId) {
    errors.push(`/surfaces/${surface.id}/nodes must use unique node ids (${duplicateNodeId})`);
  }

  const stateIds = (surface.states ?? []).map((state) => state.id);
  const duplicateStateId = findDuplicate(stateIds);
  if (duplicateStateId) {
    errors.push(`/surfaces/${surface.id}/states must use unique ids (${duplicateStateId})`);
  }

  const platformIds = surface.platforms.map((platform) => platform.platform);
  const duplicatePlatformId = findDuplicate(platformIds);
  if (duplicatePlatformId) {
    errors.push(
      `/surfaces/${surface.id}/platforms must use unique platform entries (${duplicatePlatformId})`,
    );
  }

  const nodeIdSet = new Set(nodeIds);
  const stateIdSet = new Set(stateIds);
  if (!nodeIdSet.has(surface.rootNodeId)) {
    errors.push(`/surfaces/${surface.id}/rootNodeId must reference a declared node`);
  }

  for (const node of surface.nodes) {
    for (const childId of node.children ?? []) {
      if (!nodeIdSet.has(childId)) {
        errors.push(
          `/surfaces/${surface.id}/nodes/${node.id}/children references missing node "${childId}"`,
        );
      }
    }
    for (const stateRef of node.stateRefs ?? []) {
      if (!stateIdSet.has(stateRef)) {
        errors.push(
          `/surfaces/${surface.id}/nodes/${node.id}/stateRefs references missing state "${stateRef}"`,
        );
      }
    }

    if (node.kind === "section" && !node.sectionId) {
      errors.push(`/surfaces/${surface.id}/nodes/${node.id} must declare sectionId when kind=section`);
    }
    if (node.kind === "action" && !node.actionIntent) {
      errors.push(`/surfaces/${surface.id}/nodes/${node.id} must declare actionIntent when kind=action`);
    }
    if (node.kind === "field" && !node.fieldType) {
      errors.push(`/surfaces/${surface.id}/nodes/${node.id} must declare fieldType when kind=field`);
    }
    if (node.kind === "selection" && !node.selectionMode) {
      errors.push(
        `/surfaces/${surface.id}/nodes/${node.id} must declare selectionMode when kind=selection`,
      );
    }
    if (node.kind === "alert" && !node.severity) {
      errors.push(`/surfaces/${surface.id}/nodes/${node.id} must declare severity when kind=alert`);
    }
    if (node.kind === "heading") {
      if (!node.textRole) {
        errors.push(`/surfaces/${surface.id}/nodes/${node.id} must declare textRole when kind=heading`);
      }
      if (
        node.headingLevel !== undefined &&
        (node.headingLevel < 1 || node.headingLevel > 6)
      ) {
        errors.push(`/surfaces/${surface.id}/nodes/${node.id} headingLevel must be between 1 and 6`);
      }
    }
  }

  return errors;
}

export function validateUiAstStructure(
  astData: unknown,
  schema: object = frozenBundledUiAstSchema,
): UiAstStructureValidation {
  const ajv = createAjvValidator();
  const validate = ajv.compile<UiSurfaceAst>(schema);
  const valid = validate(astData);

  if (!valid) {
    return {
      ok: false,
      errors: formatAjvErrors(validate.errors),
    };
  }

  const ast = astData as UiSurfaceAst;
  const surfaceIds = ast.surfaces.map((surface) => surface.id);
  const duplicateSurfaceId = findDuplicate(surfaceIds);
  if (duplicateSurfaceId) {
    return {
      ok: false,
      errors: [`/surfaces must use unique surface ids (${duplicateSurfaceId})`],
    };
  }

  const errors = ast.surfaces.flatMap((surface) => validateSurfaceAst(surface));
  if (errors.length > 0) {
    return {
      ok: false,
      errors,
    };
  }

  return {
    ok: true,
    errors: [],
    ast,
  };
}
