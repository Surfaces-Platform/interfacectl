import path from "node:path";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  buildUiAstIntegrationContract,
  buildUiAstLifecycleRecord,
  buildUiAstObservationContract,
  buildUiAstProposalContract,
} from "@surfaces/interfacectl-validator";
import type {
  AuthoringSource,
  ContractComponent,
  ContractSection,
  ContractSlot,
  ContractSurface,
  FeedbackRecoveryPolicy,
  InterfaceContract,
  SurfaceRuntimeContextRule,
  TargetAcquisitionPolicy,
  UiAstSurface,
  UiSurfaceAst,
} from "@surfaces/interfacectl-validator";
import { normalizeContract } from "../utils/normalize.js";
import { resolveUiAstInput } from "../utils/ui-ast.js";

const BUNDLE_VERSION = "3.0";

const SCHEMA_VERSION = "surfaces.ui.ast@2";
const DEFAULT_TARGET_ACQUISITION_MODALITY = "touch-mouse";
const DEFAULT_MIN_HIT_AREA_PX = 44;
const DEFAULT_MIN_GAP_PX = 8;
const DEFAULT_MIN_EDGE_INSET_PX = 8;
const DEFAULT_DESTRUCTIVE_GAP_PX = 16;
const DEFAULT_FEEDBACK_REQUIRED_STATE_KINDS = ["loading", "empty", "error"];

export interface CompileCommandOptions {
  astPath?: string;
  contractPath?: string;
  outDir: string;
  schemaPath?: string;
  format?: "json";
}

interface ManifestInputs {
  contractPath: string;
  schemaPath: string | null;
}

interface ManifestFileEntry {
  path: string;
  sha256: string;
}

interface Manifest {
  bundleVersion: string;
  astId: string;
  astVersion: string;
  contractId: string;
  contractVersion: string;
  schemaVersion: string;
  sourceFormat: "ui-ast";
  tool: { name: string; version: string };
  inputs: ManifestInputs;
  files: ManifestFileEntry[];
}

interface BundleProvenance {
  astId: string;
  astVersion: string;
  contractId: string;
  contractVersion: string;
  bundleVersion: string;
  surfaceId?: string;
}

interface BundleFile {
  path: string;
  content: string;
}

interface ComponentCatalogEntry {
  id: string;
  intent: string;
  description?: string;
  variants?: ContractComponent["variants"];
  slots: ContractComponent["slots"];
  states?: ContractComponent["states"];
  interactions?: ContractComponent["interactions"];
  implementation?: ContractComponent["implementation"];
  references?: ContractComponent["references"];
}

interface RepairInstruction {
  code: string;
  priority: "high" | "medium" | "low";
  category: string;
  action: Record<string, unknown>;
}

function sortKeysRecursive(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sortKeysRecursive);
  }
  if (typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[k] = sortKeysRecursive((value as Record<string, unknown>)[k]);
    }
    return sorted;
  }
  return value;
}

function stringifyDeterministic(value: unknown): string {
  return `${JSON.stringify(sortKeysRecursive(value), null, 2)}\n`;
}

function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

async function writeAtomic(
  filePath: string,
  content: string,
): Promise<void> {
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  await writeFile(tmpPath, content, "utf8");
  await rename(tmpPath, filePath);
}

function makeBundleProvenance(
  ast: UiSurfaceAst,
  contract: InterfaceContract,
  surfaceId?: string,
): BundleProvenance {
  return {
    astId: ast.astId,
    astVersion: ast.version,
    contractId: contract.contractId,
    contractVersion: contract.version,
    bundleVersion: BUNDLE_VERSION,
    ...(surfaceId ? { surfaceId } : {}),
  };
}

