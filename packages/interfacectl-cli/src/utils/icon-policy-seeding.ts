import type { InterfaceContract } from "@surfaces/interfacectl-validator";
import { collectSurfaceDescriptors } from "../descriptors/static-analysis.js";

export interface IconPolicySeedingInput {
  workspaceRoot: string;
  appRoot: string;
  surfaceId: string;
  contract: InterfaceContract;
}

export interface IconPolicySeedingResult {
  contract: InterfaceContract;
  warnings: Array<{ code: string; message: string }>;
}

function normalizeIconSources(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b),
  );
}

export async function seedIconPolicyFromObservedDescriptors(
  input: IconPolicySeedingInput,
): Promise<IconPolicySeedingResult> {
  const warnings: Array<{ code: string; message: string }> = [];
  const surfaceRootMap = new Map<string, string>([[input.surfaceId, input.appRoot]]);

  const descriptorResult = await collectSurfaceDescriptors({
    workspaceRoot: input.workspaceRoot,
    contract: input.contract,
    surfaceFilters: new Set([input.surfaceId]),
    surfaceRootMap,
  });

  for (const warning of descriptorResult.warnings) {
    warnings.push({
      code: `icon-seed.${warning.code}`,
      message: `Descriptor warning during icon seed: ${warning.message}`,
    });
  }
  for (const error of descriptorResult.errors) {
    warnings.push({
      code: `icon-seed.${error.code}`,
      message: `Descriptor error during icon seed: ${error.message}`,
    });
  }

  const targetSurface = input.contract.surfaces.find(
    (surface) => surface.id === input.surfaceId,
  );
  if (!targetSurface || targetSurface.type !== "web") {
    return {
      contract: input.contract,
      warnings,
    };
  }

  const descriptor = descriptorResult.descriptors.find(
    (entry) => entry.surfaceId === input.surfaceId,
  );

  const discoveredSources = normalizeIconSources(
    descriptor?.icons?.map((icon) => icon.value) ?? [],
  );

  if (discoveredSources.length === 0) {
    warnings.push({
      code: "icon-seed.none-detected",
      message:
        "Icon source policy was not seeded from extraction because no icon sources were detected.",
    });
  }

  return {
    contract: {
      ...input.contract,
      surfaces: input.contract.surfaces.map((surface) =>
        surface.id === input.surfaceId && surface.type === "web"
          ? {
              ...surface,
              icons: {
                policy: "warn",
                allowedSources: discoveredSources,
              },
            }
          : surface,
      ),
    },
    warnings,
  };
}
