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
function buildSummary(bundle) {
    if (!bundle.surface.runtime) {
        throw new AdapterInputError(`Bundle for surface "${bundle.surface.id}" does not include runtime.json.`, { code: "adapter.bundle.runtime-missing" });
    }
    const runtimeDoc = asRecord(bundle.surface.runtime.value);
    const runtime = asRecord(runtimeDoc.runtime);
    const structure = asRecord(runtime.structure);
    const flowSummary = asRecord(structure.flowSummary);
    const mutationEnvelope = asRecord(runtime.mutationEnvelope);
    const policySeverities = asRecord(runtime.policySeverities);
    const contexts = Array.isArray(runtime.contexts) ? runtime.contexts : [];
    const feedbackRecovery = asRecord(runtime.feedbackRecovery);
    const interaction = asRecord(runtime.interaction);
    const targetAcquisition = asRecord(interaction.targetAcquisition);
    const requiredSectionIds = asStringArray(structure.requiredSections);
    const mutationMode = asString(mutationEnvelope.mode) ?? "content-only";
    const strictCategories = Object.entries(policySeverities)
        .filter(([, policy]) => policy === "strict")
        .map(([category]) => category);
    const checklist = [];
    if (requiredSectionIds.length > 0) {
        checklist.push({
            id: "required-sections",
            label: "Preserve required sections",
            detail: `Runtime must keep sections: ${requiredSectionIds.join(", ")}.`,
        });
    }
    checklist.push({
        id: "mutation-envelope",
        label: "Stay inside the mutation envelope",
        detail: `Allowed runtime mutation mode: ${mutationMode}.`,
    });
    if (strictCategories.length > 0) {
        checklist.push({
            id: "strict-categories",
            label: "Honor strict enforcement categories",
            detail: `Strict categories: ${strictCategories.join(", ")}.`,
        });
    }
    if (contexts.length > 0) {
        checklist.push({
            id: "contexts",
            label: "Apply contextual runtime rules",
            detail: `Context rules: ${contexts.map((context) => asString(asRecord(context).id) ?? "unknown").join(", ")}.`,
        });
    }
    if (Object.keys(targetAcquisition).length > 0) {
        checklist.push({
            id: "target-acquisition",
            label: "Keep controls easy to acquire",
            detail: `Runtime should preserve ${String(targetAcquisition.minHitAreaPx ?? 44)}px targets, ` +
                `${String(targetAcquisition.minGapPx ?? 8)}px gaps, ` +
                `${String(targetAcquisition.minEdgeInsetPx ?? 8)}px edge inset, ` +
                `${String(targetAcquisition.destructiveGapPx ?? 16)}px destructive separation.`,
        });
    }
    if (Object.keys(feedbackRecovery).length > 0) {
        checklist.push({
            id: "feedback-recovery",
            label: "Honor async feedback and recovery policy",
            detail: `Runtime should observe async states ${asStringArray(feedbackRecovery.requiredStateKinds).join(", ")} ` +
                "and preserve required recovery affordances.",
        });
    }
    if (Object.keys(flowSummary).length > 0) {
        checklist.push({
            id: "flows",
            label: "Keep required task flows intact",
            detail: `Runtime should preserve flow requirements for ${asStringArray(flowSummary.flowIds).join(", ")} ` +
                "including required steps, transitions, and terminal states.",
        });
    }
    const textParts = [
        requiredSectionIds.length > 0 ? `preserve required sections ${requiredSectionIds.join(", ")}` : undefined,
        `stay within ${mutationMode} mutation scope`,
        strictCategories.length > 0 ? `treat ${strictCategories.join(", ")} as strict runtime categories` : undefined,
        contexts.length > 0 ? `evaluate ${contexts.length} contextual runtime rules` : undefined,
        Object.keys(targetAcquisition).length > 0
            ? `preserve ${String(targetAcquisition.minHitAreaPx ?? 44)}px targets and ${String(targetAcquisition.minGapPx ?? 8)}px gaps`
            : undefined,
        Object.keys(feedbackRecovery).length > 0
            ? `observe async feedback states ${asStringArray(feedbackRecovery.requiredStateKinds).join(", ")}`
            : undefined,
        Object.keys(flowSummary).length > 0
            ? `preserve required flows ${asStringArray(flowSummary.flowIds).join(", ")}`
            : undefined,
    ].filter((value) => Boolean(value));
    return {
        text: textParts.length > 0
            ? `${textParts.join("; ")}.`
            : "Use the prepared runtime bundle as the authoritative enforcement payload.",
        requiredSectionIds,
        mutationMode,
        strictCategories,
        contextIds: contexts
            .map((context) => asString(asRecord(context).id))
            .filter((value) => Boolean(value)),
        checklist,
    };
}
export function buildPreparedRuntimePayload(bundle) {
    if (!bundle.surface.runtime) {
        throw new AdapterInputError(`Bundle for surface "${bundle.surface.id}" does not include runtime.json.`, { code: "adapter.bundle.runtime-missing" });
    }
    const runtimeDoc = asRecord(bundle.surface.runtime.value);
    const identity = asRecord(runtimeDoc.identity);
    const generation = asRecord(bundle.surface.generation.value);
    const generationRefs = asRecord(generation.refs);
    const astDoc = bundle.surface.ast
        ? asRecord(bundle.surface.ast.value)
        : undefined;
    const platformsDoc = bundle.surface.platforms
        ? asRecord(bundle.surface.platforms.value)
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
                runtime: bundle.surface.runtime.path,
                generation: bundle.surface.generation.path,
                sections: bundle.surface.sections.path,
                components: bundle.surface.components.path,
                constraints: bundle.surface.constraints.path,
                repairMap: bundle.surface.repairMap.path,
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
        governance: asRecord(runtimeDoc.governance),
        runtime: {
            ...(astDoc && isRecord(astDoc.ast) ? { ast: astDoc.ast } : {}),
            ...(platformsDoc && Array.isArray(platformsDoc.platforms)
                ? { platforms: platformsDoc.platforms }
                : {}),
            ...asRecord(runtimeDoc.runtime),
        },
        evidenceRefs: Array.isArray(generationRefs.evidence) ? generationRefs.evidence : [],
    };
}
export function loadPreparedRuntimePayload(bundleRoot, surfaceId, cwd = process.cwd()) {
    const bundle = loadCompiledSurfaceBundle(bundleRoot, surfaceId, cwd);
    return buildPreparedRuntimePayload(bundle);
}
function writeError(error, code) {
    process.stderr.write(`${JSON.stringify({
        status: "error",
        code,
        error: error.message,
    }, null, 2)}\n`);
}
export async function runPrepareRuntimeCommand(options) {
    try {
        if (!options.bundleRoot) {
            throw new AdapterInputError("--bundle-root is required.");
        }
        if (!options.surfaceId) {
            throw new AdapterInputError("--surface is required.");
        }
        const payload = loadPreparedRuntimePayload(options.bundleRoot, options.surfaceId, process.cwd());
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
        writeError(internalError, "prepare-runtime.internal");
        return 1;
    }
}
