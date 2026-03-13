import fs from "node:fs";
import path from "node:path";
import { AdapterInputError, isRecord, loadCompiledSurfaceBundle, } from "../adapter/bundle.js";
function sortKeysRecursive(value) {
    if (value === null || value === undefined) {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map(sortKeysRecursive);
    }
    if (typeof value === "object") {
        const sorted = {};
        for (const key of Object.keys(value).sort()) {
            sorted[key] = sortKeysRecursive(value[key]);
        }
        return sorted;
    }
    return value;
}
function stringifyDeterministic(value) {
    return `${JSON.stringify(sortKeysRecursive(value), null, 2)}\n`;
}
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
    const guidance = asRecord(generation.guidance);
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
function buildPreparedGenerationPayload(bundle) {
    const generation = asRecord(bundle.surface.generation.value);
    const generationRefs = asRecord(generation.refs);
    const identity = asRecord(generation.identity);
    const sectionsDoc = asRecord(bundle.surface.sections.value);
    const componentsDoc = asRecord(bundle.surface.components.value);
    const constraintsDoc = asRecord(bundle.surface.constraints.value);
    const repairMapDoc = asRecord(bundle.surface.repairMap.value);
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
                contract: bundle.contract.path,
                generation: bundle.surface.generation.path,
                sections: bundle.surface.sections.path,
                components: bundle.surface.components.path,
                constraints: bundle.surface.constraints.path,
                repairMap: bundle.surface.repairMap.path,
                ...(bundle.surface.authoring ? { authoring: bundle.surface.authoring.path } : {}),
            },
        },
        contract: {
            id: bundle.contractId,
            version: bundle.contractVersion,
            normalizedPath: bundle.contract.path,
        },
        summary: buildSummary(bundle),
        generation: {
            boundary: asRecord(generation.boundary),
            structure: asRecord(generation.structure),
            layout: asRecord(generation.layout),
            visual: asRecord(generation.visual),
            guidance: asRecord(generation.guidance),
        },
        sections: Array.isArray(sectionsDoc.sections) ? sectionsDoc.sections : [],
        components: Array.isArray(componentsDoc.components) ? componentsDoc.components : [],
        constraints: asRecord(constraintsDoc.constraints),
        repairMap: Array.isArray(repairMapDoc.repairs) ? repairMapDoc.repairs : [],
        ...(authoringDoc && isRecord(authoringDoc.authoring)
            ? { authoring: authoringDoc.authoring }
            : {}),
        evidenceRefs: Array.isArray(generationRefs.evidence) ? generationRefs.evidence : [],
    };
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
        const bundle = loadCompiledSurfaceBundle(options.bundleRoot, options.surfaceId, process.cwd());
        const payload = buildPreparedGenerationPayload(bundle);
        const serialized = stringifyDeterministic(payload);
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
