const AST_SCHEMA_URL = "https://contracts.surfaces.local/ui.surface.ast.schema.json";
function uniqueSortedStrings(values) {
    if (!values || values.length === 0) {
        return undefined;
    }
    return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
function cloneUiAst(value) {
    return structuredClone(value);
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
function sortNodes(nodes) {
    return [...nodes]
        .map((node) => ({
        ...node,
        ...(node.children ? { children: [...node.children] } : {}),
        ...(node.platformVisibility
            ? {
                platformVisibility: [...node.platformVisibility].sort((left, right) => left.localeCompare(right)),
            }
            : {}),
        ...(node.stateRefs ? { stateRefs: uniqueSortedStrings(node.stateRefs) } : {}),
    }))
        .sort((left, right) => left.id.localeCompare(right.id));
}
function sortPlatforms(platforms) {
    return [...platforms]
        .map((platform) => ({
        ...platform,
        ...(platform.allowedFonts ? { allowedFonts: uniqueSortedStrings(platform.allowedFonts) } : {}),
        ...(platform.mustNotEmit ? { mustNotEmit: uniqueSortedStrings(platform.mustNotEmit) } : {}),
        ...(platform.shellOwnedPrimitiveAllowSources
            ? {
                shellOwnedPrimitiveAllowSources: uniqueSortedStrings(platform.shellOwnedPrimitiveAllowSources),
            }
            : {}),
        ...(platform.layout?.requiredContainers
            ? {
                layout: {
                    ...platform.layout,
                    requiredContainers: uniqueSortedStrings(platform.layout.requiredContainers),
                },
            }
            : {}),
    }))
        .sort((left, right) => left.platform.localeCompare(right.platform));
}
function sortStates(states) {
    if (!states) {
        return undefined;
    }
    return [...states].sort((left, right) => left.id.localeCompare(right.id));
}
function sortEscalations(escalations) {
    if (!escalations) {
        return undefined;
    }
    return [...escalations].sort((left, right) => {
        const surfaceComparison = (left.surfaceId ?? "").localeCompare(right.surfaceId ?? "");
        if (surfaceComparison !== 0) {
            return surfaceComparison;
        }
        const codeComparison = left.code.localeCompare(right.code);
        if (codeComparison !== 0) {
            return codeComparison;
        }
        return left.message.localeCompare(right.message);
    });
}
function describePathSegment(pathPrefix, key) {
    if (!pathPrefix) {
        return key;
    }
    return `${pathPrefix}.${key}`;
}
function surfacePath(surfaceId, suffix = "") {
    return `surfaces[${surfaceId}]${suffix ? `.${suffix}` : ""}`;
}
function platformPath(surfaceId, platform, suffix = "") {
    return `${surfacePath(surfaceId)}.platforms[${platform}]${suffix ? `.${suffix}` : ""}`;
}
function nodePath(surfaceId, nodeId, suffix = "") {
    return `${surfacePath(surfaceId)}.nodes[${nodeId}]${suffix ? `.${suffix}` : ""}`;
}
function statePath(surfaceId, stateId, suffix = "") {
    return `${surfacePath(surfaceId)}.states[${stateId}]${suffix ? `.${suffix}` : ""}`;
}
function diffScalarArray(before, after, pathPrefix) {
    const entries = [];
    const beforeSet = new Set(before ?? []);
    const afterSet = new Set(after ?? []);
    for (const value of [...beforeSet].sort((left, right) => left.localeCompare(right))) {
        if (!afterSet.has(value)) {
            entries.push({ path: `${pathPrefix}[${value}]`, kind: "removed", before: value });
        }
    }
    for (const value of [...afterSet].sort((left, right) => left.localeCompare(right))) {
        if (!beforeSet.has(value)) {
            entries.push({ path: `${pathPrefix}[${value}]`, kind: "added", after: value });
        }
    }
    return entries;
}
function diffUnknown(before, after, pathPrefix = "") {
    if (JSON.stringify(before) === JSON.stringify(after)) {
        return [];
    }
    if (Array.isArray(before) || Array.isArray(after)) {
        const beforeArray = Array.isArray(before) ? before : [];
        const afterArray = Array.isArray(after) ? after : [];
        const beforeObjectArray = beforeArray.every((entry) => entry && typeof entry === "object" && !Array.isArray(entry));
        const afterObjectArray = afterArray.every((entry) => entry && typeof entry === "object" && !Array.isArray(entry));
        if (!beforeObjectArray && !afterObjectArray) {
            return [
                {
                    path: pathPrefix,
                    kind: "modified",
                    before,
                    after,
                },
            ];
        }
    }
    if (before
        && after
        && typeof before === "object"
        && typeof after === "object"
        && !Array.isArray(before)
        && !Array.isArray(after)) {
        const entries = [];
        const beforeRecord = before;
        const afterRecord = after;
        const keys = [...new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)])].sort((left, right) => left.localeCompare(right));
        for (const key of keys) {
            entries.push(...diffUnknown(beforeRecord[key], afterRecord[key], describePathSegment(pathPrefix, key)));
        }
        return entries;
    }
    return [{ path: pathPrefix, kind: "modified", before, after }];
}
function diffSurface(before, after) {
    if (!before && !after) {
        return [];
    }
    if (!before && after) {
        return [{ path: surfacePath(after.id), kind: "added", after }];
    }
    if (before && !after) {
        return [{ path: surfacePath(before.id), kind: "removed", before }];
    }
    const left = before;
    const right = after;
    const entries = [];
    if (left.displayName !== right.displayName) {
        entries.push({
            path: surfacePath(left.id, "displayName"),
            kind: "modified",
            before: left.displayName,
            after: right.displayName,
        });
    }
    if (left.owner !== right.owner) {
        entries.push({
            path: surfacePath(left.id, "owner"),
            kind: "modified",
            before: left.owner ?? null,
            after: right.owner ?? null,
        });
    }
    if ((left.governance?.status ?? null) !== (right.governance?.status ?? null)) {
        entries.push({
            path: surfacePath(left.id, "governance.status"),
            kind: "modified",
            before: left.governance?.status ?? null,
            after: right.governance?.status ?? null,
        });
    }
    entries.push(...diffScalarArray(left.governance?.roles?.designers, right.governance?.roles?.designers, surfacePath(left.id, "governance.roles.designers")));
    entries.push(...diffScalarArray(left.governance?.roles?.engineers, right.governance?.roles?.engineers, surfacePath(left.id, "governance.roles.engineers")));
    if ((left.runtime?.policy ?? null) !== (right.runtime?.policy ?? null)) {
        entries.push({
            path: surfacePath(left.id, "runtime.policy"),
            kind: "modified",
            before: left.runtime?.policy ?? null,
            after: right.runtime?.policy ?? null,
        });
    }
    if ((left.runtime?.mutationEnvelope?.mode ?? null) !== (right.runtime?.mutationEnvelope?.mode ?? null)) {
        entries.push({
            path: surfacePath(left.id, "runtime.mutationEnvelope.mode"),
            kind: "modified",
            before: left.runtime?.mutationEnvelope?.mode ?? null,
            after: right.runtime?.mutationEnvelope?.mode ?? null,
        });
    }
    entries.push(...diffScalarArray(left.runtime?.mutationEnvelope?.allowedSections, right.runtime?.mutationEnvelope?.allowedSections, surfacePath(left.id, "runtime.mutationEnvelope.allowedSections")));
    const leftPlatforms = new Map(left.platforms.map((platform) => [platform.platform, platform]));
    const rightPlatforms = new Map(right.platforms.map((platform) => [platform.platform, platform]));
    const platformIds = [...new Set([...leftPlatforms.keys(), ...rightPlatforms.keys()])]
        .sort((a, b) => a.localeCompare(b));
    for (const platformId of platformIds) {
        const beforePlatform = leftPlatforms.get(platformId);
        const afterPlatform = rightPlatforms.get(platformId);
        if (!beforePlatform && afterPlatform) {
            entries.push({
                path: platformPath(left.id, afterPlatform.platform),
                kind: "added",
                after: afterPlatform,
            });
            continue;
        }
        if (beforePlatform && !afterPlatform) {
            entries.push({
                path: platformPath(left.id, beforePlatform.platform),
                kind: "removed",
                before: beforePlatform,
            });
            continue;
        }
        if (!beforePlatform || !afterPlatform) {
            continue;
        }
        entries.push(...diffScalarArray(beforePlatform.allowedFonts, afterPlatform.allowedFonts, platformPath(left.id, beforePlatform.platform, "allowedFonts")));
        if ((beforePlatform.layout?.maxContentWidth ?? null) !== (afterPlatform.layout?.maxContentWidth ?? null)) {
            entries.push({
                path: platformPath(left.id, beforePlatform.platform, "layout.maxContentWidth"),
                kind: "modified",
                before: beforePlatform.layout?.maxContentWidth ?? null,
                after: afterPlatform.layout?.maxContentWidth ?? null,
            });
        }
    }
    const leftNodes = new Map(left.nodes.map((node) => [node.id, node]));
    const rightNodes = new Map(right.nodes.map((node) => [node.id, node]));
    const nodeIds = [...new Set([...leftNodes.keys(), ...rightNodes.keys()])]
        .sort((a, b) => a.localeCompare(b));
    for (const nodeId of nodeIds) {
        const beforeNode = leftNodes.get(nodeId);
        const afterNode = rightNodes.get(nodeId);
        if (!beforeNode && afterNode) {
            entries.push({ path: nodePath(left.id, afterNode.id), kind: "added", after: afterNode });
            continue;
        }
        if (beforeNode && !afterNode) {
            entries.push({ path: nodePath(left.id, beforeNode.id), kind: "removed", before: beforeNode });
            continue;
        }
        if (!beforeNode || !afterNode) {
            continue;
        }
        if ((beforeNode.actionIntent ?? null) !== (afterNode.actionIntent ?? null)) {
            entries.push({
                path: nodePath(left.id, nodeId, "actionIntent"),
                kind: "modified",
                before: beforeNode.actionIntent ?? null,
                after: afterNode.actionIntent ?? null,
            });
        }
        if ((beforeNode.label ?? null) !== (afterNode.label ?? null)) {
            entries.push({
                path: nodePath(left.id, nodeId, "label"),
                kind: "modified",
                before: beforeNode.label ?? null,
                after: afterNode.label ?? null,
            });
        }
        if ((beforeNode.description ?? null) !== (afterNode.description ?? null)) {
            entries.push({
                path: nodePath(left.id, nodeId, "description"),
                kind: "modified",
                before: beforeNode.description ?? null,
                after: afterNode.description ?? null,
            });
        }
    }
    const leftStates = new Map((left.states ?? []).map((state) => [state.id, state]));
    const rightStates = new Map((right.states ?? []).map((state) => [state.id, state]));
    const stateIds = [...new Set([...leftStates.keys(), ...rightStates.keys()])]
        .sort((a, b) => a.localeCompare(b));
    for (const stateId of stateIds) {
        const beforeState = leftStates.get(stateId);
        const afterState = rightStates.get(stateId);
        if (!beforeState && afterState) {
            entries.push({ path: statePath(left.id, afterState.id), kind: "added", after: afterState });
            continue;
        }
        if (beforeState && !afterState) {
            entries.push({ path: statePath(left.id, beforeState.id), kind: "removed", before: beforeState });
            continue;
        }
        if (!beforeState || !afterState) {
            continue;
        }
        if ((beforeState.kind ?? null) !== (afterState.kind ?? null)) {
            entries.push({
                path: statePath(left.id, stateId, "kind"),
                kind: "modified",
                before: beforeState.kind ?? null,
                after: afterState.kind ?? null,
            });
        }
        if ((beforeState.description ?? null) !== (afterState.description ?? null)) {
            entries.push({
                path: statePath(left.id, stateId, "description"),
                kind: "modified",
                before: beforeState.description ?? null,
                after: afterState.description ?? null,
            });
        }
    }
    return entries;
}
function parseBracketSelector(value, collection) {
    const match = value.match(new RegExp(`^${collection}\\[([^\\]]+)\\](?:\\.(.+))?$`));
    if (!match?.[1]) {
        return null;
    }
    return {
        key: match[1],
        suffix: match[2] ?? "",
    };
}
function resolveSurface(ast, surfaceId) {
    const surface = ast.surfaces.find((candidate) => candidate.id === surfaceId);
    if (!surface) {
        throw new Error(`Unknown AST surface "${surfaceId}".`);
    }
    return surface;
}
function resolvePlatform(surface, platform) {
    const projection = surface.platforms.find((candidate) => candidate.platform === platform);
    if (!projection) {
        throw new Error(`Unknown AST platform "${platform}" for surface "${surface.id}".`);
    }
    return projection;
}
function resolveNode(surface, nodeId) {
    const node = surface.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) {
        throw new Error(`Unknown AST node "${nodeId}" for surface "${surface.id}".`);
    }
    return node;
}
function resolveState(surface, stateId) {
    const state = surface.states?.find((candidate) => candidate.id === stateId);
    if (!state) {
        throw new Error(`Unknown AST state "${stateId}" for surface "${surface.id}".`);
    }
    return state;
}
function addUniqueValue(target, value) {
    return uniqueSortedStrings([...(target ?? []), value]) ?? [];
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
export function normalizeUiAst(ast) {
    const cloned = cloneUiAst(ast);
    return {
        ...cloned,
        color: {
            ...cloned.color,
            allowedValues: uniqueSortedStrings(cloned.color.allowedValues) ?? [],
        },
        ...(cloned.surfaces
            ? {
                surfaces: [...cloned.surfaces]
                    .map((surface) => ({
                    ...surface,
                    nodes: sortNodes(surface.nodes),
                    platforms: sortPlatforms(surface.platforms),
                    ...(surface.states ? { states: sortStates(surface.states) } : {}),
                    ...(surface.governance?.roles
                        ? {
                            governance: {
                                ...surface.governance,
                                roles: {
                                    ...(surface.governance.roles.designers
                                        ? {
                                            designers: uniqueSortedStrings(surface.governance.roles.designers),
                                        }
                                        : {}),
                                    ...(surface.governance.roles.engineers
                                        ? {
                                            engineers: uniqueSortedStrings(surface.governance.roles.engineers),
                                        }
                                        : {}),
                                },
                            },
                        }
                        : {}),
                    ...(surface.runtime?.mutationEnvelope?.allowedSections
                        && surface.runtime?.mutationEnvelope?.mode
                        ? {
                            runtime: {
                                ...surface.runtime,
                                mutationEnvelope: {
                                    ...surface.runtime.mutationEnvelope,
                                    mode: surface.runtime.mutationEnvelope.mode,
                                    allowedSections: uniqueSortedStrings(surface.runtime.mutationEnvelope.allowedSections),
                                },
                            },
                        }
                        : {}),
                }))
                    .sort((left, right) => left.id.localeCompare(right.id)),
            }
            : {}),
        ...(cloned.migration
            ? {
                migration: {
                    ...cloned.migration,
                    escalations: sortEscalations(cloned.migration.escalations) ?? [],
                },
            }
            : {}),
    };
}
export function summarizeUiAst(ast) {
    const normalized = normalizeUiAst(ast);
    const surfaces = normalized.surfaces.map((surface) => {
        const nodeKinds = surface.nodes.reduce((counts, node) => {
            counts[node.kind] = (counts[node.kind] ?? 0) + 1;
            return counts;
        }, {});
        const maxContentWidthByPlatform = Object.fromEntries(surface.platforms
            .filter((platform) => typeof platform.layout?.maxContentWidth === "number")
            .map((platform) => [platform.platform, platform.layout.maxContentWidth]));
        return {
            surfaceId: surface.id,
            displayName: surface.displayName,
            platforms: surface.platforms.map((platform) => platform.platform),
            nodeCount: surface.nodes.length,
            nodeKinds,
            sectionIds: traverseSectionOrder(surface).map((node) => node.sectionId ?? node.id),
            actionIntents: [...new Set(surface.nodes
                    .map((node) => node.actionIntent)
                    .filter((value) => typeof value === "string"))].sort((left, right) => left.localeCompare(right)),
            stateIds: (surface.states ?? []).map((state) => state.id),
            owner: surface.owner ?? null,
            governanceStatus: surface.governance?.status ?? null,
            runtimePolicy: surface.runtime?.policy ?? null,
            maxContentWidthByPlatform,
        };
    });
    return {
        astId: normalized.astId,
        version: normalized.version,
        surfaceCount: normalized.surfaces.length,
        platformCount: surfaces.reduce((count, surface) => count + surface.platforms.length, 0),
        nodeCount: surfaces.reduce((count, surface) => count + surface.nodeCount, 0),
        migrationEscalationCount: normalized.migration?.escalations.length ?? 0,
        surfaces,
    };
}
export function diffUiAst(before, after) {
    const left = normalizeUiAst(before);
    const right = normalizeUiAst(after);
    const entries = [];
    if (left.astId !== right.astId) {
        entries.push({ path: "astId", kind: "modified", before: left.astId, after: right.astId });
    }
    if (left.version !== right.version) {
        entries.push({ path: "version", kind: "modified", before: left.version, after: right.version });
    }
    if ((left.description ?? null) !== (right.description ?? null)) {
        entries.push({
            path: "description",
            kind: "modified",
            before: left.description ?? null,
            after: right.description ?? null,
        });
    }
    if ((left.color.policy ?? null) !== (right.color.policy ?? null)) {
        entries.push({
            path: "color.policy",
            kind: "modified",
            before: left.color.policy ?? null,
            after: right.color.policy ?? null,
        });
    }
    entries.push(...diffScalarArray(left.color.allowedValues, right.color.allowedValues, "color.allowedValues"));
    const leftSurfaces = new Map(left.surfaces.map((surface) => [surface.id, surface]));
    const rightSurfaces = new Map(right.surfaces.map((surface) => [surface.id, surface]));
    const surfaceIds = [...new Set([...leftSurfaces.keys(), ...rightSurfaces.keys()])]
        .sort((a, b) => a.localeCompare(b));
    for (const surfaceId of surfaceIds) {
        entries.push(...diffSurface(leftSurfaces.get(surfaceId), rightSurfaces.get(surfaceId)));
    }
    entries.push(...diffUnknown(left.constraints, right.constraints, "constraints"));
    entries.push(...diffUnknown(left.tokens, right.tokens, "tokens"));
    entries.push(...diffUnknown(left.shell, right.shell, "shell"));
    entries.push(...diffUnknown(left.migration, right.migration, "migration"));
    return entries.sort((leftEntry, rightEntry) => {
        const pathComparison = leftEntry.path.localeCompare(rightEntry.path);
        if (pathComparison !== 0) {
            return pathComparison;
        }
        return leftEntry.kind.localeCompare(rightEntry.kind);
    });
}
export function applyUiAstChange(ast, change) {
    const next = normalizeUiAst(cloneUiAst(ast));
    if (change.path === "color.policy") {
        if (change.action !== "set" || typeof change.value !== "string") {
            throw new Error(`Unsupported AST change for ${change.path}.`);
        }
        next.color.policy = change.value;
        return next;
    }
    if (change.path === "color.allowedValues") {
        if (change.action !== "add" || typeof change.value !== "string") {
            throw new Error(`Unsupported AST change for ${change.path}.`);
        }
        next.color.allowedValues = addUniqueValue(next.color.allowedValues, change.value);
        return next;
    }
    const surfaceMatch = parseBracketSelector(change.path, "surfaces");
    if (!surfaceMatch) {
        throw new Error(`Unsupported AST change path "${change.path}".`);
    }
    const surface = resolveSurface(next, surfaceMatch.key);
    if (surfaceMatch.suffix === "owner") {
        if (change.action !== "set" || typeof change.value !== "string") {
            throw new Error(`Unsupported AST change for ${change.path}.`);
        }
        surface.owner = change.value;
        return next;
    }
    if (surfaceMatch.suffix === "governance.status") {
        if (change.action !== "set" || typeof change.value !== "string") {
            throw new Error(`Unsupported AST change for ${change.path}.`);
        }
        surface.governance = {
            ...surface.governance,
            status: change.value,
        };
        return next;
    }
    if (surfaceMatch.suffix === "governance.roles.designers") {
        if (change.action !== "add" || typeof change.value !== "string") {
            throw new Error(`Unsupported AST change for ${change.path}.`);
        }
        surface.governance = {
            ...surface.governance,
            roles: {
                ...surface.governance?.roles,
                designers: addUniqueValue(surface.governance?.roles?.designers, change.value),
            },
        };
        return next;
    }
    if (surfaceMatch.suffix === "governance.roles.engineers") {
        if (change.action !== "add" || typeof change.value !== "string") {
            throw new Error(`Unsupported AST change for ${change.path}.`);
        }
        surface.governance = {
            ...surface.governance,
            roles: {
                ...surface.governance?.roles,
                engineers: addUniqueValue(surface.governance?.roles?.engineers, change.value),
            },
        };
        return next;
    }
    if (surfaceMatch.suffix === "runtime.policy") {
        if (change.action !== "set" || typeof change.value !== "string") {
            throw new Error(`Unsupported AST change for ${change.path}.`);
        }
        surface.runtime = {
            ...surface.runtime,
            policy: change.value,
        };
        return next;
    }
    if (surfaceMatch.suffix === "runtime.mutationEnvelope.mode") {
        if (change.action !== "set" || typeof change.value !== "string") {
            throw new Error(`Unsupported AST change for ${change.path}.`);
        }
        surface.runtime = {
            ...surface.runtime,
            mutationEnvelope: {
                ...surface.runtime?.mutationEnvelope,
                mode: change.value,
            },
        };
        return next;
    }
    if (surfaceMatch.suffix === "runtime.mutationEnvelope.allowedSections") {
        if (change.action !== "add" || typeof change.value !== "string") {
            throw new Error(`Unsupported AST change for ${change.path}.`);
        }
        const existingMode = surface.runtime?.mutationEnvelope?.mode;
        if (!existingMode) {
            throw new Error(`AST mutation envelope mode must exist before adding allowed sections for ${change.path}.`);
        }
        surface.runtime = {
            ...surface.runtime,
            mutationEnvelope: {
                ...surface.runtime?.mutationEnvelope,
                mode: existingMode,
                allowedSections: addUniqueValue(surface.runtime?.mutationEnvelope?.allowedSections, change.value),
            },
        };
        return next;
    }
    const platformMatch = parseBracketSelector(surfaceMatch.suffix, "platforms");
    if (platformMatch) {
        const platform = resolvePlatform(surface, platformMatch.key);
        if (platformMatch.suffix === "allowedFonts") {
            if (change.action !== "add" || typeof change.value !== "string") {
                throw new Error(`Unsupported AST change for ${change.path}.`);
            }
            platform.allowedFonts = addUniqueValue(platform.allowedFonts, change.value);
            return next;
        }
        if (platformMatch.suffix === "layout.maxContentWidth") {
            if (change.action !== "set" || typeof change.value !== "number") {
                throw new Error(`Unsupported AST change for ${change.path}.`);
            }
            platform.layout = {
                ...platform.layout,
                maxContentWidth: change.value,
            };
            return next;
        }
        throw new Error(`Unsupported AST platform change path "${change.path}".`);
    }
    const nodeMatch = parseBracketSelector(surfaceMatch.suffix, "nodes");
    if (nodeMatch) {
        const node = resolveNode(surface, nodeMatch.key);
        if (nodeMatch.suffix === "label") {
            if (change.action !== "set" || typeof change.value !== "string") {
                throw new Error(`Unsupported AST change for ${change.path}.`);
            }
            node.label = change.value;
            return next;
        }
        if (nodeMatch.suffix === "description") {
            if (change.action !== "set" || typeof change.value !== "string") {
                throw new Error(`Unsupported AST change for ${change.path}.`);
            }
            node.description = change.value;
            return next;
        }
        if (nodeMatch.suffix === "actionIntent") {
            if (change.action !== "set" || typeof change.value !== "string") {
                throw new Error(`Unsupported AST change for ${change.path}.`);
            }
            node.actionIntent = change.value;
            return next;
        }
        throw new Error(`Unsupported AST node change path "${change.path}".`);
    }
    const stateMatch = parseBracketSelector(surfaceMatch.suffix, "states");
    if (stateMatch) {
        const state = resolveState(surface, stateMatch.key);
        if (stateMatch.suffix === "description") {
            if (change.action !== "set" || typeof change.value !== "string") {
                throw new Error(`Unsupported AST change for ${change.path}.`);
            }
            state.description = change.value;
            return next;
        }
        if (stateMatch.suffix === "kind") {
            if (change.action !== "set" || typeof change.value !== "string") {
                throw new Error(`Unsupported AST change for ${change.path}.`);
            }
            state.kind = change.value;
            return next;
        }
        throw new Error(`Unsupported AST state change path "${change.path}".`);
    }
    throw new Error(`Unsupported AST change path "${change.path}".`);
}
