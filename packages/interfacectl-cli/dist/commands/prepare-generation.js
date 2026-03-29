import fs from "node:fs";
import path from "node:path";
import { AdapterInputError, isRecord, loadCompiledSurfaceBundle, } from "../adapter/bundle.js";
import { stringifyDeterministicJson } from "../utils/deterministic-json.js";
function asRecord(value) {
    return isRecord(value) ? value : {};
}
function asString(value) {
    return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
function asStringArray(value) {
    if (!Array.isArray(value))
        return [];
    return value
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter(Boolean);
}
function uniqueStrings(values) {
    return [...new Set(values.filter(Boolean))];
}
function getRepairPriorityRank(priority) {
    switch (priority) {
        case "high":
            return 0;
        case "medium":
            return 1;
        case "low":
            return 2;
        default:
            return 3;
    }
}
function getRepairSummary(repairMap) {
    const repairs = Array.isArray(repairMap.repairs) ? repairMap.repairs : [];
    return repairs
        .filter((entry) => isRecord(entry))
        .map((entry) => {
        const action = asRecord(entry.action);
        return {
            code: asString(entry.code) ?? "unknown",
            priority: asString(entry.priority) ?? "medium",
            category: asString(entry.category) ?? "unknown",
            actionType: asString(action.type) ?? "unknown",
        };
    })
        .sort((a, b) => getRepairPriorityRank(a.priority) - getRepairPriorityRank(b.priority) ||
        a.category.localeCompare(b.category) ||
        a.code.localeCompare(b.code));
}
function buildSummary(bundle) {
    const generation = asRecord(bundle.surface.generation.value);
    const boundary = asRecord(generation.boundary);
    const structure = asRecord(generation.structure);
    const adaptation = asRecord(generation.adaptation);
    const mutationEnvelope = asRecord(adaptation.mutationEnvelope);
    const guidance = asRecord(generation.guidance);
    const layout = asRecord(generation.layout);
    const flowSummary = asRecord(structure.flowSummary);
    const targetAcquisition = asRecord(layout.targetAcquisition);
    const feedbackRecovery = asRecord(adaptation.feedbackRecovery);
    const repairs = getRepairSummary(bundle.surface.repairMap.value);
    const focusOrder = asStringArray(guidance.generationFocusOrder);
    const requiredSectionIds = asStringArray(structure.requiredSectionIds);
    const prohibitedRoles = uniqueStrings([
        ...asStringArray(guidance.doNotEmitRoles),
        ...asStringArray(boundary.shellOwns),
        ...asStringArray(boundary.mustNotEmit),
    ]);
    const checklist = [];
    if (prohibitedRoles.length > 0) {
        checklist.push({
            id: "boundary",
            label: "Stay inside the surface boundary",
            detail: `Do not emit shell-owned roles: ${prohibitedRoles.join(", ")}.`,
        });
    }
    if (requiredSectionIds.length > 0) {
        checklist.push({
            id: "sections",
            label: "Include every required section",
            detail: `Required sections: ${requiredSectionIds.join(", ")}.`,
        });
    }
    if (focusOrder.length > 0) {
        checklist.push({
            id: "focus-order",
            label: "Follow the generation focus order",
            detail: `Focus order: ${focusOrder.join(" -> ")}.`,
        });
    }
    const mutationMode = asString(mutationEnvelope.mode);
    if (mutationMode) {
        checklist.push({
            id: "mutation-envelope",
            label: "Stay within the mutation envelope",
            detail: `Allowed mutation mode: ${mutationMode}.`,
        });
    }
    if (Object.keys(targetAcquisition).length > 0) {
        checklist.push({
            id: "target-acquisition",
            label: "Keep targets easy to acquire",
            detail: `Use ${asString(targetAcquisition.modality) ?? "touch-mouse"} budgets: ` +
                `${String(targetAcquisition.minHitAreaPx ?? 44)}px targets, ` +
                `${String(targetAcquisition.minGapPx ?? 8)}px gaps, ` +
                `${String(targetAcquisition.minEdgeInsetPx ?? 8)}px edge inset, ` +
                `${String(targetAcquisition.destructiveGapPx ?? 16)}px destructive separation.`,
        });
    }
    if (Object.keys(feedbackRecovery).length > 0) {
        checklist.push({
            id: "feedback-recovery",
            label: "Cover async feedback and recovery states",
            detail: `Support async states ${asStringArray(feedbackRecovery.requiredStateKinds).join(", ")} ` +
                "with explicit loading, empty, and error recovery affordances.",
        });
    }
    if (Object.keys(flowSummary).length > 0) {
        checklist.push({
            id: "flows",
            label: "Preserve required task flows",
            detail: `Support flow requirements for ${asStringArray(flowSummary.flowIds).join(", ")} ` +
                "with the declared steps, transitions, and terminal behavior.",
        });
    }
    if (repairs.length > 0) {
        checklist.push({
            id: "repair-priorities",
            label: "Use repair priorities when correcting drift",
            detail: `Highest-priority repair codes: ${repairs
                .slice(0, 3)
                .map((repair) => repair.code)
                .join(", ")}.`,
        });
    }
    const textParts = [];
    if (focusOrder.length > 0) {
        textParts.push(`Focus on ${focusOrder.join(", ")}`);
    }
    if (requiredSectionIds.length > 0) {
        textParts.push(`include required sections ${requiredSectionIds.join(", ")}`);
    }
    if (prohibitedRoles.length > 0) {
        textParts.push(`avoid shell-owned roles ${prohibitedRoles.join(", ")}`);
    }
    if (mutationMode) {
        textParts.push(`stay within ${mutationMode} mutation scope`);
    }
    if (Object.keys(targetAcquisition).length > 0) {
        textParts.push(`honor ${String(targetAcquisition.minHitAreaPx ?? 44)}px targets and ${String(targetAcquisition.minGapPx ?? 8)}px spacing`);
    }
    if (Object.keys(feedbackRecovery).length > 0) {
        textParts.push(`cover async feedback states ${asStringArray(feedbackRecovery.requiredStateKinds).join(", ")}`);
    }
    if (Object.keys(flowSummary).length > 0) {
        textParts.push(`preserve required flows ${asStringArray(flowSummary.flowIds).join(", ")}`);
    }
    if (repairs.length > 0) {
        textParts.push(`prioritize repairs ${repairs.slice(0, 3).map((repair) => repair.code).join(", ")}`);
    }
    return {
        text: textParts.length > 0 ? `${textParts.join("; ")}.` : "Use the compiled surface bundle as the authoritative generation input.",
        focusOrder,
        requiredSectionIds,
        prohibitedRoles,
        checklist,
        topRepairs: repairs.slice(0, 5),
    };
}
export function buildPreparedGenerationPayload(bundle) {
    const generation = asRecord(bundle.surface.generation.value);
    const generationRefs = asRecord(generation.refs);
    const identity = asRecord(generation.identity);
    const sectionsDoc = asRecord(bundle.surface.sections.value);
    const componentsDoc = asRecord(bundle.surface.components.value);
    const constraintsDoc = asRecord(bundle.surface.constraints.value);
    const repairMapDoc = asRecord(bundle.surface.repairMap.value);
    const runtimeDoc = bundle.surface.runtime
        ? asRecord(bundle.surface.runtime.value)
        : undefined;
    const astDoc = bundle.surface.ast
        ? asRecord(bundle.surface.ast.value)
        : undefined;
    const platformsDoc = bundle.surface.platforms
        ? asRecord(bundle.surface.platforms.value)
        : undefined;
    const lifecycleDoc = bundle.surface.lifecycle
        ? asRecord(bundle.surface.lifecycle.value)
        : undefined;
    const proposalDoc = bundle.surface.proposal
        ? asRecord(bundle.surface.proposal.value)
        : undefined;
    const integrationDoc = bundle.surface.integration
        ? asRecord(bundle.surface.integration.value)
        : undefined;
    const authoringDoc = bundle.surface.authoring
        ? asRecord(bundle.surface.authoring.value)
        : undefined;
    return {
        surface: {
            surfaceId: asString(identity.surfaceId) ?? bundle.surface.id,
            displayName: asString(identity.displayName) ?? bundle.surface.id,
            type: asString(identity.type) ?? "unknown",
        },
        bundle: {
            root: bundle.root,
            version: bundle.version,
            manifestPath: bundle.manifest.path,
            sourcePaths: {
                ...(bundle.ast ? { ast: bundle.ast.path } : {}),
                contract: bundle.contract.path,
                ...(bundle.surface.ast ? { astSlice: bundle.surface.ast.path } : {}),
                ...(bundle.surface.platforms ? { platforms: bundle.surface.platforms.path } : {}),
                ...(bundle.surface.lifecycle ? { lifecycle: bundle.surface.lifecycle.path } : {}),
                ...(bundle.surface.proposal ? { proposal: bundle.surface.proposal.path } : {}),
                ...(bundle.surface.integration ? { integration: bundle.surface.integration.path } : {}),
                generation: bundle.surface.generation.path,
                sections: bundle.surface.sections.path,
                components: bundle.surface.components.path,
                constraints: bundle.surface.constraints.path,
                repairMap: bundle.surface.repairMap.path,
                ...(bundle.surface.runtime ? { runtime: bundle.surface.runtime.path } : {}),
                ...(bundle.surface.authoring ? { authoring: bundle.surface.authoring.path } : {}),
            },
        },
        contract: {
            id: bundle.contractId,
            version: bundle.contractVersion,
            normalizedPath: bundle.contract.path,
        },
        ...(bundle.ast
            ? {
                ast: {
                    id: asString(asRecord(bundle.ast.value).astId) ?? bundle.contractId,
                    version: asString(asRecord(bundle.ast.value).version) ?? bundle.contractVersion,
                    normalizedPath: bundle.ast.path,
                },
            }
            : {}),
        summary: buildSummary(bundle),
        ...(lifecycleDoc && isRecord(lifecycleDoc.lifecycle)
            ? { lifecycle: lifecycleDoc.lifecycle }
            : {}),
        ...(proposalDoc && isRecord(proposalDoc.proposal)
            ? { proposal: proposalDoc.proposal }
            : {}),
        ...(integrationDoc && isRecord(integrationDoc.integration)
            ? { integration: integrationDoc.integration }
            : {}),
        generation: {
            ...(astDoc && isRecord(astDoc.ast) ? { ast: astDoc.ast } : {}),
            ...(platformsDoc && Array.isArray(platformsDoc.platforms)
                ? { platforms: platformsDoc.platforms }
                : {}),
            boundary: asRecord(generation.boundary),
            structure: asRecord(generation.structure),
            layout: asRecord(generation.layout),
            visual: asRecord(generation.visual),
            governance: asRecord(generation.governance),
            adaptation: asRecord(generation.adaptation),
            guidance: asRecord(generation.guidance),
        },
        sections: Array.isArray(sectionsDoc.sections) ? sectionsDoc.sections : [],
        components: Array.isArray(componentsDoc.components) ? componentsDoc.components : [],
        constraints: asRecord(constraintsDoc.constraints),
        repairMap: Array.isArray(repairMapDoc.repairs) ? repairMapDoc.repairs : [],
        ...(runtimeDoc && isRecord(runtimeDoc.runtime)
            ? { runtime: runtimeDoc.runtime }
            : {}),
        ...(authoringDoc && isRecord(authoringDoc.authoring)
            ? { authoring: authoringDoc.authoring }
            : {}),
        evidenceRefs: Array.isArray(generationRefs.evidence) ? generationRefs.evidence : [],
    };
}
export function loadPreparedGenerationPayload(bundleRoot, surfaceId, cwd = process.cwd()) {
    const bundle = loadCompiledSurfaceBundle(bundleRoot, surfaceId, cwd);
    return buildPreparedGenerationPayload(bundle);
}
function writeError(error, code) {
    process.stderr.write(`${JSON.stringify({
        status: "error",
        code,
        error: error.message,
    }, null, 2)}\n`);
}
export async function runPrepareGenerationCommand(options) {
    try {
        if (!options.bundleRoot) {
            throw new AdapterInputError("--bundle-root is required.");
        }
        if (!options.surfaceId) {
            throw new AdapterInputError("--surface is required.");
        }
        const payload = loadPreparedGenerationPayload(options.bundleRoot, options.surfaceId, process.cwd());
        const serialized = stringifyDeterministicJson(payload);
        if (options.outPath) {
            const outPath = path.resolve(options.outPath);
            fs.mkdirSync(path.dirname(outPath), { recursive: true });
            fs.writeFileSync(outPath, serialized, "utf8");
            return 0;
        }
        process.stdout.write(serialized);
        return 0;
    }
    catch (error) {
        if (error instanceof AdapterInputError) {
            writeError(error, error.code);
            return 10;
        }
        const internalError = error instanceof Error ? error : new Error(String(error));
        writeError(internalError, "prepare-generation.internal");
        return 1;
    }
}
