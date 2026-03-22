import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
} from "node:fs/promises";

import { collectSurfaceDescriptors } from "../dist/descriptors/static-analysis.js";

test("collectSurfaceDescriptors captures sections, containers, fonts, colors, and motion", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "interfacectl-static-"));
  const surfaceId = "demo-surface";
  const surfaceRoot = path.join(tempRoot, "apps", surfaceId);

  try {
    await mkdir(path.join(surfaceRoot, "app", "__tests__"), { recursive: true });

    await writeFile(
      path.join(surfaceRoot, "app", "layout.tsx"),
      `
        export default function RootLayout({ children }) {
          return (
            <html lang="en">
              <body data-contract-container="primary-shell" className="contract-container">
                {children}
              </body>
            </html>
          );
        }
      `,
      "utf-8",
    );

    await writeFile(
      path.join(surfaceRoot, "app", "page.tsx"),
      `
        export default function Page() {
          return (
            <main
              data-contract-section="main.hero"
              data-contract-container="primary-shell contract-container"
              className="contract-container"
            >
              <section data-contract-section="main.hero">
                <h1>Demo Surface</h1>
              </section>
            </main>
          );
        }
      `,
      "utf-8",
    );

    await writeFile(
      path.join(surfaceRoot, "app", "globals.css"),
      `
        :root {
          --contract-max-width: 960px;
          --contract-motion-duration: 120ms;
          --contract-motion-timing: ease-in;
          --font-demo: "Demo Sans";
          --color-primary: #0066cc;
          --color-background: #ffffff;
        }

        .contract-container {
          transition: opacity var(--contract-motion-duration) ease-in;
          background-color: var(--color-background);
        }

        .demo-body {
          font-family: var(--font-demo), "Demo Sans", monospace;
          color: var(--color-primary);
        }

        .demo-text {
          color: #333333;
          border-color: rgb(200, 200, 200);
        }
      `,
      "utf-8",
    );

    await writeFile(
      path.join(surfaceRoot, "app", "__tests__", "ignored.spec.tsx"),
      `
        export default function Ignored() {
          return <section data-contract-section="ignored.section" />;
        }
      `,
      "utf-8",
    );

    const contract = {
      contractId: "test.contract",
      version: "1.0.0",
      sections: [
        {
          id: "main.hero",
          intent: "hero",
          description: "Hero section",
        },
      ],
      constraints: {
        motion: {
          allowedDurationsMs: [120],
          allowedTimingFunctions: ["linear", "ease-in"],
        },
      },
      surfaces: [
        {
          id: surfaceId,
          displayName: "Demo Surface",
          type: "web",
          requiredSections: ["main.hero"],
          allowedFonts: ["var(--font-demo)", "Demo Sans", "monospace"],
          layout: {
            maxContentWidth: 960,
            requiredContainers: ["primary-shell"],
          },
        },
      ],
      color: {
        policy: "warn",
        allowedValues: [
          "var(--color-primary)",
          "var(--color-background)",
          "#333333",
          "rgb(200,200,200)",
        ],
      },
    };

    const result = await collectSurfaceDescriptors({
      workspaceRoot: tempRoot,
      contract,
      surfaceFilters: new Set(),
      surfaceRootMap: new Map(),
    });

    assert.equal(result.errors.length, 0);
    assert.equal(result.warnings.length, 0);
    assert.equal(result.descriptors.length, 1);

    const descriptor = result.descriptors[0];
    assert.ok(descriptor, "descriptor should be defined");

    assert.deepEqual(descriptor.sections, [
      {
        id: "main.hero",
        source: path.relative(tempRoot, path.join(surfaceRoot, "app", "page.tsx")),
      },
    ]);

    assert.equal(descriptor.layout.maxContentWidth, 960);
    assert.deepEqual(descriptor.layout.containers, [
      "contract-container",
      "primary-shell",
    ]);
    assert.deepEqual(descriptor.layout.containerSources, [
      path.relative(tempRoot, path.join(surfaceRoot, "app", "layout.tsx")),
      path.relative(tempRoot, path.join(surfaceRoot, "app", "page.tsx")),
    ]);

    const fontValues = descriptor.fonts.map((font) => font.value).sort();
    assert.deepEqual(fontValues, ["Demo Sans", "monospace", "var(--font-demo)"]);

    const colorValues = descriptor.colors.map((color) => color.value).sort();
    assert.deepEqual(colorValues, [
      "#333333",
      "rgb(200, 200, 200)",
      "var(--color-background)",
      "var(--color-primary)",
    ]);

    assert.ok(descriptor.motion.length > 0, "expected motion descriptors");
    const durations = descriptor.motion.map((motion) => motion.durationMs);
    assert.ok(durations.includes(120), "should include duration from CSS variable");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("detects shell-owned primitives (navigation/footer/auth-shell) in descriptors", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "interfacectl-primitives-"));
  const surfaceId = "demo-primitives";
  const surfaceRoot = path.join(tempRoot, "apps", surfaceId);

  try {
    await mkdir(path.join(surfaceRoot, "app"), { recursive: true });

    await writeFile(
      path.join(surfaceRoot, "app", "layout.tsx"),
      `
        import Navigation from "@surfaces/ui/components/Navigation";
        export default function RootLayout({ children }) {
          return (
            <html lang="en">
              <body data-contract-container="primary-shell">
                <Navigation />
                {children}
                <footer>footer content</footer>
              </body>
            </html>
          );
        }
      `,
      "utf-8",
    );

    await writeFile(
      path.join(surfaceRoot, "app", "page.tsx"),
      `
        import AuthLayout from "@/components/AuthLayout";
        export default function Page() {
          return (
            <AuthLayout>
              <main data-contract-section="main.hero">Hello</main>
            </AuthLayout>
          );
        }
      `,
      "utf-8",
    );

    const contract = {
      contractId: "test.contract",
      version: "1.0.0",
      sections: [
        { id: "main.hero", intent: "hero", description: "Hero section" },
      ],
      constraints: {
        motion: { allowedDurationsMs: [120], allowedTimingFunctions: ["linear"] },
      },
      surfaces: [
        {
          id: surfaceId,
          displayName: "Demo Primitives",
          type: "web",
          requiredSections: ["main.hero"],
          allowedFonts: ["Inter"],
          layout: { maxContentWidth: 1120 },
        },
      ],
      color: {
        policy: "off",
        allowedValues: [],
      },
    };

    const result = await collectSurfaceDescriptors({
      workspaceRoot: tempRoot,
      contract,
      surfaceFilters: new Set(),
      surfaceRootMap: new Map(),
    });

    assert.equal(result.errors.length, 0);
    const descriptor = result.descriptors[0];
    assert.ok(descriptor);

    const roles = Object.fromEntries(
      (descriptor.primitives ?? []).map((p) => [p.role, p.count]),
    );

    assert.equal(roles.navigation, 1, "should detect navigation primitive");
    assert.equal(roles.footer, 1, "should detect footer primitive");
    assert.equal(roles["auth-shell"], 1, "should detect auth-shell primitive");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("collectSurfaceDescriptors extracts marketing layout signals and typography-role tokens", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "interfacectl-marketing-"));
  const surfaceId = "marketing-surface";
  const surfaceRoot = path.join(tempRoot, "apps", surfaceId);

  try {
    await mkdir(path.join(surfaceRoot, "app"), { recursive: true });

    await writeFile(
      path.join(surfaceRoot, "app", "globals.css"),
      `
        :root {
          --contract-max-width: 1120px;
          --contract-motion-duration: 120ms;
          --contract-motion-timing: linear;
          --font-marketing: "Inter";
          --color-marketing-text: #111827;
          --marketing-sans-hero-title-size: 32px;
          --marketing-sans-hero-title-line-height: 1.2;
          --marketing-sans-body-size: 14px;
          --marketing-sans-body-line-height: 1.6;
        }

        body {
          font-family: var(--font-marketing), Inter, sans-serif;
          color: var(--color-marketing-text);
          transition: opacity var(--contract-motion-duration) linear;
        }
      `,
      "utf-8",
    );

    await writeFile(
      path.join(surfaceRoot, "app", "page.tsx"),
      `
        export default function Page() {
          return (
            <div
              data-contract="page-container"
              data-contract-typography-profile="marketing-sans"
              className="min-h-screen w-full"
            >
              <section
                data-contract-section="landing.hero"
                data-contract-marketing-layout-profile="marketing-open-flow-split"
                data-contract-hero-container-mode="open-flow"
                data-contract-hero-visual-placement="inline-end"
                data-contract-section-divider-mode="border-top"
                data-contract-section-spacing-profile="roomy"
              >
                <h1
                  data-contract-copy-role="heroTitle"
                  style={{
                    fontSize: "var(--marketing-sans-hero-title-size)",
                    lineHeight: "var(--marketing-sans-hero-title-line-height)"
                  }}
                >
                  Marketing Surface
                </h1>
                <p
                  data-contract-copy-role="body"
                  style={{
                    fontSize: "var(--marketing-sans-body-size)",
                    lineHeight: "var(--marketing-sans-body-line-height)"
                  }}
                >
                  Body copy
                </p>
              </section>
            </div>
          );
        }
      `,
      "utf-8",
    );

    const contract = {
      contractId: "marketing.contract",
      version: "1.0.0",
      sections: [
        {
          id: "landing.hero",
          intent: "hero",
          description: "Hero section",
        },
      ],
      constraints: {
        motion: {
          allowedDurationsMs: [120],
          allowedTimingFunctions: ["linear"],
        },
      },
      surfaces: [
        {
          id: surfaceId,
          displayName: "Marketing Surface",
          type: "web",
          requiredSections: ["landing.hero"],
          allowedFonts: ["Inter", "var(--font-marketing)", "sans-serif"],
          layout: {
            maxContentWidth: 1120,
            landingPattern: {
              policy: "warn",
              marketingLayoutProfile: "marketing-open-flow-split",
              marketingLayoutPolicy: "warn",
            },
          },
          marketingTypographyProfile: "marketing-sans",
          marketingTypographyPolicy: "warn",
        },
      ],
      marketingProfiles: {
        layout: [
          {
            id: "marketing-open-flow-split",
            heroContainerMode: "open-flow",
            heroVisualPlacement: "inline-end",
            sectionDividerMode: "border-top",
            sectionSpacingProfile: "roomy",
          },
        ],
        typography: [
          {
            id: "marketing-sans",
            roles: [
              {
                role: "heroTitle",
                allowedTokens: [
                  "var(--marketing-sans-hero-title-size)",
                  "var(--marketing-sans-hero-title-line-height)",
                ],
              },
              {
                role: "body",
                allowedTokens: [
                  "var(--marketing-sans-body-size)",
                  "var(--marketing-sans-body-line-height)",
                ],
              },
            ],
          },
        ],
      },
      color: {
        policy: "warn",
        allowedValues: ["var(--color-marketing-text)"],
      },
    };

    const result = await collectSurfaceDescriptors({
      workspaceRoot: tempRoot,
      contract,
      surfaceFilters: new Set(),
      surfaceRootMap: new Map(),
    });

    assert.equal(result.errors.length, 0);
    assert.equal(result.warnings.length, 0);

    const descriptor = result.descriptors[0];
    assert.equal(
      descriptor.layout.landingPattern?.marketingLayoutProfile,
      "marketing-open-flow-split",
    );
    assert.equal(
      descriptor.layout.landingPattern?.heroContainerMode,
      "open-flow",
    );
    assert.equal(
      descriptor.layout.landingPattern?.heroVisualPlacement,
      "inline-end",
    );
    assert.equal(
      descriptor.layout.landingPattern?.sectionDividerMode,
      "border-top",
    );
    assert.equal(
      descriptor.layout.landingPattern?.sectionSpacingProfile,
      "roomy",
    );
    assert.equal(descriptor.marketingTypography?.profileId, "marketing-sans");
    assert.deepEqual(
      descriptor.marketingTypography?.roles.map((role) => role.role),
      ["body", "heroTitle"],
    );
    assert.deepEqual(
      descriptor.marketingTypography?.roles.find((role) => role.role === "heroTitle")?.tokens.map((token) => token.value),
      [
        "var(--marketing-sans-hero-title-line-height)",
        "var(--marketing-sans-hero-title-size)",
      ],
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("collectSurfaceDescriptors captures deterministic icon sources from surface and shared UI imports", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "interfacectl-icons-static-"));
  const surfaceId = "demo-icons";
  const surfaceRoot = path.join(tempRoot, "apps", surfaceId);
  const sharedUiRoot = path.join(tempRoot, "packages", "ui", "src", "components");

  try {
    await mkdir(path.join(surfaceRoot, "app"), { recursive: true });
    await mkdir(sharedUiRoot, { recursive: true });

    await writeFile(
      path.join(surfaceRoot, "app", "layout.tsx"),
      `
        export default function RootLayout({ children }) {
          return <html><body>{children}</body></html>;
        }
      `,
      "utf-8",
    );

    await writeFile(
      path.join(surfaceRoot, "app", "page.tsx"),
      `
        import { House } from "lucide-react";
        import IconButton from "@surfaces/ui/components/IconButton";
        import { IconBadge } from "./IconBadge";

        export default function Page() {
          return (
            <main data-contract-section="main.hero">
              <House />
              <IconButton />
              <IconBadge />
            </main>
          );
        }
      `,
      "utf-8",
    );

    await writeFile(
      path.join(surfaceRoot, "app", "IconBadge.tsx"),
      `
        import { AlertCircle } from "lucide-react";
        export function IconBadge() {
          return <AlertCircle />;
        }
      `,
      "utf-8",
    );

    await writeFile(
      path.join(sharedUiRoot, "IconButton.tsx"),
      `
        import { BellIcon } from "@heroicons/react/24/outline";
        export { UiIcon } from "./UiIcon";
        export default function IconButton() {
          return <BellIcon />;
        }
      `,
      "utf-8",
    );

    await writeFile(
      path.join(sharedUiRoot, "UiIcon.tsx"),
      `
        import { FiUser } from "react-icons/fi";
        export function UiIcon() {
          return <FiUser />;
        }
      `,
      "utf-8",
    );

    const contract = {
      contractId: "test.contract",
      version: "1.0.0",
      sections: [{ id: "main.hero", intent: "Hero", description: "Hero section" }],
      constraints: {
        motion: {
          allowedDurationsMs: [120],
          allowedTimingFunctions: ["linear"],
        },
      },
      surfaces: [
        {
          id: surfaceId,
          displayName: "Demo Icons",
          type: "web",
          requiredSections: ["main.hero"],
          allowedFonts: ["Inter"],
          layout: { maxContentWidth: 960 },
        },
      ],
      color: {
        policy: "off",
        allowedValues: [],
      },
    };

    const result = await collectSurfaceDescriptors({
      workspaceRoot: tempRoot,
      contract,
      surfaceFilters: new Set(),
      surfaceRootMap: new Map(),
    });

    assert.equal(result.errors.length, 0);
    const iconResolutionWarnings = result.warnings.filter(
      (warning) => warning.code === "icons.shared-ui-unresolved",
    );
    assert.equal(iconResolutionWarnings.length, 0);
    const descriptor = result.descriptors[0];
    assert.ok(descriptor);

    assert.deepEqual(
      (descriptor.icons ?? []).map((icon) => icon.value),
      ["@heroicons/react/24/outline", "lucide-react", "react-icons/fi"],
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("collectSurfaceDescriptors extracts interactive target metrics and classifications", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "interfacectl-target-static-"));
  const surfaceId = "target-surface";
  const surfaceRoot = path.join(tempRoot, "apps", surfaceId);

  try {
    await mkdir(path.join(surfaceRoot, "app"), { recursive: true });

    await writeFile(
      path.join(surfaceRoot, "app", "page.tsx"),
      `
        export default function Page() {
          return (
            <main data-contract-section="main.hero">
              <a
                data-contract-target="hero-primary"
                data-contract-action-kind="primary"
                data-contract-target-gap={12}
                data-contract-target-edge-inset={16}
                style={{ width: 44, height: 44 }}
                href="#hero"
              >
                Start
              </a>
              <button
                type="button"
                data-contract-target="delete-workspace"
                data-contract-action-risk="destructive"
                data-contract-target-gap={10}
                data-contract-nearest-kind="primary"
                style={{ width: "44px", height: "44px", right: 4, bottom: 4 }}
              >
                Delete
              </button>
            </main>
          );
        }
      `,
      "utf-8",
    );

    const contract = {
      contractId: "target.contract",
      version: "1.0.0",
      sections: [
        { id: "main.hero", intent: "hero", description: "Hero section" },
      ],
      constraints: {
        motion: { allowedDurationsMs: [120], allowedTimingFunctions: ["linear"] },
      },
      surfaces: [
        {
          id: surfaceId,
          displayName: "Target Surface",
          type: "web",
          requiredSections: ["main.hero"],
          allowedFonts: ["Inter"],
          layout: {
            maxContentWidth: 1120,
            targetAcquisition: {
              policy: "warn",
            },
          },
        },
      ],
      color: {
        policy: "off",
        allowedValues: [],
      },
    };

    const result = await collectSurfaceDescriptors({
      workspaceRoot: tempRoot,
      contract,
      surfaceFilters: new Set(),
      surfaceRootMap: new Map(),
    });

    assert.equal(result.errors.length, 0);
    const descriptor = result.descriptors[0];
    assert.ok(descriptor);
    assert.equal(descriptor.interactiveTargets?.length, 2);
    assert.deepEqual(
      descriptor.interactiveTargets?.map((target) => target.id),
      ["delete-workspace", "hero-primary"],
    );
    assert.equal(
      descriptor.interactiveTargets?.find((target) => target.id === "hero-primary")?.boundingBox?.width,
      44,
    );
    assert.equal(
      descriptor.interactiveTargets?.find((target) => target.id === "hero-primary")?.classification,
      "primary",
    );
    assert.equal(
      descriptor.interactiveTargets?.find((target) => target.id === "delete-workspace")?.classification,
      "destructive",
    );
    assert.equal(
      descriptor.interactiveTargets?.find((target) => target.id === "delete-workspace")?.edgeInsetPx,
      4,
    );
    assert.equal(
      descriptor.interactiveTargets?.find((target) => target.id === "delete-workspace")?.nearestNeighborClassification,
      "primary",
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("collectSurfaceDescriptors extracts contract-scoped async states and recovery affordances", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "interfacectl-feedback-static-"));
  const surfaceId = "feedback-surface";
  const surfaceRoot = path.join(tempRoot, "apps", surfaceId);

  try {
    await mkdir(path.join(surfaceRoot, "app"), { recursive: true });

    await writeFile(
      path.join(surfaceRoot, "app", "page.tsx"),
      `
        export default function Page() {
          return (
            <main data-contract-section="main.hero">
              <section
                data-contract-state-id="success"
                data-contract-state-kind="success"
                data-contract-section="main.hero"
              >
                <h1>Dashboard ready</h1>
              </section>
              <section
                data-contract-state-id="empty"
                data-contract-state-kind="empty"
                data-contract-section="main.hero"
              >
                <p>No queued items remain.</p>
              </section>
              <section
                data-contract-state-id="loading"
                data-contract-state-kind="loading"
                data-contract-section="main.hero"
              >
                <button
                  type="button"
                  data-contract-state-id="loading"
                  data-contract-interaction="submit-refresh"
                  disabled
                >
                  Refreshing
                </button>
              </section>
              <section
                data-contract-state-id="error"
                data-contract-state-kind="error"
                data-contract-section="main.hero"
                data-contract-preserve-last-good="true"
              >
                <button
                  type="button"
                  data-contract-state-id="error"
                  data-contract-recovery-action="retry"
                >
                  Retry
                </button>
              </section>
            </main>
          );
        }
      `,
      "utf-8",
    );

    const contract = {
      contractId: "feedback.contract",
      version: "1.0.0",
      sections: [
        { id: "main.hero", intent: "hero", description: "Hero section" },
      ],
      constraints: {
        motion: { allowedDurationsMs: [120], allowedTimingFunctions: ["linear"] },
      },
      surfaces: [
        {
          id: surfaceId,
          displayName: "Feedback Surface",
          type: "web",
          requiredSections: ["main.hero"],
          allowedFonts: ["Inter"],
          layout: {
            maxContentWidth: 960,
          },
          runtime: {
            feedbackRecovery: {
              policy: "warn",
            },
            contexts: [
              { id: "loading", when: "request == pending", kind: "loading" },
              { id: "empty", when: "items.length == 0", kind: "empty" },
              { id: "error", when: "request == failed", kind: "error" },
              { id: "success", when: "request == fulfilled", kind: "success" },
            ],
          },
        },
      ],
      color: {
        policy: "off",
        allowedValues: [],
      },
    };

    const result = await collectSurfaceDescriptors({
      workspaceRoot: tempRoot,
      contract,
      surfaceFilters: new Set(),
      surfaceRootMap: new Map(),
    });

    assert.equal(result.errors.length, 0);
    const descriptor = result.descriptors[0];
    assert.ok(descriptor);
    assert.equal(descriptor.asyncStateObservation?.source, "static-markers");
    assert.equal(descriptor.asyncStates?.length, 4);
    assert.deepEqual(
      descriptor.asyncStates?.map((state) => state.id).sort(),
      ["empty", "error", "loading", "success"],
    );
    assert.deepEqual(
      descriptor.asyncStates?.find((state) => state.id === "error")?.recoveryActions,
      ["retry"],
    );
    assert.equal(
      descriptor.asyncStates?.find((state) => state.id === "error")?.preserveLastGoodContent,
      true,
    );
    assert.deepEqual(
      descriptor.asyncStates?.find((state) => state.id === "loading")?.blockedActions,
      [{ interactionId: "submit-refresh", disabled: true }],
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("collectSurfaceDescriptors extracts contract-scoped flow markers", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "interfacectl-flow-static-"));
  const surfaceId = "flow-surface";
  const surfaceRoot = path.join(tempRoot, "apps", surfaceId);

  try {
    await mkdir(path.join(surfaceRoot, "app"), { recursive: true });

    await writeFile(
      path.join(surfaceRoot, "app", "page.tsx"),
      `
        export default function Page() {
          return (
            <main data-contract="page-container" data-contract-container="page-container">
              <div data-contract-flow-id="workspace-delete">
                <section data-contract-section="main.hero">
                  <h1>Flow fixture</h1>
                </section>
                <section data-contract-flow-step="request">
                  <button data-contract-flow-transition-to="review" type="button">
                    Continue to review
                  </button>
                </section>
                <section data-contract-flow-step="review">
                  <button data-contract-flow-transition-to="confirm" type="button">
                    Continue to confirm
                  </button>
                </section>
                <section data-contract-flow-step="confirm" data-contract-flow-terminal="true">
                  <p>Confirm deletion</p>
                </section>
              </div>
            </main>
          );
        }
      `,
      "utf-8",
    );

    await writeFile(
      path.join(surfaceRoot, "app", "globals.css"),
      `
        :root {
          --contract-max-width: 960px;
        }
      `,
      "utf-8",
    );

    const contract = {
      contractId: "flow.contract",
      version: "1.0.0",
      sections: [
        { id: "main.hero", intent: "hero", description: "Hero section" },
      ],
      constraints: {
        motion: { allowedDurationsMs: [120], allowedTimingFunctions: ["linear"] },
      },
      surfaces: [
        {
          id: surfaceId,
          displayName: "Flow Surface",
          type: "web",
          requiredSections: ["main.hero"],
          allowedFonts: ["Inter"],
          layout: {
            maxContentWidth: 960,
          },
          flows: {
            policy: "warn",
            requirements: [
              {
                flowId: "workspace-delete",
                minSteps: 2,
                requiredSteps: ["request", "review", "confirm"],
                requiredTransitions: [
                  { from: "request", to: "review" },
                  { from: "review", to: "confirm" },
                ],
                terminalSteps: ["confirm"],
              },
            ],
          },
        },
      ],
      color: {
        policy: "off",
        allowedValues: [],
      },
    };

    const result = await collectSurfaceDescriptors({
      workspaceRoot: tempRoot,
      contract,
      surfaceFilters: new Set(),
      surfaceRootMap: new Map(),
    });

    assert.equal(result.errors.length, 0);
    const descriptor = result.descriptors[0];
    assert.ok(descriptor);
    assert.equal(descriptor.flowObservation?.source, "static-markers");
    assert.equal(descriptor.flows?.length, 1);
    assert.deepEqual(
      descriptor.flows?.[0]?.steps,
      [
        { id: "confirm", terminal: true },
        { id: "request" },
        { id: "review" },
      ],
    );
    assert.deepEqual(
      descriptor.flows?.[0]?.transitions,
      [
        { from: "request", to: "review" },
        { from: "review", to: "confirm" },
      ],
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("collectSurfaceDescriptors captures portable chrome markers and deterministic chrome signals", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "interfacectl-chrome-static-"));
  const surfaceId = "demo-chrome";
  const surfaceRoot = path.join(tempRoot, "apps", surfaceId);

  try {
    await mkdir(path.join(surfaceRoot, "app"), { recursive: true });

    await writeFile(
      path.join(surfaceRoot, "app", "layout.tsx"),
      `
        export default function RootLayout({ children }) {
          return (
            <html>
              <body
                className="contract-container"
                style={{ borderRadius: "4px" }}
              >
                <main data-contract="page-container" className="rounded-lg">
                  {children}
                </main>
              </body>
            </html>
          );
        }
      `,
      "utf-8",
    );

    await writeFile(
      path.join(surfaceRoot, "app", "page.tsx"),
      `
        export default function Page() {
          return (
            <main>
              <section
                data-contract-section="main.hero"
                style={{ boxShadow: "0 12px 24px rgba(0, 0, 0, 0.16)" }}
              >
                Hello
              </section>
            </main>
          );
        }
      `,
      "utf-8",
    );

    await writeFile(
      path.join(surfaceRoot, "app", "globals.css"),
      `
        .contract-container {
          box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.12);
        }
      `,
      "utf-8",
    );

    const contract = {
      contractId: "test.contract",
      version: "1.0.0",
      sections: [{ id: "main.hero", intent: "Hero", description: "Hero section" }],
      constraints: {
        motion: {
          allowedDurationsMs: [120],
          allowedTimingFunctions: ["linear"],
        },
      },
      surfaces: [
        {
          id: surfaceId,
          displayName: "Demo Chrome",
          type: "web",
          requiredSections: ["main.hero"],
          allowedFonts: ["Inter"],
          layout: { maxContentWidth: 960 },
        },
      ],
      color: {
        policy: "off",
        allowedValues: [],
      },
    };

    const result = await collectSurfaceDescriptors({
      workspaceRoot: tempRoot,
      contract,
      surfaceFilters: new Set(),
      surfaceRootMap: new Map(),
    });

    assert.equal(result.errors.length, 0);
    assert.equal(
      result.warnings.some((warning) => warning.code.startsWith("chrome.")),
      false,
    );
    const descriptor = result.descriptors[0];
    assert.ok(descriptor?.layout.chrome, "chrome descriptor should be extracted");
    assert.deepEqual(descriptor.layout.chrome.targets, [
      "layout-container",
      "page-container",
      "top-level-section",
    ]);
    assert.equal(descriptor.layout.chrome.maxBorderRadiusPx, 8);
    assert.deepEqual(descriptor.layout.chrome.shadowKinds, ["inset", "outer"]);
    assert.equal(descriptor.layout.chrome.hasAmbiguousSignals, undefined);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("collectSurfaceDescriptors flags ambiguous chrome signals", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "interfacectl-chrome-ambiguous-"));
  const surfaceId = "demo-chrome-ambiguous";
  const surfaceRoot = path.join(tempRoot, "apps", surfaceId);

  try {
    await mkdir(path.join(surfaceRoot, "app"), { recursive: true });

    await writeFile(
      path.join(surfaceRoot, "app", "layout.tsx"),
      `
        export default function RootLayout({ children }) {
          return (
            <html>
              <body className="contract-container rounded-[var(--radius-lg)]">
                {children}
              </body>
            </html>
          );
        }
      `,
      "utf-8",
    );

    await writeFile(
      path.join(surfaceRoot, "app", "page.tsx"),
      `
        export default function Page() {
          return (
            <section data-contract-section="main.hero" style={{ boxShadow: chromeShadow }}>
              Hello
            </section>
          );
        }
      `,
      "utf-8",
    );

    const contract = {
      contractId: "test.contract",
      version: "1.0.0",
      sections: [{ id: "main.hero", intent: "Hero", description: "Hero section" }],
      constraints: {
        motion: {
          allowedDurationsMs: [120],
          allowedTimingFunctions: ["linear"],
        },
      },
      surfaces: [
        {
          id: surfaceId,
          displayName: "Demo Chrome Ambiguous",
          type: "web",
          requiredSections: ["main.hero"],
          allowedFonts: ["Inter"],
          layout: { maxContentWidth: 960 },
        },
      ],
      color: {
        policy: "off",
        allowedValues: [],
      },
    };

    const result = await collectSurfaceDescriptors({
      workspaceRoot: tempRoot,
      contract,
      surfaceFilters: new Set(),
      surfaceRootMap: new Map(),
    });

    assert.equal(result.errors.length, 0);
    assert.equal(
      result.warnings.some((warning) => warning.code === "chrome.radius-undetermined"),
      true,
    );
    assert.equal(
      result.warnings.some((warning) => warning.code === "chrome.shadow-undetermined"),
      true,
    );
    const descriptor = result.descriptors[0];
    assert.ok(descriptor?.layout.chrome, "chrome descriptor should still exist");
    assert.equal(descriptor.layout.chrome.hasAmbiguousSignals, true);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("collectSurfaceDescriptors preserves legacy data-contract-container chrome extraction", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "interfacectl-chrome-legacy-"));
  const surfaceId = "demo-chrome-legacy";
  const surfaceRoot = path.join(tempRoot, "apps", surfaceId);

  try {
    await mkdir(path.join(surfaceRoot, "app"), { recursive: true });

    await writeFile(
      path.join(surfaceRoot, "app", "layout.tsx"),
      `
        export default function RootLayout({ children }) {
          return (
            <html>
              <body data-contract-container="shell">{children}</body>
            </html>
          );
        }
      `,
      "utf-8",
    );

    await writeFile(
      path.join(surfaceRoot, "app", "page.tsx"),
      `
        export default function Page() {
          return (
            <section
              data-contract-section="main.hero"
              className="shadow-lg"
              style={{ borderRadius: "6px" }}
            >
              Hello
            </section>
          );
        }
      `,
      "utf-8",
    );

    await writeFile(
      path.join(surfaceRoot, "app", "globals.css"),
      `
        [data-contract-container="shell"] {
          box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.12);
        }
      `,
      "utf-8",
    );

    const contract = {
      contractId: "test.contract",
      version: "1.0.0",
      sections: [{ id: "main.hero", intent: "Hero", description: "Hero section" }],
      constraints: {
        motion: {
          allowedDurationsMs: [120],
          allowedTimingFunctions: ["linear"],
        },
      },
      surfaces: [
        {
          id: surfaceId,
          displayName: "Demo Chrome Legacy",
          type: "web",
          requiredSections: ["main.hero"],
          allowedFonts: ["Inter"],
          layout: { maxContentWidth: 960 },
        },
      ],
      color: {
        policy: "off",
        allowedValues: [],
      },
    };

    const result = await collectSurfaceDescriptors({
      workspaceRoot: tempRoot,
      contract,
      surfaceFilters: new Set(),
      surfaceRootMap: new Map(),
    });

    assert.equal(result.errors.length, 0);
    const descriptor = result.descriptors[0];
    assert.ok(descriptor?.layout.chrome, "chrome descriptor should be extracted");
    assert.deepEqual(descriptor.layout.chrome.targets, [
      "layout-container",
      "top-level-section",
    ]);
    assert.equal(descriptor.layout.chrome.maxBorderRadiusPx, 6);
    assert.deepEqual(descriptor.layout.chrome.shadowKinds, ["inset", "outer"]);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("collectSurfaceDescriptors only uses top-level contract sections for chrome extraction", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "interfacectl-chrome-top-level-"));
  const surfaceId = "demo-chrome-top-level";
  const surfaceRoot = path.join(tempRoot, "apps", surfaceId);

  try {
    await mkdir(path.join(surfaceRoot, "app"), { recursive: true });

    await writeFile(
      path.join(surfaceRoot, "app", "layout.tsx"),
      `
        export default function RootLayout({ children }) {
          return <html><body>{children}</body></html>;
        }
      `,
      "utf-8",
    );

    await writeFile(
      path.join(surfaceRoot, "app", "page.tsx"),
      `
        export default function Page() {
          return (
            <section data-contract-section="landing.hero" style={{ borderRadius: "6px" }}>
              <div>
                <section data-contract-section="landing.guidance" style={{ boxShadow: chromeShadow }}>
                  Nested content
                </section>
              </div>
            </section>
          );
        }
      `,
      "utf-8",
    );

    const contract = {
      contractId: "test.contract",
      version: "1.0.0",
      sections: [
        { id: "landing.hero", intent: "Hero", description: "Hero section" },
        { id: "landing.guidance", intent: "Guidance", description: "Guidance section" },
      ],
      constraints: {
        motion: {
          allowedDurationsMs: [120],
          allowedTimingFunctions: ["linear"],
        },
      },
      surfaces: [
        {
          id: surfaceId,
          displayName: "Demo Chrome Top Level",
          type: "web",
          requiredSections: ["landing.hero", "landing.guidance"],
          allowedFonts: ["Inter"],
          layout: { maxContentWidth: 960 },
        },
      ],
      color: {
        policy: "off",
        allowedValues: [],
      },
    };

    const result = await collectSurfaceDescriptors({
      workspaceRoot: tempRoot,
      contract,
      surfaceFilters: new Set(),
      surfaceRootMap: new Map(),
    });

    assert.equal(result.errors.length, 0);
    assert.equal(
      result.warnings.some((warning) => warning.code === "chrome.shadow-undetermined"),
      false,
    );
    const descriptor = result.descriptors[0];
    assert.ok(descriptor?.layout.chrome, "chrome descriptor should be extracted");
    assert.deepEqual(descriptor.layout.chrome.targets, ["top-level-section"]);
    assert.equal(descriptor.layout.chrome.maxBorderRadiusPx, 6);
    assert.equal(descriptor.layout.chrome.hasAmbiguousSignals, undefined);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("collectSurfaceDescriptors captures landing pattern topology and background mode", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "interfacectl-landing-pattern-"));
  const surfaceId = "demo-landing";
  const surfaceRoot = path.join(tempRoot, "apps", surfaceId);

  try {
    await mkdir(path.join(surfaceRoot, "app", "(overview)"), { recursive: true });

    await writeFile(
      path.join(surfaceRoot, "app", "layout.tsx"),
      `
        export default function RootLayout({ children }) {
          return <html><body>{children}</body></html>;
        }
      `,
      "utf-8",
    );

    await writeFile(
      path.join(surfaceRoot, "app", "(overview)", "page.tsx"),
      `
        export default function Page() {
          return (
            <div className="min-h-screen w-full" style={{ background: "linear-gradient(#fff, #eee)" }}>
              <section data-contract-section="landing.hero">
                <h1>Hero</h1>
                <section data-contract-section="landing.guidance">
                  <p>Guidance</p>
                </section>
              </section>
              <section data-contract-section="landing.actions">
                <button>Action</button>
              </section>
            </div>
          );
        }
      `,
      "utf-8",
    );

    const contract = {
      contractId: "test.contract",
      version: "1.0.0",
      sections: [
        { id: "landing.hero", intent: "hero", description: "Hero section" },
        { id: "landing.guidance", intent: "guidance", description: "Guidance section" },
        { id: "landing.actions", intent: "actions", description: "Action section" },
      ],
      constraints: {
        motion: {
          allowedDurationsMs: [120],
          allowedTimingFunctions: ["linear"],
        },
      },
      surfaces: [
        {
          id: surfaceId,
          displayName: "Demo Landing",
          type: "web",
          requiredSections: ["landing.hero", "landing.guidance", "landing.actions"],
          allowedFonts: ["Inter"],
          layout: {
            maxContentWidth: 1120,
            landingPattern: {
              policy: "strict",
              requireTopLevelSections: ["landing.hero", "landing.guidance", "landing.actions"],
              sectionOrder: ["landing.hero", "landing.guidance", "landing.actions"],
              pageBackgroundMode: "solid",
            },
          },
        },
      ],
      color: {
        policy: "off",
        allowedValues: [],
      },
    };

    const result = await collectSurfaceDescriptors({
      workspaceRoot: tempRoot,
      contract,
      surfaceFilters: new Set(),
      surfaceRootMap: new Map(),
    });

    const descriptor = result.descriptors[0];
    assert.ok(descriptor?.layout.landingPattern, "landingPattern should be extracted");
    assert.deepEqual(descriptor.layout.landingPattern.sectionOrder, [
      "landing.hero",
      "landing.guidance",
      "landing.actions",
    ]);
    assert.deepEqual(descriptor.layout.landingPattern.topLevelSections, [
      "landing.hero",
      "landing.actions",
    ]);
    assert.deepEqual(descriptor.layout.landingPattern.nestedSections, ["landing.guidance"]);
    assert.equal(descriptor.layout.landingPattern.pageBackgroundMode, "custom");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
