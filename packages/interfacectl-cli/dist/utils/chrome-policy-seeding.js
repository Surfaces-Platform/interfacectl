const DEFAULT_CHROME_POLICY = {
    policy: "off",
    targets: ["page-container", "top-level-section", "layout-container"],
    maxBorderRadiusPx: 8,
    allowOuterShadow: false,
    allowInsetShadow: true,
};
export async function seedChromePolicyDefaults({ contract, }) {
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
