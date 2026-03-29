import path from "node:path";
import { access, readFile } from "node:fs/promises";
import { getBundledContractSchema, getBundledUiAstSchema, validateContractStructure, validateUiAstStructure, } from "@surfaces/interfacectl-validator";
export const DEFAULT_AST_PATH = "contracts/ui.surface.ast.json";
export const DEFAULT_LEGACY_CONTRACT_PATH = "contracts/surfaces.web.contract.json";
const AST_SCHEMA_URL = "https://contracts.surfaces.local/ui.surface.ast.schema.json";
async function fileExists(filePath) {
    try {
        await access(filePath);
        return true;
    }
    catch {
        return false;
    }
}
async function loadJson(filePath, label) {
    try {
        const raw = await readFile(filePath, "utf8");
        return {
            ok: true,
            value: JSON.parse(raw),
        };
    }
    catch (error) {
        if (error.code === "ENOENT") {
            return {
                ok: false,
                error: `${label} file not found at ${filePath}`,
            };
        }
        return {
            ok: false,
            error: `Failed to read ${label} JSON at ${filePath}: ${error.message}`,
        };
    }
}
function resolveCandidatePath(workspaceRoot, candidate) {
    if (!candidate)
        return undefined;
    return path.isAbsolute(candidate)
        ? candidate
        : path.resolve(workspaceRoot, candidate);
}
function makeRootNodeId(surfaceId) {
    return `${surfaceId}.root`;
}
function pickSectionOrder(surface) {
    const landingPatternOrder = surface.layout.landingPattern?.sectionOrder ?? [];
    const seen = new Set();
    const ordered = [];
    for (const sectionId of [...landingPatternOrder, ...surface.requiredSections]) {
        if (!sectionId || seen.has(sectionId)) {
            continue;
        }
        seen.add(sectionId);
        ordered.push(sectionId);
    }
    return ordered;
}
function buildSectionNode(section) {
    return {
        id: section.id,
        kind: "section",
        sectionId: section.id,
        intent: section.intent,
        label: section.intent,
        description: section.description,
    };
}
function appendEscalation(escalations, surfaceId, code, message) {
    escalations.push({ surfaceId, code, message });
}
function migrateSurfaceToUiAst(surface, contract) {
    const escalations = [];
    const orderedSections = pickSectionOrder(surface);
    const contractSections = new Map(contract.sections.map((section) => [section.id, section]));
    const rootNodeId = makeRootNodeId(surface.id);
    const nodes = [
        {
            id: rootNodeId,
            kind: "group",
            label: surface.displayName,
            description: `Root group for ${surface.displayName}.`,
            children: orderedSections,
        },
        ...orderedSections.map((sectionId) => buildSectionNode(contractSections.get(sectionId) ?? {
            id: sectionId,
            intent: "section",
            description: `Migrated section ${sectionId}.`,
        })),
    ];
    if (surface.layout.landingPattern) {
        appendEscalation(escalations, surface.id, "marketing.out-of-scope", "Legacy landingPattern metadata was preserved only in compatibility output. AST v1 is scoped to governed application surfaces.");
    }
    if (surface.marketingTypographyProfile || surface.marketingTypographyPolicy) {
        appendEscalation(escalations, surface.id, "marketing.typography.out-of-scope", "Legacy marketing typography metadata does not map directly into the AST v1 application vocabulary.");
    }
    const states = surface.runtime?.contexts?.map((context) => ({
        id: context.id,
        ...(context.kind ? { kind: context.kind } : {}),
        ...(context.notes ? { description: context.notes } : {}),
    })) ?? undefined;
    const migratedSurface = {
        id: surface.id,
        displayName: surface.displayName,
        kind: "application",
        rootNodeId,
        nodes,
        platforms: [
            {
                platform: "web",
                ...(surface.domain ? { domain: surface.domain } : {}),
                allowedFonts: surface.allowedFonts,
                layout: {
                    maxContentWidth: surface.layout.maxContentWidth,
                    ...(surface.layout.requiredContainers
                        ? { requiredContainers: surface.layout.requiredContainers }
                        : {}),
                    ...(surface.layout.pageFrame ? { pageFrame: surface.layout.pageFrame } : {}),
                    ...(surface.layout.chromePolicy ? { chromePolicy: surface.layout.chromePolicy } : {}),
                    ...(surface.layout.targetAcquisition
                        ? { targetAcquisition: surface.layout.targetAcquisition }
                        : {}),
                },
                ...(surface.mustNotEmit ? { mustNotEmit: surface.mustNotEmit } : {}),
                ...(surface.shellOwnedPrimitiveAllowSources
                    ? {
                        shellOwnedPrimitiveAllowSources: surface.shellOwnedPrimitiveAllowSources,
                    }
                    : {}),
            },
        ],
        ...(states && states.length > 0 ? { states } : {}),
        ...(surface.owner ? { owner: surface.owner } : {}),
        ...(surface.phase0 ? { phase0: surface.phase0 } : {}),
        ...(surface.governance ? { governance: surface.governance } : {}),
        ...(surface.icons ? { icons: surface.icons } : {}),
        ...(surface.flows ? { flows: surface.flows } : {}),
        ...(surface.runtime ? { runtime: surface.runtime } : {}),
    };
    return {
        surface: migratedSurface,
        escalations,
    };
}
export function migrateLegacyContractToUiAst(contract) {
    const migratedSurfaces = contract.surfaces.map((surface) => migrateSurfaceToUiAst(surface, contract));
    return {
        $schema: AST_SCHEMA_URL,
        astId: contract.contractId,
        version: contract.version,
        ...(contract.description ? { description: contract.description } : {}),
        constraints: contract.constraints,
        color: contract.color,
        ...(contract.tokens ? { tokens: contract.tokens } : {}),
        ...(contract.shell ? { shell: contract.shell } : {}),
        surfaces: migratedSurfaces.map((entry) => entry.surface),
        migration: {
            sourceFormat: "web.surface.contract@1",
            escalations: migratedSurfaces.flatMap((entry) => entry.escalations),
        },
    };
}
function traverseSectionOrder(surface) {
    const byId = new Map(surface.nodes.map((node) => [node.id, node]));
    const ordered = [];
    const seen = new Set();
    function visit(nodeId) {
        if (seen.has(nodeId)) {
            return;
        }
        seen.add(nodeId);
        const node = byId.get(nodeId);
        if (!node) {
            return;
        }
        if (node.kind === "section") {
            ordered.push(node);
        }
        for (const childId of node.children ?? []) {
            visit(childId);
        }
    }
    visit(surface.rootNodeId);
    for (const node of surface.nodes) {
        if (node.kind === "section" && !seen.has(node.id)) {
            ordered.push(node);
        }
    }
    return ordered;
}
function getWebProjection(surface) {
    return surface.platforms.find((projection) => projection.platform === "web");
}
function buildLegacySectionsFromAst(ast) {
    const sections = new Map();
    for (const surface of ast.surfaces) {
        for (const node of traverseSectionOrder(surface)) {
            const sectionId = node.sectionId ?? node.id;
            if (!sections.has(sectionId)) {
                sections.set(sectionId, {
                    id: sectionId,
                    intent: node.intent ?? node.label ?? "section",
                    description: node.description ?? `AST section ${sectionId}.`,
                });
            }
        }
    }
    return [...sections.values()];
}
export function deriveLegacyContractFromUiAst(ast) {
    const sections = buildLegacySectionsFromAst(ast);
    const surfaces = [];
    for (const surface of ast.surfaces) {
        const web = getWebProjection(surface);
        if (!web?.layout) {
            continue;
        }
        surfaces.push({
            id: surface.id,
            displayName: surface.displayName,
            type: "web",
            requiredSections: traverseSectionOrder(surface).map((node) => node.sectionId ?? node.id),
            allowedFonts: web.allowedFonts ?? [],
            layout: {
                maxContentWidth: web.layout.maxContentWidth,
                ...(web.layout.requiredContainers
                    ? { requiredContainers: web.layout.requiredContainers }
                    : {}),
                ...(web.layout.pageFrame ? { pageFrame: web.layout.pageFrame } : {}),
                ...(web.layout.chromePolicy ? { chromePolicy: web.layout.chromePolicy } : {}),
                ...(web.layout.targetAcquisition
                    ? { targetAcquisition: web.layout.targetAcquisition }
                    : {}),
            },
            ...(surface.owner ? { owner: surface.owner } : {}),
            ...(web.domain ? { domain: web.domain } : {}),
            ...(surface.phase0 ? { phase0: surface.phase0 } : {}),
            ...(surface.governance ? { governance: surface.governance } : {}),
            ...(surface.icons ? { icons: surface.icons } : {}),
            ...(surface.flows ? { flows: surface.flows } : {}),
            ...(surface.runtime ? { runtime: surface.runtime } : {}),
            ...(web.mustNotEmit ? { mustNotEmit: web.mustNotEmit } : {}),
            ...(web.shellOwnedPrimitiveAllowSources
                ? { shellOwnedPrimitiveAllowSources: web.shellOwnedPrimitiveAllowSources }
                : {}),
        });
    }
    return {
        contractId: ast.astId,
        version: ast.version,
        ...(ast.description ? { description: ast.description } : {}),
        surfaces,
        sections,
        constraints: ast.constraints,
        color: ast.color,
        ...(ast.tokens ? { tokens: ast.tokens } : {}),
        ...(ast.shell ? { shell: ast.shell } : {}),
    };
}
export async function resolveUiAstInput(options) {
    const explicitAstPath = resolveCandidatePath(options.workspaceRoot, options.astPath);
    const explicitContractPath = resolveCandidatePath(options.workspaceRoot, options.contractPath);
    const defaultAstPath = path.resolve(options.workspaceRoot, DEFAULT_AST_PATH);
    const defaultLegacyPath = path.resolve(options.workspaceRoot, DEFAULT_LEGACY_CONTRACT_PATH);
    let sourcePath;
    let sourceKind;
    const warnings = [];
    if (explicitAstPath) {
        sourcePath = explicitAstPath;
        sourceKind = "ast";
    }
    else if (explicitContractPath) {
        sourcePath = explicitContractPath;
        sourceKind = "legacy-contract";
        warnings.push(`--contract is deprecated for UI AST v2. Prefer --ast ${DEFAULT_AST_PATH}.`);
    }
    else if (await fileExists(defaultAstPath)) {
        sourcePath = defaultAstPath;
        sourceKind = "ast";
    }
    else {
        sourcePath = defaultLegacyPath;
        sourceKind = "legacy-contract";
        warnings.push(`Falling back to legacy contract path ${DEFAULT_LEGACY_CONTRACT_PATH}. Migrate to ${DEFAULT_AST_PATH}.`);
    }
    const source = await loadJson(sourcePath, sourceKind === "ast" ? "UI AST" : "contract");
    if (!source.ok) {
        return {
            error: source.error ?? "Unknown AST input error.",
            code: sourceKind === "ast" ? "ui-ast.load-error" : "contract.load-error",
        };
    }
    if (sourceKind === "ast") {
        const schemaSource = options.schemaPath
            ? await loadJson(resolveCandidatePath(options.workspaceRoot, options.schemaPath) ?? options.schemaPath, "UI AST schema")
            : { ok: true, value: getBundledUiAstSchema() };
        if (!schemaSource.ok) {
            return {
                error: schemaSource.error ?? "Failed to load UI AST schema.",
                code: "ui-ast.schema-load-error",
            };
        }
        const validated = validateUiAstStructure(source.value, schemaSource.value);
        if (!validated.ok || !validated.ast) {
            return {
                error: `UI AST schema validation failed:\n${validated.errors.map((error) => `  • ${error}`).join("\n")}`,
                code: "ui-ast.schema.invalid",
            };
        }
        return {
            ast: validated.ast,
            derivedContract: deriveLegacyContractFromUiAst(validated.ast),
            sourceKind,
            sourcePath,
            warnings,
        };
    }
    const schemaSource = options.schemaPath
        ? await loadJson(resolveCandidatePath(options.workspaceRoot, options.schemaPath) ?? options.schemaPath, "contract schema")
        : { ok: true, value: getBundledContractSchema() };
    if (!schemaSource.ok) {
        return {
            error: schemaSource.error ?? "Failed to load contract schema.",
            code: "contract.schema-load-error",
        };
    }
    const validated = validateContractStructure(source.value, schemaSource.value);
    if (!validated.ok || !validated.contract) {
        return {
            error: `Contract schema validation failed:\n${validated.errors.map((error) => `  • ${error}`).join("\n")}`,
            code: "contract.schema.invalid",
        };
    }
    const ast = migrateLegacyContractToUiAst(validated.contract);
    const astValidation = validateUiAstStructure(ast);
    if (!astValidation.ok || !astValidation.ast) {
        return {
            error: `Generated UI AST draft failed validation:\n${astValidation.errors.map((error) => `  • ${error}`).join("\n")}`,
            code: "ui-ast.migration.invalid",
        };
    }
    return {
        ast: astValidation.ast,
        derivedContract: validated.contract,
        sourceKind,
        sourcePath,
        warnings,
    };
}
