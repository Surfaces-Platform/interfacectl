import { collectSurfaceDescriptors } from "../descriptors/static-analysis.js";
function normalizeTargets(targets) {
    return [...new Set(targets.map((value) => value.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}
function hasShadowKind(shadowKinds, expected) {
    return shadowKinds.some((kind) => kind === expected || kind === "mixed");
}
export async function seedChromePolicyFromObservedDescriptors(input) {
    const warnings = [];
    const surfaceRootMap = new Map([[input.surfaceId, input.appRoot]]);
    const descriptorResult = await collectSurfaceDescriptors({
        workspaceRoot: input.workspaceRoot,
        contract: input.contract,
        surfaceFilters: new Set([input.surfaceId]),
        surfaceRootMap,
    });
    for (const warning of descriptorResult.warnings) {
        warnings.push({
            code: `chrome-seed.${warning.code}`,
            message: `Descriptor warning during chrome seed: ${warning.message}`,
        });
    }
    for (const error of descriptorResult.errors) {
        warnings.push({
            code: `chrome-seed.${error.code}`,
            message: `Descriptor error during chrome seed: ${error.message}`,
        });
    }
    const targetSurface = input.contract.surfaces.find((surface) => surface.id === input.surfaceId);
    if (!targetSurface || targetSurface.type !== "web") {
        return {
            contract: input.contract,
            warnings,
        };
    }
    if (targetSurface.layout.chromePolicy) {
        return {
            contract: input.contract,
            warnings,
        };
    }
    const descriptor = descriptorResult.descriptors.find((entry) => entry.surfaceId === input.surfaceId);
    const observedChrome = descriptor?.layout.chrome;
    const observedTargets = normalizeTargets(observedChrome?.targets ?? []);
    if (!observedChrome || observedTargets.length === 0) {
        warnings.push({
            code: "chrome-seed.none-detected",
            message: "Chrome policy was not seeded from extraction because no portable chrome markers were detected.",
        });
        return {
            contract: input.contract,
            warnings,
        };
    }
    if (observedChrome.hasAmbiguousSignals) {
        warnings.push({
            code: "chrome-seed.ambiguous-signals",
            message: "Chrome policy was not seeded from extraction because one or more chrome signals on portable markers were not deterministically extractable.",
        });
        return {
            contract: input.contract,
            warnings,
        };
    }
    return {
        contract: {
            ...input.contract,
            surfaces: input.contract.surfaces.map((surface) => surface.id === input.surfaceId && surface.type === "web"
                ? {
                    ...surface,
                    layout: {
                        ...surface.layout,
                        chromePolicy: {
                            policy: "off",
                            targets: observedTargets,
                            maxBorderRadiusPx: observedChrome.maxBorderRadiusPx ?? 0,
                            allowOuterShadow: hasShadowKind(observedChrome.shadowKinds, "outer"),
                            allowInsetShadow: hasShadowKind(observedChrome.shadowKinds, "inset"),
                        },
                    },
                }
                : surface),
        },
        warnings,
    };
}
