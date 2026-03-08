import type { InterfaceContract } from "@surfaces/interfacectl-validator";

export interface ChromePolicySeedResult {
  contract: InterfaceContract;
  warnings: Array<{ code: string; message: string }>;
}

const DEFAULT_CHROME_POLICY = {
  policy: "off",
  targets: ["page-container", "top-level-section", "layout-container"],
  maxBorderRadiusPx: 8,
  allowOuterShadow: false,
  allowInsetShadow: true,
} as const;

export async function seedChromePolicyDefaults({
  contract,
}: {
  contract: InterfaceContract;
}): Promise<ChromePolicySeedResult> {
  return {
    contract: {
      ...contract,
      surfaces: contract.surfaces.map((surface) => {
        if (surface.type !== "web") {
          return surface;
        }
        if (surface.layout.chromePolicy) {
          return surface;
        }
        return {
          ...surface,
          layout: {
            ...surface.layout,
            chromePolicy: {
              ...DEFAULT_CHROME_POLICY,
              targets: [...DEFAULT_CHROME_POLICY.targets],
            },
          },
        };
      }),
    },
    warnings: [],
  };
}
