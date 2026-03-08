import { test } from "node:test";
import assert from "node:assert/strict";
import { seedChromePolicyDefaults } from "../dist/utils/chrome-policy-seeding.js";

function baseContract() {
  return {
    contractId: "seed-test",
    version: "1.0.0",
    surfaces: [
      {
        id: "demo-web",
        displayName: "Demo Web",
        type: "web",
        requiredSections: ["header"],
        allowedFonts: ["Inter"],
        layout: { maxContentWidth: 1200 },
      },
      {
        id: "demo-cli",
        displayName: "Demo CLI",
        type: "cli",
        requiredSections: ["header"],
        allowedFonts: ["Inter"],
        layout: { maxContentWidth: 1200 },
      },
    ],
    sections: [{ id: "header", intent: "Header", description: "Header" }],
    constraints: {
      motion: {
        allowedDurationsMs: [200],
        allowedTimingFunctions: ["ease"],
      },
    },
    color: {
      policy: "warn",
      allowedValues: [],
    },
  };
}

test("seedChromePolicyDefaults seeds safe defaults for web surfaces only", async () => {
  const seeded = await seedChromePolicyDefaults({
    contract: baseContract(),
  });

  assert.deepEqual(seeded.contract.surfaces[0].layout.chromePolicy, {
    policy: "off",
    targets: ["page-container", "top-level-section", "layout-container"],
    maxBorderRadiusPx: 8,
    allowOuterShadow: false,
    allowInsetShadow: true,
  });
  assert.equal(seeded.contract.surfaces[1].layout.chromePolicy, undefined);
});

test("seedChromePolicyDefaults preserves existing chromePolicy", async () => {
  const contract = baseContract();
  contract.surfaces[0].layout.chromePolicy = {
    policy: "strict",
    targets: ["page-container"],
    maxBorderRadiusPx: 6,
    allowOuterShadow: false,
    allowInsetShadow: false,
  };

  const seeded = await seedChromePolicyDefaults({ contract });
  assert.deepEqual(seeded.contract.surfaces[0].layout.chromePolicy, {
    policy: "strict",
    targets: ["page-container"],
    maxBorderRadiusPx: 6,
    allowOuterShadow: false,
    allowInsetShadow: false,
  });
});
