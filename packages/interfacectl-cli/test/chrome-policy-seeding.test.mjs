import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { seedChromePolicyFromObservedDescriptors } from "../dist/utils/chrome-policy-seeding.js";

function baseContract(surfaceId = "demo-web") {
  return {
    contractId: "seed-test",
    version: "1.0.0",
    surfaces: [
      {
        id: surfaceId,
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

test("seedChromePolicyFromObservedDescriptors seeds chromePolicy from portable layout-container and top-level-section markers", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "interfacectl-seed-chrome-"));
  const surfaceId = "demo-web";
  const appRoot = path.join(tempRoot, "apps", surfaceId);

  try {
    await mkdir(path.join(appRoot, "app"), { recursive: true });

    await writeFile(
      path.join(appRoot, "app", "layout.tsx"),
      `
        export default function RootLayout({ children }) {
          return (
            <html>
              <body className="contract-container">{children}</body>
            </html>
          );
        }
      `,
      "utf8",
    );

    await writeFile(
      path.join(appRoot, "app", "page.tsx"),
      `
        export default function Page() {
          return (
            <section data-contract-section="header" className="shadow-lg" style={{ borderRadius: "6px" }}>
              Hello
            </section>
          );
        }
      `,
      "utf8",
    );

    await writeFile(
      path.join(appRoot, "app", "globals.css"),
      `
        .contract-container {
          border-radius: 8px;
          box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.12);
        }
      `,
      "utf8",
    );

    const seeded = await seedChromePolicyFromObservedDescriptors({
      workspaceRoot: tempRoot,
      appRoot,
      surfaceId,
      contract: baseContract(surfaceId),
    });

    assert.deepEqual(seeded.contract.surfaces[0].layout.chromePolicy, {
      policy: "off",
      targets: ["layout-container", "top-level-section"],
      maxBorderRadiusPx: 8,
      allowOuterShadow: true,
      allowInsetShadow: true,
    });
    assert.equal(seeded.contract.surfaces[1].layout.chromePolicy, undefined);
    assert.equal(
      seeded.warnings.some((warning) => warning.code === "chrome-seed.none-detected"),
      false,
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("seedChromePolicyFromObservedDescriptors preserves page-container compatibility", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "interfacectl-seed-chrome-page-container-"));
  const surfaceId = "demo-web";
  const appRoot = path.join(tempRoot, "apps", surfaceId);

  try {
    await mkdir(path.join(appRoot, "app"), { recursive: true });

    await writeFile(
      path.join(appRoot, "app", "layout.tsx"),
      `
        export default function RootLayout({ children }) {
          return <html><body>{children}</body></html>;
        }
      `,
      "utf8",
    );

    await writeFile(
      path.join(appRoot, "app", "page.tsx"),
      `
        export default function Page() {
          return (
            <main data-contract="page-container" className="rounded-lg shadow-inner">
              <section data-contract-section="header" className="shadow-lg" style={{ borderRadius: "6px" }}>
                Hello
              </section>
            </main>
          );
        }
      `,
      "utf8",
    );

    const seeded = await seedChromePolicyFromObservedDescriptors({
      workspaceRoot: tempRoot,
      appRoot,
      surfaceId,
      contract: baseContract(surfaceId),
    });

    assert.deepEqual(seeded.contract.surfaces[0].layout.chromePolicy, {
      policy: "off",
      targets: ["page-container", "top-level-section"],
      maxBorderRadiusPx: 8,
      allowOuterShadow: true,
      allowInsetShadow: true,
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("seedChromePolicyFromObservedDescriptors preserves legacy data-contract-container compatibility", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "interfacectl-seed-chrome-legacy-container-"));
  const surfaceId = "demo-web";
  const appRoot = path.join(tempRoot, "apps", surfaceId);

  try {
    await mkdir(path.join(appRoot, "app"), { recursive: true });

    await writeFile(
      path.join(appRoot, "app", "layout.tsx"),
      `
        export default function RootLayout({ children }) {
          return (
            <html>
              <body data-contract-container="shell">{children}</body>
            </html>
          );
        }
      `,
      "utf8",
    );

    await writeFile(
      path.join(appRoot, "app", "page.tsx"),
      `
        export default function Page() {
          return (
            <section data-contract-section="header" className="shadow-lg" style={{ borderRadius: "6px" }}>
              Hello
            </section>
          );
        }
      `,
      "utf8",
    );

    await writeFile(
      path.join(appRoot, "app", "globals.css"),
      `
        [data-contract-container="shell"] {
          box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.12);
        }
      `,
      "utf8",
    );

    const seeded = await seedChromePolicyFromObservedDescriptors({
      workspaceRoot: tempRoot,
      appRoot,
      surfaceId,
      contract: baseContract(surfaceId),
    });

    assert.deepEqual(seeded.contract.surfaces[0].layout.chromePolicy, {
      policy: "off",
      targets: ["layout-container", "top-level-section"],
      maxBorderRadiusPx: 6,
      allowOuterShadow: true,
      allowInsetShadow: true,
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("seedChromePolicyFromObservedDescriptors skips seeding when chrome signals are ambiguous", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "interfacectl-seed-chrome-ambiguous-"));
  const surfaceId = "demo-web";
  const appRoot = path.join(tempRoot, "apps", surfaceId);

  try {
    await mkdir(path.join(appRoot, "app"), { recursive: true });

    await writeFile(
      path.join(appRoot, "app", "layout.tsx"),
      `
        export default function RootLayout({ children }) {
          return (
            <html>
              <body className="contract-container rounded-[var(--radius-lg)]">{children}</body>
            </html>
          );
        }
      `,
      "utf8",
    );

    await writeFile(
      path.join(appRoot, "app", "page.tsx"),
      `
        export default function Page() {
          return <section data-contract-section="header" style={{ boxShadow: chromeShadow }}>Hello</section>;
        }
      `,
      "utf8",
    );

    const seeded = await seedChromePolicyFromObservedDescriptors({
      workspaceRoot: tempRoot,
      appRoot,
      surfaceId,
      contract: baseContract(surfaceId),
    });

    assert.equal(seeded.contract.surfaces[0].layout.chromePolicy, undefined);
    assert.equal(
      seeded.warnings.some((warning) => warning.code === "chrome-seed.ambiguous-signals"),
      true,
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("seedChromePolicyFromObservedDescriptors skips seeding when no portable markers are present", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "interfacectl-seed-chrome-none-"));
  const surfaceId = "demo-web";
  const appRoot = path.join(tempRoot, "apps", surfaceId);

  try {
    await mkdir(path.join(appRoot, "app"), { recursive: true });

    await writeFile(
      path.join(appRoot, "app", "layout.tsx"),
      `
        export default function RootLayout({ children }) {
          return <html><body>{children}</body></html>;
        }
      `,
      "utf8",
    );

    await writeFile(
      path.join(appRoot, "app", "page.tsx"),
      `
        export default function Page() {
          return <main>Hello</main>;
        }
      `,
      "utf8",
    );

    const seeded = await seedChromePolicyFromObservedDescriptors({
      workspaceRoot: tempRoot,
      appRoot,
      surfaceId,
      contract: baseContract(surfaceId),
    });

    assert.equal(seeded.contract.surfaces[0].layout.chromePolicy, undefined);
    assert.equal(
      seeded.warnings.some((warning) => warning.code === "chrome-seed.none-detected"),
      true,
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("seedChromePolicyFromObservedDescriptors preserves existing chromePolicy", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "interfacectl-seed-chrome-preserve-"));
  const surfaceId = "demo-web";
  const appRoot = path.join(tempRoot, "apps", surfaceId);
  const contract = baseContract(surfaceId);
  contract.surfaces[0].layout.chromePolicy = {
    policy: "strict",
    targets: ["page-container"],
    maxBorderRadiusPx: 6,
    allowOuterShadow: false,
    allowInsetShadow: false,
  };

  try {
    await mkdir(path.join(appRoot, "app"), { recursive: true });
    await writeFile(
      path.join(appRoot, "app", "layout.tsx"),
      `
        export default function RootLayout({ children }) {
          return <html><body>{children}</body></html>;
        }
      `,
      "utf8",
    );
    await writeFile(
      path.join(appRoot, "app", "page.tsx"),
      `
        export default function Page() {
          return <section data-contract-section="header" className="rounded-lg">Hello</section>;
        }
      `,
      "utf8",
    );

    const seeded = await seedChromePolicyFromObservedDescriptors({
      workspaceRoot: tempRoot,
      appRoot,
      surfaceId,
      contract,
    });

    assert.deepEqual(seeded.contract.surfaces[0].layout.chromePolicy, {
      policy: "strict",
      targets: ["page-container"],
      maxBorderRadiusPx: 6,
      allowOuterShadow: false,
      allowInsetShadow: false,
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
