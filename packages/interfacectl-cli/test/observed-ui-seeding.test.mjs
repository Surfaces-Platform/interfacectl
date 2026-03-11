import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { seedObservedUiContract } from "../dist/utils/observed-ui-seeding.js";

function baseContract(surfaceId) {
  return {
    contractId: "ui-seed-test",
    version: "1.0.0",
    surfaces: [
      {
        id: surfaceId,
        displayName: "Seed Test",
        type: "web",
        requiredSections: ["main.hero"],
        allowedFonts: ["sans-serif"],
        layout: { maxContentWidth: 1120 },
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
      policy: "warn",
      allowedValues: [],
    },
  };
}

test("seedObservedUiContract captures existing fonts, layout width, motion, and UI tokens", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "interfacectl-seed-ui-"));
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
  return <main data-contract-section="main.hero" className="hero">Hello</main>;
}
`,
      "utf8",
    );

    await writeFile(
      path.join(appDir, "globals.css"),
      `:root {
  --contract-max-width: 960px;
  --contract-motion-duration: 180ms;
  --contract-motion-timing: ease-in-out;
  --font-sans: "Inter", sans-serif;
  --text-body: var(--text-body-size);
  --text-body-size: 1rem;
  --space-4: 16px;
  --space-6: var(--space-4);
  --container-xl: 60rem;
  --container-content: 960px;
  --motion-duration-200: 200ms;
  --motion-duration-fast: 0.2s;
  --motion-ease-standard: cubic-bezier(0.4, 0, 0.2, 1);
  --motion-ease-emphasized: cubic-bezier(0.4,0,0.2,1);
}

.hero {
  font-family: var(--font-sans);
  font-size: var(--text-body);
  line-height: var(--text-body);
  padding-inline: var(--space-6);
  max-width: var(--container-xl);
  width: var(--container-content);
  transition: opacity var(--motion-duration-fast) var(--motion-ease-standard);
  animation-duration: var(--motion-duration-200);
  animation-timing-function: var(--motion-ease-emphasized);
}
`,
      "utf8",
    );

    const seeded = await seedObservedUiContract({
      workspaceRoot: tempRoot,
      appRoot,
      surfaceId,
      contract: baseContract(surfaceId),
    });

    assert.deepEqual(seeded.contract.surfaces[0].allowedFonts, ["var(--font-sans)"]);
    assert.equal(seeded.contract.surfaces[0].layout.maxContentWidth, 960);
    assert.deepEqual(seeded.contract.constraints.motion.allowedDurationsMs, [180]);
    assert.deepEqual(seeded.contract.constraints.motion.allowedTimingFunctions, ["ease-in-out"]);
    assert.deepEqual(
      seeded.contract.tokens.typography.allowedTokens,
      ["var(--font-sans)", "var(--text-body-size)"],
    );
    assert.deepEqual(
      seeded.contract.tokens.typography.tokenMetadata,
      [
        {
          token: "var(--font-sans)",
          normalizedValue: "inter, sans-serif",
          attributes: ["font-family"],
          aliases: [],
        },
        {
          token: "var(--text-body-size)",
          normalizedValue: "1rem",
          attributes: ["font-size", "line-height"],
          aliases: ["var(--text-body)"],
        },
      ],
    );
    assert.deepEqual(
      seeded.contract.tokens.layout.allowedTokens,
      ["var(--container-content)", "var(--space-4)"],
    );
    assert.deepEqual(
      seeded.contract.tokens.layout.tokenMetadata,
      [
        {
          token: "var(--container-content)",
          normalizedValue: "960px",
          attributes: ["max-width", "width"],
          aliases: ["var(--container-xl)"],
        },
        {
          token: "var(--space-4)",
          normalizedValue: "16px",
          attributes: ["padding-inline"],
          aliases: ["var(--space-6)"],
        },
      ],
    );
    assert.deepEqual(
      seeded.contract.tokens.motion.allowedTokens,
      ["var(--motion-duration-200)", "var(--motion-ease-emphasized)"],
    );
    assert.deepEqual(
      seeded.contract.tokens.motion.tokenMetadata,
      [
        {
          token: "var(--motion-duration-200)",
          normalizedValue: "200ms",
          attributes: ["animation-duration", "transition"],
          aliases: ["var(--motion-duration-fast)"],
        },
        {
          token: "var(--motion-ease-emphasized)",
          normalizedValue: "cubic-bezier(0.4,0,0.2,1)",
          attributes: ["animation-timing-function", "transition"],
          aliases: ["var(--motion-ease-standard)"],
        },
      ],
    );
    assert.deepEqual(
      seeded.resolvedPlaceholderWarnings.sort(),
      ["allowedFonts.default", "layout.default"],
    );
    assert.equal(
      seeded.warnings.some((warning) => warning.code.includes("normalization-skipped")),
      false,
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("seedObservedUiContract warns when token normalization cannot resolve a token definition", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "interfacectl-seed-ui-unresolved-"));
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
  return <main data-contract-section="main.hero" className="hero">Hello</main>;
}
`,
      "utf8",
    );

    await writeFile(
      path.join(appDir, "globals.css"),
      `.hero {
  padding-inline: var(--space-missing);
}
`,
      "utf8",
    );

    const seeded = await seedObservedUiContract({
      workspaceRoot: tempRoot,
      appRoot,
      surfaceId,
      contract: baseContract(surfaceId),
    });

    assert.deepEqual(seeded.contract.tokens.layout.allowedTokens, ["var(--space-missing)"]);
    assert.deepEqual(
      seeded.contract.tokens.layout.tokenMetadata,
      [
        {
          token: "var(--space-missing)",
          normalizedValue: "var(--space-missing)",
          attributes: ["padding-inline"],
          aliases: [],
        },
      ],
    );
    assert.equal(
      seeded.warnings.some((warning) => warning.code === "ui-seed.layout.normalization-skipped"),
      true,
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
