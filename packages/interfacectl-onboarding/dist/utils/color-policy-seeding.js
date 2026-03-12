import { normalizeColorValues } from "@surfaces/interfacectl-validator";
import { collectSurfaceDescriptors } from "../descriptors/static-analysis.js";
export async function seedColorPolicyFromObservedDescriptors(input) {
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
            code: `color-seed.${warning.code}`,
            message: `Descriptor warning during color seed: ${warning.message}`,
        });
    }
    for (const error of descriptorResult.errors) {
        warnings.push({
            code: `color-seed.${error.code}`,
            message: `Descriptor error during color seed: ${error.message}`,
        });
    }
    const descriptor = descriptorResult.descriptors.find((entry) => entry.surfaceId === input.surfaceId);
    const discoveredValues = normalizeColorValues(descriptor?.colors.map((color) => color.value) ?? []);
    if (discoveredValues.length === 0) {
        warnings.push({
            code: "color-seed.none-detected",
            message: "Color policy allowlist was not seeded from extraction because no colors were detected.",
        });
    }
    return {
        contract: {
            ...input.contract,
            color: {
                ...input.contract.color,
                allowedValues: discoveredValues,
            },
        },
        warnings,
    };
}
