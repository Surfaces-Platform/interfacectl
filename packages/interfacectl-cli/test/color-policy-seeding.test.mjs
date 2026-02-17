import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import {
  mkdtemp,
  mkdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { seedColorPolicyFromObservedDescriptors } from "../dist/utils/color-policy-seeding.js";

function baseContract(surfaceId) {
  return {
    contractId: "seed-test",
    version: "1.0.0",
    surfaces: [
      {
        id: surfaceId,
        displayName: "Seed Test",
        type: "web",
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

test("seedColorPolicyFromObservedDescriptors seeds normalized discovered colors", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "interfacectl-seed-colors-"));
  const surfaceId = "demo-surface";
  const appRoot = path.join(tempRoot, "apps", surfaceId);

  try {
    const appDir = path.join(appRoot, "app");
    await mkdir(appDir, { recursive: true });

    await writeFile(
      path.join(appDir, "layout.tsx"),
      `import "./globals.css";
export default function RootLayout({ children }) {
  return <html><body>{children}</body></html>;
}
`,
      "utf8",
    );

    await writeFile(
      path.join(appDir, "page.tsx"),
      `export default function Page() {
  return <main data-contract-section="header" className="demo">Hello</main>;
}
`,
      "utf8",
    );

    await writeFile(
      path.join(appDir, "globals.css"),
      `.demo {
  color: RGBA(15, 23, 42, 0.3);
  border-color: #FFFFFF;
}
`,
      "utf8",
    );

    const seeded = await seedColorPolicyFromObservedDescriptors({
      workspaceRoot: tempRoot,
      appRoot,
      surfaceId,
      contract: baseContract(surfaceId),
    });

    assert.deepEqual(seeded.contract.color.allowedValues, [
      "#ffffff",
      "rgba(15, 23, 42, 0.3)",
    ]);
    assert.equal(
      seeded.warnings.some((warning) => warning.code === "color-seed.none-detected"),
      false,
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("seedColorPolicyFromObservedDescriptors warns when no colors are discovered", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "interfacectl-seed-empty-"));
  const surfaceId = "demo-surface";
  const appRoot = path.join(tempRoot, "apps", surfaceId);

  try {
    const appDir = path.join(appRoot, "app");
    await mkdir(appDir, { recursive: true });

    await writeFile(
      path.join(appDir, "layout.tsx"),
      `export default function RootLayout({ children }) {
  return <html><body>{children}</body></html>;
}
`,
      "utf8",
    );

    await writeFile(
      path.join(appDir, "page.tsx"),
      `export default function Page() {
  return <main data-contract-section="header">Hello</main>;
}
`,
      "utf8",
    );

    const seeded = await seedColorPolicyFromObservedDescriptors({
      workspaceRoot: tempRoot,
      appRoot,
      surfaceId,
      contract: baseContract(surfaceId),
    });

    assert.deepEqual(seeded.contract.color.allowedValues, []);
    assert.ok(
      seeded.warnings.some((warning) => warning.code === "color-seed.none-detected"),
      `Expected color-seed.none-detected warning, got ${JSON.stringify(seeded.warnings)}`,
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
