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
import { seedIconPolicyFromObservedDescriptors } from "../dist/utils/icon-policy-seeding.js";

function baseContract(surfaceId) {
  return {
    contractId: "icon-seed-test",
    version: "1.0.0",
    surfaces: [
      {
        id: surfaceId,
        displayName: "Seed Test",
        type: "web",
        requiredSections: ["main.hero"],
        allowedFonts: ["Inter"],
        layout: { maxContentWidth: 960 },
      },
    ],
    sections: [{ id: "main.hero", intent: "Hero", description: "Hero section" }],
    constraints: {
      motion: {
        allowedDurationsMs: [120],
        allowedTimingFunctions: ["linear"],
      },
    },
    color: {
      policy: "off",
      allowedValues: [],
    },
  };
}

test("seedIconPolicyFromObservedDescriptors seeds warn policy with discovered icon sources", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "interfacectl-seed-icons-"));
  const surfaceId = "demo-surface";
  const appRoot = path.join(tempRoot, "apps", surfaceId);

  try {
    const appDir = path.join(appRoot, "app");
    await mkdir(appDir, { recursive: true });

    await writeFile(
      path.join(appDir, "layout.tsx"),
      `
        export default function RootLayout({ children }) {
          return <html><body>{children}</body></html>;
        }
      `,
      "utf8",
    );

    await writeFile(
      path.join(appDir, "page.tsx"),
      `
        import { House } from "lucide-react";
        import { FiUser } from "react-icons/fi";
        export default function Page() {
          return <main data-contract-section="main.hero"><House /><FiUser /></main>;
        }
      `,
      "utf8",
    );

    const seeded = await seedIconPolicyFromObservedDescriptors({
      workspaceRoot: tempRoot,
      appRoot,
      surfaceId,
      contract: baseContract(surfaceId),
    });

    assert.deepEqual(seeded.contract.surfaces[0].icons, {
      policy: "warn",
      allowedSources: ["lucide-react", "react-icons/fi"],
    });
    assert.equal(
      seeded.warnings.some((warning) => warning.code === "icon-seed.none-detected"),
      false,
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("seedIconPolicyFromObservedDescriptors warns when no icon sources are detected", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "interfacectl-seed-icons-empty-"));
  const surfaceId = "demo-surface";
  const appRoot = path.join(tempRoot, "apps", surfaceId);

  try {
    const appDir = path.join(appRoot, "app");
    await mkdir(appDir, { recursive: true });

    await writeFile(
      path.join(appDir, "layout.tsx"),
      `
        export default function RootLayout({ children }) {
          return <html><body>{children}</body></html>;
        }
      `,
      "utf8",
    );

    await writeFile(
      path.join(appDir, "page.tsx"),
      `
        export default function Page() {
          return <main data-contract-section="main.hero">Hello</main>;
        }
      `,
      "utf8",
    );

    const seeded = await seedIconPolicyFromObservedDescriptors({
      workspaceRoot: tempRoot,
      appRoot,
      surfaceId,
      contract: baseContract(surfaceId),
    });

    assert.deepEqual(seeded.contract.surfaces[0].icons, {
      policy: "warn",
      allowedSources: [],
    });
    assert.ok(
      seeded.warnings.some((warning) => warning.code === "icon-seed.none-detected"),
      `Expected icon-seed.none-detected warning, got ${JSON.stringify(seeded.warnings)}`,
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