function uniqueStrings(values: Array<string | undefined | null>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function resolveTargetAcquisitionBudget(
  budget: {
    minHitAreaPx?: number;
    minGapPx?: number;
    minEdgeInsetPx?: number;
    destructiveGapPx?: number;
  } | undefined,
) {
  return {
    minHitAreaPx: budget?.minHitAreaPx ?? DEFAULT_MIN_HIT_AREA_PX,
    minGapPx: budget?.minGapPx ?? DEFAULT_MIN_GAP_PX,
    minEdgeInsetPx: budget?.minEdgeInsetPx ?? DEFAULT_MIN_EDGE_INSET_PX,
    destructiveGapPx: budget?.destructiveGapPx ?? DEFAULT_DESTRUCTIVE_GAP_PX,
  };
}

function applyTargetAcquisitionBudget<T extends {
  minHitAreaPx: number;
  minGapPx: number;
  minEdgeInsetPx: number;
  destructiveGapPx: number;
}>(base: T, budget: {
  minHitAreaPx?: number;
  minGapPx?: number;
  minEdgeInsetPx?: number;
  destructiveGapPx?: number;
} | undefined): T {
  return {
    ...base,
    ...(budget?.minHitAreaPx !== undefined ? { minHitAreaPx: budget.minHitAreaPx } : {}),
    ...(budget?.minGapPx !== undefined ? { minGapPx: budget.minGapPx } : {}),
    ...(budget?.minEdgeInsetPx !== undefined ? { minEdgeInsetPx: budget.minEdgeInsetPx } : {}),
    ...(budget?.destructiveGapPx !== undefined
      ? { destructiveGapPx: budget.destructiveGapPx }
      : {}),
  };
}

function resolveTargetAcquisitionPolicy(
  policy: TargetAcquisitionPolicy | undefined,
) {
  if (!policy) return null;

  const resolvedBudget = applyTargetAcquisitionBudget(
    resolveTargetAcquisitionBudget(undefined),
    policy,
  );

  return {
    policy: policy.policy,
    modality: policy.modality ?? DEFAULT_TARGET_ACQUISITION_MODALITY,
    ...resolvedBudget,
    ...(policy.viewportOverrides?.length
      ? {
          viewportOverrides: policy.viewportOverrides.map((override) => ({
            viewport: override.viewport,
            ...applyTargetAcquisitionBudget(resolvedBudget, override),
          })),
        }
      : {}),
    ...(policy.contextOverrides?.length
      ? {
          contextOverrides: policy.contextOverrides.map((override) => ({
            context: override.context,
            ...applyTargetAcquisitionBudget(resolvedBudget, override),
          })),
        }
      : {}),
  };
}

function resolveFeedbackRecoveryPolicy(
  policy: FeedbackRecoveryPolicy | undefined,
  contexts: SurfaceRuntimeContextRule[] | undefined = [],
) {
  if (!policy) return null;

  return {
    policy: policy.policy,
    requiredStateKinds: [
      ...new Set(
        [
          ...(policy.requiredStateKinds ?? DEFAULT_FEEDBACK_REQUIRED_STATE_KINDS),
          ...((Array.isArray(contexts) ? contexts : [])
            .map((context) => context?.kind)
            .filter(Boolean)),
        ],
      ),
    ],
  };
}

type PolicyLevel = "off" | "warn" | "strict";

function getPolicyRank(policy: PolicyLevel | undefined): number {
  switch (policy) {
    case "strict":
      return 2;
    case "warn":
      return 1;
    case "off":
    default:
      return 0;
  }
}

function maxPolicy(...policies: Array<PolicyLevel | undefined>): PolicyLevel {
  let strongest: PolicyLevel = "off";
  for (const policy of policies) {
    if (getPolicyRank(policy) > getPolicyRank(strongest)) {
      strongest = policy ?? "off";
    }
  }
  return strongest;
}

function buildGovernancePayload(surface: ContractSurface) {
  return {
    owner: surface.owner ?? null,
    domain: surface.domain ?? null,
    phase0: surface.phase0 ?? null,
    status: surface.governance?.status ?? "draft",
    roles: surface.governance?.roles ?? {},
    approvals: surface.governance?.approvals ?? [],
  };
}

function inferMutationMode(surface: ContractSurface, sections: ContractSection[]) {
  const explicitMode = surface.runtime?.mutationEnvelope?.mode;
  if (explicitMode) return explicitMode;

  const sectionModes = uniqueStrings(
    sections.map((section) => section.editPolicy?.mode),
  );
  const allowedOperations = uniqueStrings(
    sections.flatMap((section) => section.editPolicy?.allowedOperations ?? []),
  );

  if (sectionModes.length > 0 && sectionModes.every((mode) => mode === "locked")) {
    return "locked";
  }
  if (sectionModes.includes("freeform")) {
    return "freeform";
  }
  if (allowedOperations.includes("adjust-layout")) {
    return "layout-tuning";
  }
  if (sectionModes.includes("slot-bound")) {
    return "slot-bound";
  }
  return "content-only";
}

function inferMutationScopes(actions: string[]) {
  return uniqueStrings(
    actions.flatMap((action) => {
      switch (action) {
        case "update-copy":
        case "change-media":
        case "bind-data":
          return ["content"];
        case "swap-variant":
        case "swap-component":
          return ["components"];
        case "adjust-layout":
          return ["layout"];
        case "add-section":
        case "remove-section":
        case "reorder-sections":
          return ["sections"];
        case "wire-interaction":
          return ["interactions"];
        case "reorder-items":
          return ["content", "layout"];
        default:
          return [];
      }
    }),
  );
}

function buildMutationEnvelope(
  surface: ContractSurface,
  sections: ContractSection[],
) {
  const explicit = surface.runtime?.mutationEnvelope;
  const inferredActions = uniqueStrings(
    sections.flatMap((section) => section.editPolicy?.allowedOperations ?? []),
  );
  const allowedActions = uniqueStrings([
    ...(explicit?.allowedActions ?? []),
    ...(explicit?.allowedActions ? [] : inferredActions),
    inferredActions.length === 0 ? "update-copy" : undefined,
  ]);
  const scopes = uniqueStrings([
    ...(explicit?.scopes ?? []),
    ...(explicit?.scopes ? [] : inferMutationScopes(allowedActions)),
  ]);

  return {
    mode: inferMutationMode(surface, sections),
    ...(scopes.length > 0 ? { scopes } : {}),
    ...(allowedActions.length > 0 ? { allowedActions } : {}),
    ...(explicit?.allowedSections ? { allowedSections: explicit.allowedSections } : {}),
    ...(explicit?.prohibitedSections ? { prohibitedSections: explicit.prohibitedSections } : {}),
  };
}

function buildPolicySeverities(
  contract: InterfaceContract,
  surface: ContractSurface,
): Record<string, PolicyLevel> {
  const boundary = surface.mustNotEmit?.length || contract.shell?.owns?.length
    ? "strict"
    : "off";
  const structure = maxPolicy(
    surface.requiredSections.length > 0 ? "strict" : "off",
    surface.layout.landingPattern?.policy,
  );
  const layout = maxPolicy(
    surface.layout.pageFrame?.enforcement,
    surface.layout.chromePolicy?.policy,
    surface.layout.landingPattern?.policy,
    surface.layout.landingPattern?.marketingLayoutPolicy,
  );
  const visual = maxPolicy(
    contract.color.policy,
    surface.icons?.policy,
    contract.tokens?.typography?.policy,
    contract.tokens?.motion?.policy,
    surface.marketingTypographyPolicy,
  );
  const feedbackRecoveryPolicy = surface.runtime?.feedbackRecovery?.policy ?? "off";
  const interaction = maxPolicy(surface.flows?.policy, feedbackRecoveryPolicy);
  const targetAcquisitionPolicy = surface.layout.targetAcquisition?.policy ?? "off";
  const runtime = maxPolicy(
    surface.runtime?.policy,
    boundary,
    structure,
    layout,
    visual,
    interaction,
    targetAcquisitionPolicy,
    feedbackRecoveryPolicy,
  );

  return {
    boundary,
    structure,
      layout,
      visual,
      interaction: maxPolicy(interaction, targetAcquisitionPolicy, feedbackRecoveryPolicy),
      runtime,
  };
}

function collectComponentIdsFromSlots(slots: ContractSlot[] | undefined): string[] {
  if (!slots) return [];
  return slots.flatMap((slot) => slot.acceptsComponents ?? []);
}

function collectSectionComponentIds(section: ContractSection): string[] {
  return uniqueStrings([
    section.anatomy?.defaultComponent,
    ...(section.anatomy?.allowedComponents ?? []),
    ...collectComponentIdsFromSlots(section.anatomy?.slots),
  ]);
}

function resolveSurfaceSections(
  contract: InterfaceContract,
  _surface: ContractSurface,
): ContractSection[] {
  return contract.sections;
}

function resolveSurfaceComponents(
  contract: InterfaceContract,
  sections: ContractSection[],
): ContractComponent[] {
  const referencedIds = new Set<string>();
  for (const section of sections) {
    for (const componentId of collectSectionComponentIds(section)) {
      referencedIds.add(componentId);
    }
  }

  return (contract.components ?? []).filter((component) => referencedIds.has(component.id));
}

function buildSectionOrderHints(
  surface: ContractSurface,
): Map<string, { sectionOrderIndex?: number; topLevelRequired: boolean }> {
  const sectionOrder = surface.layout.landingPattern?.sectionOrder ?? [];
  const requiredTopLevel = new Set(surface.layout.landingPattern?.requireTopLevelSections ?? []);
  const hints = new Map<string, { sectionOrderIndex?: number; topLevelRequired: boolean }>();

  for (const sectionId of sectionOrder) {
    hints.set(sectionId, {
      sectionOrderIndex: sectionOrder.indexOf(sectionId),
      topLevelRequired: requiredTopLevel.has(sectionId),
    });
  }

  for (const sectionId of requiredTopLevel) {
    const existing = hints.get(sectionId);
    hints.set(sectionId, {
      sectionOrderIndex: existing?.sectionOrderIndex,
      topLevelRequired: true,
    });
  }

  return hints;
}

function buildSectionsPayload(
  ast: UiSurfaceAst,
  contract: InterfaceContract,
  surface: ContractSurface,
  sections: ContractSection[],
) {
  const orderHints = buildSectionOrderHints(surface);

  return {
    provenance: makeBundleProvenance(ast, contract, surface.id),
    sections: sections.map((section) => {
      const hint = orderHints.get(section.id);
      return {
        id: section.id,
        intent: section.intent,
        description: section.description,
        requiredBySurface: surface.requiredSections.includes(section.id),
        ...(hint
          ? {
              orderHints: {
                ...(typeof hint.sectionOrderIndex === "number"
                  ? { sectionOrderIndex: hint.sectionOrderIndex }
                  : {}),
                topLevelRequired: hint.topLevelRequired,
              },
            }
          : {}),
        ...(section.editPolicy ? { editPolicy: section.editPolicy } : {}),
        ...(section.responsive ? { responsive: section.responsive } : {}),
        ...(section.anatomy
          ? {
              anatomy: {
                pattern: section.anatomy.pattern,
                ...(section.anatomy.defaultComponent
                  ? { defaultComponentId: section.anatomy.defaultComponent }
                  : {}),
                ...(section.anatomy.allowedComponents
                  ? { allowedComponentIds: section.anatomy.allowedComponents }
                  : {}),
                ...(section.anatomy.slots
                  ? {
                      slots: section.anatomy.slots.map((slot) => ({
                        id: slot.id,
                        kind: slot.kind,
                        required: slot.required,
                        ...(slot.repeatable !== undefined ? { repeatable: slot.repeatable } : {}),
                        ...(slot.minItems !== undefined ? { minItems: slot.minItems } : {}),
                        ...(slot.maxItems !== undefined ? { maxItems: slot.maxItems } : {}),
                        ...(slot.textRole ? { textRole: slot.textRole } : {}),
                        ...(slot.acceptsComponents
                          ? { acceptsComponentIds: slot.acceptsComponents }
                          : {}),
                        ...(slot.contentRules ? { contentRules: slot.contentRules } : {}),
                      })),
                    }
                  : {}),
              },
            }
          : {}),
      };
    }),
  };
}

function buildComponentsPayload(
  ast: UiSurfaceAst,
  contract: InterfaceContract,
  surface: ContractSurface,
  components: ContractComponent[],
) {
  const catalog: ComponentCatalogEntry[] = components.map((component) => ({
    id: component.id,
    intent: component.intent,
    ...(component.description ? { description: component.description } : {}),
    ...(component.variants ? { variants: component.variants } : {}),
    slots: component.slots,
    ...(component.states ? { states: component.states } : {}),
    ...(component.interactions ? { interactions: component.interactions } : {}),
    ...(component.implementation ? { implementation: component.implementation } : {}),
    ...(component.references ? { references: component.references } : {}),
  }));

  return {
    provenance: makeBundleProvenance(ast, contract, surface.id),
    components: catalog,
  };
}

function resolveProfileById<T extends { id: string }>(
  profiles: T[] | undefined,
  profileId: string | undefined,
): T | null {
  if (!profiles || !profileId) return null;
  return profiles.find((profile) => profile.id === profileId) ?? null;
}

function buildConstraintsPayload(
  ast: UiSurfaceAst,
  contract: InterfaceContract,
  surface: ContractSurface,
) {
  const selectedLayoutProfile = resolveProfileById(
    contract.marketingProfiles?.layout,
    surface.layout.landingPattern?.marketingLayoutProfile,
  );
  const selectedTypographyProfile = resolveProfileById(
    contract.marketingProfiles?.typography,
    surface.marketingTypographyProfile,
  );

  return {
    provenance: makeBundleProvenance(ast, contract, surface.id),
    constraints: {
      motion: contract.constraints.motion,
      color: contract.color,
      ...(contract.tokens ? { tokens: contract.tokens } : {}),
      layoutPolicy: {
        maxContentWidth: surface.layout.maxContentWidth,
        requiredContainers: surface.layout.requiredContainers ?? [],
        ...(surface.layout.pageFrame ? { pageFrame: surface.layout.pageFrame } : {}),
        ...(surface.layout.chromePolicy ? { chromePolicy: surface.layout.chromePolicy } : {}),
        ...(surface.layout.landingPattern ? { landingPattern: surface.layout.landingPattern } : {}),
        ...(resolveTargetAcquisitionPolicy(surface.layout.targetAcquisition)
          ? { targetAcquisition: resolveTargetAcquisitionPolicy(surface.layout.targetAcquisition) }
          : {}),
        ...(surface.viewports ? { viewports: surface.viewports } : {}),
      },
      ...(surface.icons ? { icons: surface.icons } : {}),
      ...(surface.flows ? { flows: surface.flows } : {}),
      marketingProfiles: {
        ...(selectedLayoutProfile ? { layout: selectedLayoutProfile } : {}),
        ...(selectedTypographyProfile ? { typography: selectedTypographyProfile } : {}),
      },
    },
  };
}

function buildGuidance(
  contract: InterfaceContract,
  surface: ContractSurface,
  sections: ContractSection[],
): Record<string, unknown> {
  const shellOwns = contract.shell?.owns ?? [];
  const mustNotEmit = surface.mustNotEmit ?? [];
  const prohibitedRoles = uniqueStrings([...shellOwns, ...mustNotEmit]);
  const hasLandingPattern = Boolean(surface.layout.landingPattern);
  const hasResponsiveRules = sections.some((section) => section.responsive?.rules?.length);
  const hasTargetAcquisition =
    Boolean(surface.layout.targetAcquisition) &&
    surface.layout.targetAcquisition?.policy !== "off";
  const hasFeedbackRecovery =
    Boolean(surface.runtime?.feedbackRecovery) &&
    surface.runtime?.feedbackRecovery?.policy !== "off";
  const hasVisualPolicy =
    contract.color.policy !== "off" ||
    Boolean(surface.icons && surface.icons.policy !== "off") ||
    Boolean(contract.tokens && Object.keys(contract.tokens).length > 0);

  return {
    priorities: [
      { id: "boundary", rank: 1 },
      { id: "structure", rank: 2 },
      { id: "layout", rank: 3 },
      { id: "visual", rank: 4 },
      { id: "interaction", rank: 5 },
    ],
    requiredOutputs: [
      { type: "surface-content", required: true },
      ...surface.requiredSections.map((sectionId) => ({
        type: "section",
        sectionId,
        required: true,
      })),
    ],
    doNotEmitRoles: prohibitedRoles,
    boundaryRules: [
      {
        id: "shell-ownership",
        shellOwns,
        mustNotEmit,
        ...(contract.shell?.contentSlot ? { contentSlot: contract.shell.contentSlot } : {}),
      },
    ],
    generationFocusOrder: uniqueStrings([
      "boundary",
      "sections",
      hasLandingPattern ? "landing-pattern" : undefined,
      hasResponsiveRules ? "responsive" : undefined,
      "layout",
      hasTargetAcquisition ? "target-acquisition" : undefined,
      hasFeedbackRecovery ? "feedback-recovery" : undefined,
      hasVisualPolicy ? "visual" : undefined,
      surface.flows ? "flows" : undefined,
    ]),
  };
}

function buildAstPayload(
  ast: UiSurfaceAst,
  contract: InterfaceContract,
  astSurface: UiAstSurface,
  surface: ContractSurface,
) {
  return {
    provenance: makeBundleProvenance(ast, contract, surface.id),
    ast: {
      kind: astSurface.kind,
      rootNodeId: astSurface.rootNodeId,
      nodes: astSurface.nodes,
      states: astSurface.states ?? [],
      migrationEscalations:
        ast.migration?.escalations.filter((entry) => entry.surfaceId === surface.id) ?? [],
    },
  };
}

function buildPlatformsPayload(
  ast: UiSurfaceAst,
  contract: InterfaceContract,
  astSurface: UiAstSurface,
  surface: ContractSurface,
) {
  return {
    provenance: makeBundleProvenance(ast, contract, surface.id),
    platforms: astSurface.platforms,
  };
}

function buildObservationRefs(contract: InterfaceContract): Array<Record<string, unknown>> {
  const refs: Array<Record<string, unknown>> = [];
  if (contract.x_extracted) {
    refs.push({
      kind: "contract-field",
      path: "/x_extracted",
    });
  }
  return refs;
}

function buildGenerationPayload(
  ast: UiSurfaceAst,
  contract: InterfaceContract,
  surface: ContractSurface,
  sections: ContractSection[],
  astSurface: UiAstSurface,
) {
  const shellOwns = contract.shell?.owns ?? [];
  const mustNotEmit = surface.mustNotEmit ?? [];
  const requiredSections = surface.requiredSections;
  const landingPattern = surface.layout.landingPattern;
  const targetAcquisition = resolveTargetAcquisitionPolicy(
    surface.layout.targetAcquisition,
  );
  const feedbackRecovery = resolveFeedbackRecoveryPolicy(
    surface.runtime?.feedbackRecovery,
    surface.runtime?.contexts,
  );
  const observationRefs = buildObservationRefs(contract);
  const governance = buildGovernancePayload(surface);
  const adaptation = {
    policy: surface.runtime?.policy ?? buildPolicySeverities(contract, surface).runtime,
    mutationEnvelope: buildMutationEnvelope(surface, sections),
    contextIds: (surface.runtime?.contexts ?? []).map((context) => context.id),
    ...(feedbackRecovery ? { feedbackRecovery } : {}),
  };

  return {
    identity: {
      surfaceId: surface.id,
      displayName: surface.displayName,
      type: surface.type,
    },
    provenance: makeBundleProvenance(ast, contract, surface.id),
    ast: {
      rootNodeId: astSurface.rootNodeId,
      nodeCount: astSurface.nodes.length,
      stateCount: astSurface.states?.length ?? 0,
      platformIds: astSurface.platforms.map((platform) => platform.platform),
    },
    boundary: {
      shellOwns,
      contentSlot: contract.shell?.contentSlot ?? null,
      mustNotEmit,
      allowSources: surface.shellOwnedPrimitiveAllowSources ?? [],
    },
    structure: {
      requiredSectionIds: requiredSections,
      sectionOrder: landingPattern?.sectionOrder ?? [],
      topLevelSectionIds: landingPattern?.requireTopLevelSections ?? [],
      flowSummary: surface.flows
        ? {
            policy: surface.flows.policy,
            flowIds: surface.flows.requirements.map((flow) => flow.flowId),
            requirementCount: surface.flows.requirements.length,
          }
        : null,
      sectionCount: sections.length,
    },
    layout: {
      maxContentWidth: surface.layout.maxContentWidth,
      requiredContainers: surface.layout.requiredContainers ?? [],
      ...(surface.layout.pageFrame ? { pageFrame: surface.layout.pageFrame } : {}),
      ...(surface.layout.chromePolicy ? { chromePolicy: surface.layout.chromePolicy } : {}),
      ...(landingPattern ? { landingPattern } : {}),
      ...(targetAcquisition ? { targetAcquisition } : {}),
      viewportIds: (surface.viewports ?? []).map((viewport) => viewport.id),
    },
    visual: {
      allowedFonts: surface.allowedFonts,
      color: {
        policy: contract.color.policy,
        allowedValuesCount: contract.color.allowedValues.length,
      },
      icons: surface.icons
        ? {
            policy: surface.icons.policy,
            allowedSourcesCount: surface.icons.allowedSources.length,
          }
        : null,
      motion: {
        allowedDurationsMs: contract.constraints.motion.allowedDurationsMs,
        allowedTimingFunctions: contract.constraints.motion.allowedTimingFunctions,
      },
      typography: {
        marketingProfileId: surface.marketingTypographyProfile ?? null,
        marketingPolicy: surface.marketingTypographyPolicy ?? "off",
        tokenPolicyCategories: Object.keys(contract.tokens ?? {}),
      },
    },
    governance,
    adaptation,
    guidance: buildGuidance(contract, surface, sections),
    refs: {
      ast: "../../ast/normalized.json",
      contract: "../../derived/contract.normalized.json",
      astSlice: "./ast.json",
      platforms: "./platforms.json",
      lifecycle: "./lifecycle.json",
      proposal: "./proposal.json",
      integration: "./integration.json",
      sections: "./sections.json",
      components: "./components.json",
      constraints: "./constraints.json",
      ...(surface.authoring ? { authoring: "./authoring.json" } : {}),
      repairMap: "./repair-map.json",
      runtime: "./runtime.json",
      ...(observationRefs.length > 0 ? { evidence: observationRefs } : {}),
    },
  };
}

function buildAuthoringPayload(
  ast: UiSurfaceAst,
  contract: InterfaceContract,
  surface: ContractSurface,
) {
  if (!surface.authoring) return null;

  return {
    provenance: makeBundleProvenance(ast, contract, surface.id),
    authoring: {
      ...surface.authoring,
      sourcePriority: (surface.authoring.sourcePriority ?? []).map(
        (source: AuthoringSource) => source,
      ),
    },
  };
}

function buildLifecyclePayload(
  ast: UiSurfaceAst,
  contract: InterfaceContract,
  surface: ContractSurface,
) {
  return {
    provenance: makeBundleProvenance(ast, contract, surface.id),
    lifecycle: buildUiAstLifecycleRecord(ast, {
      surfaceId: surface.id,
      validationStatus: "passed",
    }),
  };
}

function buildProposalPayload(
  ast: UiSurfaceAst,
  contract: InterfaceContract,
  surface: ContractSurface,
  repairMapPayload: { repairs?: unknown[] },
) {
  const lifecycle = buildUiAstLifecycleRecord(ast, {
    surfaceId: surface.id,
    validationStatus: "passed",
  });
  return {
    provenance: makeBundleProvenance(ast, contract, surface.id),
    proposal: buildUiAstProposalContract(
      ast,
      {
        lifecycle,
        repairMap: repairMapPayload,
      },
      surface.id,
    ),
  };
}

function buildIntegrationPayload(
  ast: UiSurfaceAst,
  contract: InterfaceContract,
  surface: ContractSurface,
) {
  const lifecycle = buildUiAstLifecycleRecord(ast, {
    surfaceId: surface.id,
    validationStatus: "passed",
  });
  return {
    provenance: makeBundleProvenance(ast, contract, surface.id),
    integration: buildUiAstIntegrationContract(ast, lifecycle, surface.id),
  };
}

function buildObservationPayload(
  ast: UiSurfaceAst,
  contract: InterfaceContract,
  surface: ContractSurface,
) {
  const lifecycle = buildUiAstLifecycleRecord(ast, {
    surfaceId: surface.id,
    validationStatus: "passed",
  });
  return {
    provenance: makeBundleProvenance(ast, contract, surface.id),
    observation: buildUiAstObservationContract(ast, lifecycle, surface.id),
  };
}

function addRepair(
  repairs: RepairInstruction[],
  code: string,
  priority: RepairInstruction["priority"],
  category: string,
  action: Record<string, unknown>,
): void {
  repairs.push({ code, priority, category, action });
}

function buildRepairMapPayload(
  ast: UiSurfaceAst,
  contract: InterfaceContract,
  surface: ContractSurface,
  sections: ContractSection[],
) {
  const repairs: RepairInstruction[] = [];
  const shellOwns = contract.shell?.owns ?? [];
  const mustNotEmit = surface.mustNotEmit ?? [];
  const prohibitedRoles = uniqueStrings([...shellOwns, ...mustNotEmit]);
  const targetAcquisition = resolveTargetAcquisitionPolicy(
    surface.layout.targetAcquisition,
  );
  const feedbackRecovery = resolveFeedbackRecoveryPolicy(
    surface.runtime?.feedbackRecovery,
    surface.runtime?.contexts,
  );

  if (prohibitedRoles.length > 0) {
    addRepair(repairs, "shell.primitive.disallowed", "high", "boundary", {
      type: "remove-prohibited-primitives",
      prohibitedRoles,
      ...(contract.shell?.contentSlot ? { contentSlot: contract.shell.contentSlot } : {}),
      allowSources: surface.shellOwnedPrimitiveAllowSources ?? [],
    });
  }

  if (surface.requiredSections.length > 0) {
    addRepair(repairs, "section.missing", "high", "structure", {
      type: "ensure-required-sections",
      sectionIds: surface.requiredSections,
    });
  }

  if (sections.length > 0) {
    addRepair(repairs, "section.unexpected", "medium", "structure", {
      type: "restrict-section-set",
      allowedSectionIds: sections.map((section) => section.id),
    });
  }

  addRepair(repairs, "font.disallowed", "medium", "visual", {
    type: "restrict-fonts",
    allowedFonts: surface.allowedFonts,
  });

  if (contract.color.policy !== "off" || contract.color.allowedValues.length > 0) {
    addRepair(repairs, "color.disallowed", "medium", "visual", {
      type: "restrict-colors",
      policy: contract.color.policy,
      allowedValues: contract.color.allowedValues,
    });
  }

  if (surface.icons && (surface.icons.policy !== "off" || surface.icons.allowedSources.length > 0)) {
    addRepair(repairs, "icon.source-disallowed", "medium", "visual", {
      type: "restrict-icon-sources",
      policy: surface.icons.policy,
      allowedSources: surface.icons.allowedSources,
    });
  }

  if (contract.tokens?.typography && contract.tokens.typography.policy !== "off") {
    addRepair(repairs, "token.disallowed", "medium", "visual", {
      type: "restrict-tokens",
      tokenCategory: "typography",
      policy: contract.tokens.typography.policy,
      allowedTokens: contract.tokens.typography.allowedTokens,
    });
  }

  if (contract.tokens?.layout && contract.tokens.layout.policy !== "off") {
    addRepair(repairs, "token.disallowed", "medium", "layout", {
      type: "restrict-tokens",
      tokenCategory: "layout",
      policy: contract.tokens.layout.policy,
      allowedTokens: contract.tokens.layout.allowedTokens,
    });
  }

  if (contract.tokens?.motion && contract.tokens.motion.policy !== "off") {
    addRepair(repairs, "token.disallowed", "medium", "visual", {
      type: "restrict-tokens",
      tokenCategory: "motion",
      policy: contract.tokens.motion.policy,
      allowedTokens: contract.tokens.motion.allowedTokens,
    });
  }

  addRepair(repairs, "motion.duration", "medium", "visual", {
    type: "restrict-motion-durations",
    allowedDurationsMs: contract.constraints.motion.allowedDurationsMs,
  });
  addRepair(repairs, "motion.timing", "medium", "visual", {
    type: "restrict-motion-timing",
    allowedTimingFunctions: contract.constraints.motion.allowedTimingFunctions,
  });

  if (surface.layout.maxContentWidth !== undefined) {
    addRepair(repairs, "layout.width-exceeded", "medium", "layout", {
      type: "reduce-content-width",
      maxContentWidth: surface.layout.maxContentWidth,
    });
  }

  if ((surface.layout.requiredContainers ?? []).length > 0) {
    addRepair(repairs, "layout.container-missing", "medium", "layout", {
      type: "ensure-required-containers",
      requiredContainers: surface.layout.requiredContainers,
    });
  }

  if (surface.layout.pageFrame) {
    addRepair(repairs, "layout.pageframe.maxwidth-mismatch", "medium", "layout", {
      type: "align-page-frame",
      pageFrame: surface.layout.pageFrame,
    });
    addRepair(repairs, "layout.pageframe.padding-mismatch", "medium", "layout", {
      type: "align-page-frame",
      pageFrame: surface.layout.pageFrame,
    });
  }

  if (surface.layout.landingPattern && surface.layout.landingPattern.policy !== "off") {
    addRepair(repairs, "landing.pattern.signal-missing", "high", "layout", {
      type: "restore-landing-pattern-signals",
      landingPattern: surface.layout.landingPattern,
    });
    addRepair(repairs, "landing.pattern.top-level-missing", "high", "layout", {
      type: "restore-top-level-sections",
      sectionIds: surface.layout.landingPattern.requireTopLevelSections ?? [],
    });
    addRepair(repairs, "landing.pattern.section-order", "medium", "layout", {
      type: "restore-section-order",
      sectionOrder: surface.layout.landingPattern.sectionOrder ?? [],
    });
    addRepair(repairs, "landing.pattern.background-mode", "medium", "layout", {
      type: "restore-page-background-mode",
      pageBackgroundMode: surface.layout.landingPattern.pageBackgroundMode ?? null,
    });
  }

  if (surface.marketingTypographyProfile && surface.marketingTypographyPolicy !== "off") {
    addRepair(repairs, "marketing.typography.profile-missing", "medium", "visual", {
      type: "restore-marketing-typography-profile",
      profileId: surface.marketingTypographyProfile,
      policy: surface.marketingTypographyPolicy ?? "warn",
    });
  }

  if (surface.flows && surface.flows.policy !== "off") {
    addRepair(repairs, "descriptor.flows.missing", "high", "interaction", {
      type: "restore-flow-observability",
      requirements: surface.flows.requirements,
    });
    addRepair(repairs, "flow.required.missing", "high", "interaction", {
      type: "restore-required-flows",
      requirements: surface.flows.requirements,
    });
    addRepair(repairs, "flow.steps.required", "medium", "interaction", {
      type: "restore-required-flow-steps",
      requirements: surface.flows.requirements,
    });
    addRepair(repairs, "flow.transition.required", "medium", "interaction", {
      type: "restore-required-transitions",
      requirements: surface.flows.requirements,
    });
    addRepair(repairs, "flow.unobservable", "medium", "interaction", {
      type: "restore-flow-observability",
      requirements: surface.flows.requirements,
    });
  }

  if (targetAcquisition && targetAcquisition.policy !== "off") {
    addRepair(repairs, "target.hit-area-too-small", "medium", "interaction", {
      type: "increase-hit-area",
      policy: targetAcquisition.policy,
      modality: targetAcquisition.modality,
      minHitAreaPx: targetAcquisition.minHitAreaPx,
    });
    addRepair(repairs, "target.gap-too-tight", "medium", "interaction", {
      type: "increase-target-gap",
      policy: targetAcquisition.policy,
      modality: targetAcquisition.modality,
      minGapPx: targetAcquisition.minGapPx,
    });
    addRepair(repairs, "target.edge-inset-too-small", "medium", "interaction", {
      type: "move-away-from-edge",
      policy: targetAcquisition.policy,
      modality: targetAcquisition.modality,
      minEdgeInsetPx: targetAcquisition.minEdgeInsetPx,
    });
    addRepair(repairs, "target.destructive-too-close", "high", "interaction", {
      type: "separate-destructive-action",
      policy: targetAcquisition.policy,
      modality: targetAcquisition.modality,
      destructiveGapPx: targetAcquisition.destructiveGapPx,
    });
  }

  if (feedbackRecovery && feedbackRecovery.policy !== "off") {
    addRepair(repairs, "feedback.state-missing", "high", "runtime", {
      type: "add-loading-state",
      policy: feedbackRecovery.policy,
      requiredStateKinds: feedbackRecovery.requiredStateKinds,
    });
    addRepair(repairs, "feedback.state-missing", "high", "runtime", {
      type: "add-empty-state",
      policy: feedbackRecovery.policy,
      requiredStateKinds: feedbackRecovery.requiredStateKinds,
    });
    addRepair(repairs, "feedback.recovery-action-missing", "medium", "runtime", {
      type: "add-error-retry",
      policy: feedbackRecovery.policy,
    });
    addRepair(repairs, "feedback.last-good-content-missing", "medium", "runtime", {
      type: "preserve-last-good-content",
      policy: feedbackRecovery.policy,
    });
    addRepair(repairs, "feedback.pending-action-not-blocked", "medium", "runtime", {
      type: "disable-pending-submit",
      policy: feedbackRecovery.policy,
    });
  }

  return {
    provenance: makeBundleProvenance(ast, contract, surface.id),
    repairs,
  };
}

function buildRuntimePayload(
  ast: UiSurfaceAst,
  contract: InterfaceContract,
  surface: ContractSurface,
  sections: ContractSection[],
  components: ContractComponent[],
  astSurface: UiAstSurface,
) {
  const policySeverities = buildPolicySeverities(contract, surface);
  const mutationEnvelope = buildMutationEnvelope(surface, sections);
  const targetAcquisition = resolveTargetAcquisitionPolicy(
    surface.layout.targetAcquisition,
  );
  const feedbackRecovery = resolveFeedbackRecoveryPolicy(
    surface.runtime?.feedbackRecovery,
    surface.runtime?.contexts,
  );

  return {
    provenance: makeBundleProvenance(ast, contract, surface.id),
    identity: {
      surfaceId: surface.id,
      displayName: surface.displayName,
      type: surface.type,
    },
    ast: {
      rootNodeId: astSurface.rootNodeId,
      nodeCount: astSurface.nodes.length,
      stateCount: astSurface.states?.length ?? 0,
      platformIds: astSurface.platforms.map((platform) => platform.platform),
    },
    governance: buildGovernancePayload(surface),
    runtime: {
      policy: surface.runtime?.policy ?? policySeverities.runtime,
      policySeverities,
      mutationEnvelope,
      contexts: surface.runtime?.contexts ?? [],
      ...(feedbackRecovery ? { feedbackRecovery } : {}),
      boundary: {
        shellOwns: contract.shell?.owns ?? [],
        contentSlot: contract.shell?.contentSlot ?? null,
        mustNotEmit: surface.mustNotEmit ?? [],
        allowSources: surface.shellOwnedPrimitiveAllowSources ?? [],
      },
      structure: {
        requiredSections: surface.requiredSections,
        allowedSections: sections.map((section) => section.id),
        allowedComponents: components.map((component) => component.id),
        ...(surface.flows
          ? {
              flowSummary: {
                policy: surface.flows.policy,
                flowIds: surface.flows.requirements.map((flow) => flow.flowId),
                requirementCount: surface.flows.requirements.length,
              },
            }
          : {}),
      },
      layout: {
        maxContentWidth: surface.layout.maxContentWidth,
        requiredContainers: surface.layout.requiredContainers ?? [],
        ...(surface.layout.pageFrame ? { pageFrame: surface.layout.pageFrame } : {}),
        ...(surface.layout.chromePolicy ? { chromePolicy: surface.layout.chromePolicy } : {}),
        ...(surface.layout.landingPattern ? { landingPattern: surface.layout.landingPattern } : {}),
        ...(surface.viewports ? { viewports: surface.viewports } : {}),
      },
      visual: {
        allowedFonts: surface.allowedFonts,
        color: contract.color,
        motion: contract.constraints.motion,
        ...(contract.tokens ? { tokens: contract.tokens } : {}),
        ...(surface.icons ? { icons: surface.icons } : {}),
      },
      ...((surface.flows || targetAcquisition)
        ? {
            interaction: {
              ...(surface.flows ? { flows: surface.flows } : {}),
              ...(targetAcquisition ? { targetAcquisition } : {}),
            },
          }
        : {}),
    },
    refs: {
      ast: "../../ast/normalized.json",
      contract: "../../derived/contract.normalized.json",
      astSlice: "./ast.json",
      platforms: "./platforms.json",
      lifecycle: "./lifecycle.json",
      integration: "./integration.json",
      observation: "./observation.json",
      sections: "./sections.json",
      components: "./components.json",
      constraints: "./constraints.json",
      repairMap: "./repair-map.json",
    },
  };
}

function buildSurfaceBundleFiles(
  ast: UiSurfaceAst,
  contract: InterfaceContract,
  surface: ContractSurface,
  astSurface: UiAstSurface,
): BundleFile[] {
  const surfaceDir = `surfaces/${surface.id}`;
  const sections = resolveSurfaceSections(contract, surface);
  const components = resolveSurfaceComponents(contract, sections);
  const astPayload = buildAstPayload(ast, contract, astSurface, surface);
  const platformsPayload = buildPlatformsPayload(ast, contract, astSurface, surface);
  const lifecyclePayload = buildLifecyclePayload(ast, contract, surface);
  const constraintsPayload = buildConstraintsPayload(ast, contract, surface);
  const generationPayload = buildGenerationPayload(ast, contract, surface, sections, astSurface);
  const sectionsPayload = buildSectionsPayload(ast, contract, surface, sections);
  const componentsPayload = buildComponentsPayload(ast, contract, surface, components);
  const repairMapPayload = buildRepairMapPayload(ast, contract, surface, sections);
  const proposalPayload = buildProposalPayload(ast, contract, surface, repairMapPayload);
  const integrationPayload = buildIntegrationPayload(ast, contract, surface);
  const authoringPayload = buildAuthoringPayload(ast, contract, surface);
  const runtimePayload = buildRuntimePayload(ast, contract, surface, sections, components, astSurface);
  const observationPayload = buildObservationPayload(ast, contract, surface);

  const files: BundleFile[] = [
    {
      path: `${surfaceDir}/ast.json`,
      content: stringifyDeterministic(astPayload),
    },
    {
      path: `${surfaceDir}/platforms.json`,
      content: stringifyDeterministic(platformsPayload),
    },
    {
      path: `${surfaceDir}/lifecycle.json`,
      content: stringifyDeterministic(lifecyclePayload),
    },
    {
      path: `${surfaceDir}/proposal.json`,
      content: stringifyDeterministic(proposalPayload),
    },
    {
      path: `${surfaceDir}/integration.json`,
      content: stringifyDeterministic(integrationPayload),
    },
    {
      path: `${surfaceDir}/generation.json`,
      content: stringifyDeterministic(generationPayload),
    },
    {
      path: `${surfaceDir}/sections.json`,
      content: stringifyDeterministic(sectionsPayload),
    },
    {
      path: `${surfaceDir}/components.json`,
      content: stringifyDeterministic(componentsPayload),
    },
    {
      path: `${surfaceDir}/constraints.json`,
      content: stringifyDeterministic(constraintsPayload),
    },
    {
      path: `${surfaceDir}/repair-map.json`,
      content: stringifyDeterministic(repairMapPayload),
    },
    {
      path: `${surfaceDir}/runtime.json`,
      content: stringifyDeterministic(runtimePayload),
    },
    {
      path: `${surfaceDir}/observation.json`,
      content: stringifyDeterministic(observationPayload),
    },
  ];

  if (authoringPayload) {
    files.push({
      path: `${surfaceDir}/authoring.json`,
      content: stringifyDeterministic(authoringPayload),
    });
  }

  return files;
}

export async function runCompileCommand(
  options: CompileCommandOptions,
  toolVersion: string,
): Promise<number> {
  const outDir = path.resolve(options.outDir);
  const workspaceRoot = process.cwd();
  const resolvedInput = await resolveUiAstInput({
    workspaceRoot,
    astPath: options.astPath,
    contractPath: options.contractPath,
    schemaPath: options.schemaPath,
  });

  if ("error" in resolvedInput) {
    console.error(resolvedInput.error);
    return 1;
  }

  for (const warning of resolvedInput.warnings) {
    console.error(`Warning: ${warning}`);
  }

  const ast = resolvedInput.ast;
  const { contract: normalizedContract } = normalizeContract(
    resolvedInput.derivedContract,
  );
  const surfaceMap = new Map(ast.surfaces.map((surface) => [surface.id, surface]));

  const bundleFiles: BundleFile[] = [
    {
      path: "ast/normalized.json",
      content: stringifyDeterministic(ast),
    },
    {
      path: "derived/contract.normalized.json",
      content: stringifyDeterministic(normalizedContract),
    },
    ...normalizedContract.surfaces.flatMap((surface) =>
      buildSurfaceBundleFiles(
        ast,
        normalizedContract,
        surface,
        surfaceMap.get(surface.id) ?? {
          id: surface.id,
          displayName: surface.displayName,
          kind: "application",
          rootNodeId: `${surface.id}.root`,
          nodes: [
            {
              id: `${surface.id}.root`,
              kind: "group",
              label: surface.displayName,
              children: surface.requiredSections,
            },
            ...surface.requiredSections.map((sectionId) => ({
              id: sectionId,
              kind: "section" as const,
              sectionId,
              intent: "section",
              label: sectionId,
            })),
          ],
          platforms: [
            {
              platform: "web",
              allowedFonts: surface.allowedFonts,
              layout: {
                maxContentWidth: surface.layout.maxContentWidth,
                ...(surface.layout.requiredContainers
                  ? { requiredContainers: surface.layout.requiredContainers }
                  : {}),
                ...(surface.layout.pageFrame ? { pageFrame: surface.layout.pageFrame } : {}),
                ...(surface.layout.chromePolicy
                  ? { chromePolicy: surface.layout.chromePolicy }
                  : {}),
                ...(surface.layout.targetAcquisition
                  ? { targetAcquisition: surface.layout.targetAcquisition }
                  : {}),
              },
            },
          ],
        },
      ),
    ),
  ];

  const filesSorted = [...bundleFiles].sort((a, b) =>
    a.path.localeCompare(b.path),
  );
  const fileEntries: ManifestFileEntry[] = filesSorted.map(({ path: p, content }) => ({
    path: p,
    sha256: sha256Hex(content),
  }));

  const manifest: Manifest = {
    bundleVersion: BUNDLE_VERSION,
    astId: ast.astId,
    astVersion: ast.version,
    contractId: normalizedContract.contractId,
    contractVersion: normalizedContract.version,
    schemaVersion: SCHEMA_VERSION,
    sourceFormat: "ui-ast",
    tool: { name: "interfacectl", version: toolVersion },
    inputs: {
      contractPath: resolvedInput.sourcePath,
      schemaPath: options.schemaPath ?? null,
    },
    files: fileEntries,
  };

  const manifestContent = stringifyDeterministic(manifest);

  try {
    for (const { path: p, content } of filesSorted) {
      await writeAtomic(path.join(outDir, p), content);
    }
    await writeAtomic(path.join(outDir, "manifest.json"), manifestContent);
  } catch (err) {
    console.error(`Failed to write bundle: ${(err as Error).message}`);
    return 1;
  }

  return 0;
}
