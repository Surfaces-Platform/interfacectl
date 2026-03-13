import path from "node:path";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { createHash } from "node:crypto";
import { validateContractStructure, getBundledContractSchema, } from "@surfaces/interfacectl-validator";
import { normalizeContract } from "../utils/normalize.js";
const BUNDLE_VERSION = "2.0";
const SCHEMA_VERSION = "surfaces.web.contract@1";
function sortKeysRecursive(value) {
    if (value === null || value === undefined) {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map(sortKeysRecursive);
    }
    if (typeof value === "object") {
        const sorted = {};
        for (const k of Object.keys(value).sort()) {
            sorted[k] = sortKeysRecursive(value[k]);
        }
        return sorted;
    }
    return value;
}
function stringifyDeterministic(value) {
    return `${JSON.stringify(sortKeysRecursive(value), null, 2)}\n`;
}
function sha256Hex(content) {
    return createHash("sha256").update(content, "utf8").digest("hex");
}
async function writeAtomic(filePath, content) {
    const dir = path.dirname(filePath);
    await mkdir(dir, { recursive: true });
    const tmpPath = `${filePath}.tmp`;
    await writeFile(tmpPath, content, "utf8");
    await rename(tmpPath, filePath);
}
function makeBundleProvenance(contract, surfaceId) {
    return {
        contractId: contract.contractId,
        contractVersion: contract.version,
        bundleVersion: BUNDLE_VERSION,
        ...(surfaceId ? { surfaceId } : {}),
    };
}
function uniqueStrings(values) {
    const seen = new Set();
    const result = [];
    for (const value of values) {
        if (!value || seen.has(value))
            continue;
        seen.add(value);
        result.push(value);
    }
    return result;
}
function collectComponentIdsFromSlots(slots) {
    if (!slots)
        return [];
    return slots.flatMap((slot) => slot.acceptsComponents ?? []);
}
function collectSectionComponentIds(section) {
    return uniqueStrings([
        section.anatomy?.defaultComponent,
        ...(section.anatomy?.allowedComponents ?? []),
        ...collectComponentIdsFromSlots(section.anatomy?.slots),
    ]);
}
function resolveSurfaceSections(contract, _surface) {
    return contract.sections;
}
function resolveSurfaceComponents(contract, sections) {
    const referencedIds = new Set();
    for (const section of sections) {
        for (const componentId of collectSectionComponentIds(section)) {
            referencedIds.add(componentId);
        }
    }
    return (contract.components ?? []).filter((component) => referencedIds.has(component.id));
}
function buildSectionOrderHints(surface) {
    const sectionOrder = surface.layout.landingPattern?.sectionOrder ?? [];
    const requiredTopLevel = new Set(surface.layout.landingPattern?.requireTopLevelSections ?? []);
    const hints = new Map();
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
function buildSectionsPayload(contract, surface, sections) {
    const orderHints = buildSectionOrderHints(surface);
    return {
        provenance: makeBundleProvenance(contract, surface.id),
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
function buildComponentsPayload(contract, surface, components) {
    const catalog = components.map((component) => ({
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
        provenance: makeBundleProvenance(contract, surface.id),
        components: catalog,
    };
}
function resolveProfileById(profiles, profileId) {
    if (!profiles || !profileId)
        return null;
    return profiles.find((profile) => profile.id === profileId) ?? null;
}
function buildConstraintsPayload(contract, surface) {
    const selectedLayoutProfile = resolveProfileById(contract.marketingProfiles?.layout, surface.layout.landingPattern?.marketingLayoutProfile);
    const selectedTypographyProfile = resolveProfileById(contract.marketingProfiles?.typography, surface.marketingTypographyProfile);
    return {
        provenance: makeBundleProvenance(contract, surface.id),
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
function buildGuidance(contract, surface, sections) {
    const shellOwns = contract.shell?.owns ?? [];
    const mustNotEmit = surface.mustNotEmit ?? [];
    const prohibitedRoles = uniqueStrings([...shellOwns, ...mustNotEmit]);
    const hasLandingPattern = Boolean(surface.layout.landingPattern);
    const hasResponsiveRules = sections.some((section) => section.responsive?.rules?.length);
    const hasVisualPolicy = contract.color.policy !== "off" ||
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
            hasVisualPolicy ? "visual" : undefined,
            surface.flows ? "flows" : undefined,
        ]),
    };
}
function buildObservationRefs(contract) {
    const refs = [];
    if (contract.x_extracted) {
        refs.push({
            kind: "contract-field",
            path: "/x_extracted",
        });
    }
    return refs;
}
function buildGenerationPayload(contract, surface, sections) {
    const shellOwns = contract.shell?.owns ?? [];
    const mustNotEmit = surface.mustNotEmit ?? [];
    const requiredSections = surface.requiredSections;
    const landingPattern = surface.layout.landingPattern;
    const observationRefs = buildObservationRefs(contract);
    return {
        identity: {
            surfaceId: surface.id,
            displayName: surface.displayName,
            type: surface.type,
        },
        provenance: makeBundleProvenance(contract, surface.id),
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
        guidance: buildGuidance(contract, surface, sections),
        refs: {
            contract: "../../contract/normalized.json",
            sections: "./sections.json",
            components: "./components.json",
            constraints: "./constraints.json",
            ...(surface.authoring ? { authoring: "./authoring.json" } : {}),
            repairMap: "./repair-map.json",
            ...(observationRefs.length > 0 ? { evidence: observationRefs } : {}),
        },
    };
}
function buildAuthoringPayload(contract, surface) {
    if (!surface.authoring)
        return null;
    return {
        provenance: makeBundleProvenance(contract, surface.id),
        authoring: {
            ...surface.authoring,
            sourcePriority: (surface.authoring.sourcePriority ?? []).map((source) => source),
        },
    };
}
function addRepair(repairs, code, priority, category, action) {
    repairs.push({ code, priority, category, action });
}
function buildRepairMapPayload(contract, surface, sections) {
    const repairs = [];
    const shellOwns = contract.shell?.owns ?? [];
    const mustNotEmit = surface.mustNotEmit ?? [];
    const prohibitedRoles = uniqueStrings([...shellOwns, ...mustNotEmit]);
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
    }
    return {
        provenance: makeBundleProvenance(contract, surface.id),
        repairs,
    };
}
function buildSurfaceBundleFiles(contract, surface) {
    const surfaceDir = `surfaces/${surface.id}`;
    const sections = resolveSurfaceSections(contract, surface);
    const components = resolveSurfaceComponents(contract, sections);
    const constraintsPayload = buildConstraintsPayload(contract, surface);
    const generationPayload = buildGenerationPayload(contract, surface, sections);
    const sectionsPayload = buildSectionsPayload(contract, surface, sections);
    const componentsPayload = buildComponentsPayload(contract, surface, components);
    const repairMapPayload = buildRepairMapPayload(contract, surface, sections);
    const authoringPayload = buildAuthoringPayload(contract, surface);
    const files = [
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
    ];
    if (authoringPayload) {
        files.push({
            path: `${surfaceDir}/authoring.json`,
            content: stringifyDeterministic(authoringPayload),
        });
    }
    return files;
}
export async function runCompileCommand(options, toolVersion) {
    const outDir = path.resolve(options.outDir);
    const contractInput = path.resolve(options.contractPath);
    const schemaPath = options.schemaPath
        ? path.resolve(options.schemaPath)
        : undefined;
    let contractRaw;
    try {
        contractRaw = await readFile(contractInput, "utf8");
    }
    catch (err) {
        const message = err.code === "ENOENT"
            ? `Contract file not found: ${contractInput}`
            : `Failed to read contract: ${err.message}`;
        console.error(message);
        return 1;
    }
    let contractData;
    try {
        contractData = JSON.parse(contractRaw);
    }
    catch (err) {
        console.error(`Invalid contract JSON: ${err.message}`);
        return 1;
    }
    let schema;
    if (schemaPath) {
        try {
            const raw = await readFile(schemaPath, "utf8");
            schema = JSON.parse(raw);
        }
        catch (err) {
            const message = err.code === "ENOENT"
                ? `Schema file not found: ${schemaPath}`
                : `Failed to read schema: ${err.message}`;
            console.error(message);
            return 1;
        }
    }
    else {
        schema = getBundledContractSchema();
    }
    const structureResult = validateContractStructure(contractData, schema);
    if (!structureResult.ok || !structureResult.contract) {
        console.error("Contract schema validation failed:");
        for (const error of structureResult.errors) {
            console.error(`  • ${error}`);
        }
        return 1;
    }
    const contract = structureResult.contract;
    const { contract: normalizedContract } = normalizeContract(contract);
    const bundleFiles = [
        {
            path: "contract/normalized.json",
            content: stringifyDeterministic(normalizedContract),
        },
        ...normalizedContract.surfaces.flatMap((surface) => buildSurfaceBundleFiles(normalizedContract, surface)),
    ];
    const filesSorted = [...bundleFiles].sort((a, b) => a.path.localeCompare(b.path));
    const fileEntries = filesSorted.map(({ path: p, content }) => ({
        path: p,
        sha256: sha256Hex(content),
    }));
    const manifest = {
        bundleVersion: BUNDLE_VERSION,
        contractId: normalizedContract.contractId,
        contractVersion: normalizedContract.version,
        schemaVersion: SCHEMA_VERSION,
        tool: { name: "interfacectl", version: toolVersion },
        inputs: {
            contractPath: options.contractPath,
            schemaPath: schemaPath ?? null,
        },
        files: fileEntries,
    };
    const manifestContent = stringifyDeterministic(manifest);
    try {
        for (const { path: p, content } of filesSorted) {
            await writeAtomic(path.join(outDir, p), content);
        }
        await writeAtomic(path.join(outDir, "manifest.json"), manifestContent);
    }
    catch (err) {
        console.error(`Failed to write bundle: ${err.message}`);
        return 1;
    }
    return 0;
}
