import { test } from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import os from "node:os";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const cliPath = path.resolve(__dirname, "..", "dist", "index.js");
const fixtureDir = path.resolve(__dirname, "fixtures", "compile");
const contractPath = path.join(fixtureDir, "contract", "ui.contract.json");
const expectedDir = path.join(fixtureDir, "expected");

async function runCompile(inputPath, outDir, schemaPath = undefined, inputFlag = "--contract") {
  const args = [
    "compile",
    inputFlag,
    inputPath,
    "--out",
    outDir,
  ];
  if (schemaPath) {
    args.push("--schema", schemaPath);
  }
  const child = spawn("node", [cliPath, ...args], {
    env: process.env,
    cwd: path.dirname(inputPath),
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => { stdout += d.toString(); });
  child.stderr.on("data", (d) => { stderr += d.toString(); });

  const [exitCode] = await once(child, "exit");
  return {
    exitCode: Number(exitCode),
    stdout,
    stderr,
  };
}

async function readJson(p) {
  const raw = await readFile(p, "utf8");
  return JSON.parse(raw);
}

async function assertNoPath(targetPath) {
  await assert.rejects(stat(targetPath), /ENOENT/);
}

test("compile: structure - required files exist and no extra files", async () => {
  const outDir = await mkdtemp(path.join(os.tmpdir(), "interfacectl-compile-structure-"));
  try {
    const result = await runCompile(contractPath, outDir);
    assert.equal(result.exitCode, 0, `compile should exit 0: ${result.stderr}`);

    const manifest = await readJson(path.join(outDir, "manifest.json"));
    assert.equal(manifest.bundleVersion, "3.0");
    assert.equal(manifest.astId, "demo-ui");
    assert.equal(manifest.astVersion, "1.0.0");
    assert.equal(manifest.contractId, "demo-ui");
    assert.equal(manifest.contractVersion, "1.0.0");
    assert.equal(manifest.schemaVersion, "surfaces.ui.ast@2");
    assert.equal(manifest.sourceFormat, "ui-ast");
    assert.ok(Array.isArray(manifest.files));
    assert.ok(manifest.files.length >= 10);

    const paths = manifest.files.map((f) => f.path);
    assert.ok(paths.includes("ast/normalized.json"), "bundle must include ast/normalized.json");
    assert.ok(
      paths.includes("derived/contract.normalized.json"),
      "bundle must include derived/contract.normalized.json",
    );
    assert.ok(paths.includes("surfaces/demo-surface/ast.json"), "bundle must include ast.json");
    assert.ok(paths.includes("surfaces/demo-surface/lifecycle.json"), "bundle must include lifecycle.json");
    assert.ok(paths.includes("surfaces/demo-surface/proposal.json"), "bundle must include proposal.json");
    assert.ok(paths.includes("surfaces/demo-surface/integration.json"), "bundle must include integration.json");
    assert.ok(paths.includes("surfaces/demo-surface/generation.json"), "bundle must include generation.json");
    assert.ok(paths.includes("surfaces/demo-surface/sections.json"), "bundle must include sections.json");
    assert.ok(paths.includes("surfaces/demo-surface/components.json"), "bundle must include components.json");
    assert.ok(paths.includes("surfaces/demo-surface/constraints.json"), "bundle must include constraints.json");
    assert.ok(paths.includes("surfaces/demo-surface/platforms.json"), "bundle must include platforms.json");
    assert.ok(paths.includes("surfaces/demo-surface/repair-map.json"), "bundle must include repair-map.json");
    assert.ok(paths.includes("surfaces/demo-surface/runtime.json"), "bundle must include runtime.json");
    assert.ok(paths.includes("surfaces/demo-surface/observation.json"), "bundle must include observation.json");
    assert.ok(!paths.includes("contract/normalized.json"), "legacy contract path must not be canonical");
    assert.ok(!paths.includes("surfaces/demo-surface/authoring.json"), "authoring.json should be omitted when authoring is absent");

    for (const entry of manifest.files) {
      assert.ok(!entry.path.includes("manifest.json"), "files must not include manifest.json");
      assert.match(entry.sha256, /^[a-f0-9]{64}$/, `sha256 for ${entry.path} must be 64 hex chars`);
    }

    const sortedPaths = [...paths].sort();
    assert.deepEqual(paths, sortedPaths, "manifest.files must be sorted by path");

    const contractNorm = path.join(outDir, "derived", "contract.normalized.json");
    const contractStat = await stat(contractNorm);
    assert.ok(contractStat.isFile(), "derived/contract.normalized.json must be a file");

    const surfaceDir = path.join(outDir, "surfaces", "demo-surface");
    const surfaceDirStat = await stat(surfaceDir);
    assert.ok(surfaceDirStat.isDirectory(), "surface bundle directory must exist");
    const surfaceFiles = await readdir(surfaceDir);
    assert.deepEqual(
      surfaceFiles.sort(),
      [
        "ast.json",
        "components.json",
        "constraints.json",
        "generation.json",
        "integration.json",
        "lifecycle.json",
        "observation.json",
        "platforms.json",
        "proposal.json",
        "repair-map.json",
        "runtime.json",
        "sections.json",
      ],
      "surface bundle should only include the expected generation files for the base fixture",
    );
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("compile: determinism - two runs produce identical manifest.files", async () => {
  const out1 = await mkdtemp(path.join(os.tmpdir(), "interfacectl-compile-a-"));
  const out2 = await mkdtemp(path.join(os.tmpdir(), "interfacectl-compile-b-"));
  try {
    const r1 = await runCompile(contractPath, out1);
    const r2 = await runCompile(contractPath, out2);
    assert.equal(r1.exitCode, 0, `first run should exit 0: ${r1.stderr}`);
    assert.equal(r2.exitCode, 0, `second run should exit 0: ${r2.stderr}`);

    const manifest1 = await readJson(path.join(out1, "manifest.json"));
    const manifest2 = await readJson(path.join(out2, "manifest.json"));

    assert.deepEqual(
      manifest1.files,
      manifest2.files,
      "Two runs must produce identical manifest.files (paths and sha256)",
    );
  } finally {
    await rm(out1, { recursive: true, force: true });
    await rm(out2, { recursive: true, force: true });
  }
});

test("compile: golden - generated generation bundle files match expected", async () => {
  const outDir = await mkdtemp(path.join(os.tmpdir(), "interfacectl-compile-golden-"));
  try {
    const result = await runCompile(contractPath, outDir);
    assert.equal(result.exitCode, 0, `compile should exit 0: ${result.stderr}`);

    const expectedAst = await readJson(path.join(expectedDir, "ast", "normalized.json"));
    const generatedAst = await readJson(path.join(outDir, "ast", "normalized.json"));
    assert.deepEqual(generatedAst, expectedAst, "ast/normalized.json must match expected");

    const expectedContract = await readJson(path.join(expectedDir, "derived", "contract.normalized.json"));
    const generatedContract = await readJson(path.join(outDir, "derived", "contract.normalized.json"));
    assert.deepEqual(
      generatedContract,
      expectedContract,
      "derived/contract.normalized.json must match expected",
    );

    for (const filename of [
      "ast.json",
      "generation.json",
      "sections.json",
      "components.json",
      "constraints.json",
      "platforms.json",
      "repair-map.json",
      "runtime.json",
    ]) {
      const expected = await readJson(path.join(expectedDir, "surfaces", "demo-surface", filename));
      const generated = await readJson(path.join(outDir, "surfaces", "demo-surface", filename));
      assert.deepEqual(generated, expected, `${filename} must match expected`);
    }
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("compile: includes component catalog refs, authoring hints, and observation refs without inline evidence", async () => {
  const outDir = await mkdtemp(path.join(os.tmpdir(), "interfacectl-compile-rich-"));
  const richContractPath = path.join(outDir, "rich-contract.json");
  try {
    await writeFile(
      richContractPath,
      JSON.stringify(
        {
          contractId: "rich-demo",
          version: "1.0.0",
          shell: {
            owns: ["header", "footer"],
            contentSlot: "main-content",
          },
          surfaces: [
            {
              id: "demo-surface",
              displayName: "Demo Surface",
              type: "web",
              requiredSections: ["main.hero"],
              allowedFonts: ["Inter", "var(--font-body)"],
              owner: "designers@example.com",
              marketingTypographyProfile: "marketing-core",
              marketingTypographyPolicy: "warn",
              layout: {
                maxContentWidth: 960,
                requiredContainers: ["contract-container"],
                landingPattern: {
                  policy: "warn",
                  requireTopLevelSections: ["main.hero"],
                  sectionOrder: ["main.hero", "main.cta"],
                  pageBackgroundMode: "solid",
                  marketingLayoutProfile: "marketing-landing",
                  marketingLayoutPolicy: "warn",
                },
                targetAcquisition: {
                  policy: "warn",
                  modality: "touch-mouse",
                  minHitAreaPx: 44,
                  minGapPx: 8,
                  minEdgeInsetPx: 8,
                  destructiveGapPx: 16,
                  viewportOverrides: [
                    {
                      viewport: "mobile",
                      minHitAreaPx: 48,
                    },
                  ],
                  contextOverrides: [
                    {
                      context: "pricing-campaign",
                      destructiveGapPx: 24,
                    },
                  ],
                },
              },
              viewports: [
                {
                  id: "mobile",
                  maxWidthPx: 767,
                },
              ],
              governance: {
                status: "review",
                roles: {
                  designers: ["designers@example.com"],
                  engineers: ["eng@example.com"],
                  approvers: ["design-approver@example.com"],
                },
                approvals: [
                  {
                    role: "designer",
                    owner: "design-approver@example.com",
                    status: "approved",
                    timestamp: "2026-03-16T09:00:00Z",
                  },
                ],
              },
              runtime: {
                policy: "strict",
                feedbackRecovery: {
                  policy: "warn",
                  requiredStateKinds: ["loading", "empty", "error", "success"],
                },
                mutationEnvelope: {
                  mode: "slot-bound",
                  scopes: ["content", "components"],
                  allowedActions: ["update-copy", "swap-variant"],
                  allowedSections: ["main.hero", "main.cta"],
                },
                contexts: [
                  {
                    id: "pricing-campaign",
                    when: "route == '/pricing'",
                    policy: "warn",
                    requiredSections: ["main.cta"],
                    allowedLayoutIntents: ["columns"],
                  },
                  {
                    id: "loading",
                    when: "request == pending",
                    kind: "loading",
                    blockedActionsWhilePending: ["compact-primary"],
                  },
                  {
                    id: "empty",
                    when: "items.length == 0",
                    kind: "empty",
                  },
                  {
                    id: "error",
                    when: "request == failed",
                    kind: "error",
                    requiredRecoveryActions: ["retry"],
                    preserveSections: ["main.hero"],
                    preserveLastGoodContent: true,
                  },
                  {
                    id: "success",
                    when: "request == fulfilled",
                    kind: "success",
                  },
                ],
              },
              authoring: {
                framework: "next",
                routing: "app-router",
                styling: {
                  strategy: "css-modules",
                  tokenPrefix: "--demo",
                },
                preferredLibraries: {
                  components: ["@surfaces/ui"],
                  icons: ["lucide-react"],
                },
                sourcePriority: ["contract", "code"],
              },
            },
          ],
          sections: [
            {
              id: "main.hero",
              intent: "primary-intro",
              description: "Hero section",
              anatomy: {
                pattern: "hero",
                defaultComponent: "hero-banner",
                allowedComponents: ["hero-banner", "cta-group"],
                slots: [
                  {
                    id: "actions",
                    kind: "container",
                    required: true,
                    acceptsComponents: ["cta-group"],
                  },
                ],
              },
            },
            {
              id: "main.cta",
              intent: "conversion",
              description: "CTA section",
            },
          ],
          components: [
            {
              id: "hero-banner",
              intent: "hero",
              slots: [
                { id: "title", kind: "text", required: true },
              ],
              implementation: {
                preferredSource: "contract",
              },
            },
            {
              id: "cta-group",
              intent: "actions",
              slots: [
                { id: "primary", kind: "action", required: true },
              ],
              interactions: [
                {
                  id: "compact-primary",
                  trigger: "click compact primary",
                  effect: "navigate",
                  navigationTarget: "/pricing",
                  targetAcquisition: {
                    exceptionId: "cta-group.compact-primary",
                    rationale: "Toolbar-adjacent compact action.",
                    minHitAreaPx: 40,
                    classification: "primary",
                  },
                },
              ],
              references: [
                { system: "code", kind: "component", ref: "app/components/cta-group.tsx" },
              ],
            },
          ],
          constraints: {
            motion: {
              allowedDurationsMs: [120],
              allowedTimingFunctions: ["linear"],
            },
          },
          color: {
            policy: "warn",
            allowedValues: ["#ffffff", "#111111"],
          },
          marketingProfiles: {
            layout: [
              {
                id: "marketing-landing",
                heroContainerMode: "framed",
                heroVisualPlacement: "inline-end",
                sectionDividerMode: "border-top",
                sectionSpacingProfile: "roomy",
              },
            ],
            typography: [
              {
                id: "marketing-core",
                roles: [
                  {
                    role: "heroTitle",
                    allowedTokens: ["var(--font-body)"],
                  },
                ],
              },
            ],
          },
          x_extracted: {
            routes: ["/", "/pricing"],
            hasShell: true,
            designSystemComponents: ["HeroBanner", "CtaGroup"],
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = await runCompile(richContractPath, outDir);
    assert.equal(result.exitCode, 0, `compile should exit 0: ${result.stderr}`);

    const authoring = await readJson(path.join(outDir, "surfaces", "demo-surface", "authoring.json"));
    assert.equal(authoring.authoring.framework, "next");
    assert.deepEqual(authoring.authoring.sourcePriority, ["contract", "code"]);

    const components = await readJson(path.join(outDir, "surfaces", "demo-surface", "components.json"));
    assert.deepEqual(
      components.components.map((component) => component.id),
      ["hero-banner", "cta-group"],
    );

    const sections = await readJson(path.join(outDir, "surfaces", "demo-surface", "sections.json"));
    assert.equal(sections.sections[0].anatomy.defaultComponentId, "hero-banner");
    assert.deepEqual(sections.sections[0].anatomy.allowedComponentIds, ["hero-banner", "cta-group"]);
    assert.deepEqual(sections.sections[0].anatomy.slots[0].acceptsComponentIds, ["cta-group"]);

    const generation = await readJson(path.join(outDir, "surfaces", "demo-surface", "generation.json"));
    assert.equal(generation.refs.authoring, "./authoring.json");
    assert.equal(generation.refs.runtime, "./runtime.json");
    assert.deepEqual(generation.refs.evidence, [{ kind: "contract-field", path: "/x_extracted" }]);
    assert.equal("x_extracted" in generation, false, "generation payload must not inline x_extracted evidence");
    assert.equal("observations" in generation, false, "generation payload must not inline observation evidence");
    assert.equal(generation.governance.owner, "designers@example.com");
    assert.equal(generation.governance.status, "review");
    assert.equal(generation.adaptation.mutationEnvelope.mode, "slot-bound");
    assert.deepEqual(generation.adaptation.contextIds, [
      "pricing-campaign",
      "loading",
      "empty",
      "error",
      "success",
    ]);
    assert.deepEqual(generation.adaptation.feedbackRecovery.requiredStateKinds, [
      "loading",
      "empty",
      "error",
      "success",
    ]);
    assert.equal(generation.layout.targetAcquisition.minHitAreaPx, 44);
    assert.equal(generation.layout.targetAcquisition.viewportOverrides[0].minHitAreaPx, 48);

    const runtime = await readJson(path.join(outDir, "surfaces", "demo-surface", "runtime.json"));
    assert.equal(runtime.runtime.policy, "strict");
    assert.equal(runtime.governance.owner, "designers@example.com");
    assert.equal(runtime.runtime.policySeverities.runtime, "strict");
    assert.deepEqual(runtime.runtime.mutationEnvelope.allowedSections, ["main.hero", "main.cta"]);
    assert.deepEqual(runtime.runtime.structure.allowedComponents, ["hero-banner", "cta-group"]);
    assert.deepEqual(runtime.runtime.feedbackRecovery.requiredStateKinds, [
      "loading",
      "empty",
      "error",
      "success",
    ]);
    assert.equal(runtime.runtime.interaction.targetAcquisition.minGapPx, 8);
    assert.equal(runtime.runtime.interaction.targetAcquisition.contextOverrides[0].destructiveGapPx, 24);

    const repairMap = await readJson(path.join(outDir, "surfaces", "demo-surface", "repair-map.json"));
    assert.ok(
      repairMap.repairs.some((repair) => repair.action.type === "increase-hit-area"),
      "repair map should include hit-area guidance",
    );
    assert.ok(
      repairMap.repairs.some((repair) => repair.action.type === "separate-destructive-action"),
      "repair map should include destructive separation guidance",
    );
    assert.ok(
      repairMap.repairs.some((repair) => repair.action.type === "add-error-retry"),
      "repair map should include async error recovery guidance",
    );
    assert.ok(
      repairMap.repairs.some((repair) => repair.action.type === "disable-pending-submit"),
      "repair map should include pending-action guidance",
    );
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("compile: AST input preserves multi-platform projections in bundle output", async () => {
  const outDir = await mkdtemp(path.join(os.tmpdir(), "interfacectl-compile-ast-"));
  const astPath = path.join(outDir, "ui.surface.ast.json");
  try {
    await writeFile(
      astPath,
      JSON.stringify(
        {
          astId: "multi-platform-demo",
          version: "1.0.0",
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
          surfaces: [
            {
              id: "demo-surface",
              displayName: "Demo Surface",
              kind: "application",
              rootNodeId: "demo-surface.root",
              nodes: [
                {
                  id: "demo-surface.root",
                  kind: "group",
                  label: "Demo Surface",
                  children: ["main.hero"],
                },
                {
                  id: "main.hero",
                  kind: "section",
                  sectionId: "main.hero",
                  label: "Primary Intro",
                },
              ],
              platforms: [
                {
                  platform: "web",
                  allowedFonts: ["Demo Sans", "sans-serif"],
                  layout: {
                    maxContentWidth: 960,
                  },
                },
                {
                  platform: "ios",
                  path: "/demo",
                  layout: {
                    maxContentWidth: 960,
                  },
                },
              ],
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = await runCompile(astPath, outDir, undefined, "--ast");
    assert.equal(result.exitCode, 0, `compile should exit 0: ${result.stderr}`);

    const manifest = await readJson(path.join(outDir, "manifest.json"));
    assert.equal(manifest.bundleVersion, "3.0");

    const generation = await readJson(path.join(outDir, "surfaces", "demo-surface", "generation.json"));
    assert.deepEqual(generation.ast.platformIds, ["web", "ios"]);
    assert.equal(generation.refs.platforms, "./platforms.json");

    const platforms = await readJson(path.join(outDir, "surfaces", "demo-surface", "platforms.json"));
    assert.deepEqual(
      platforms.platforms.map((projection) => projection.platform),
      ["web", "ios"],
      "platform bundle must preserve both projections deterministically",
    );
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("compile: includes surface icons policy when present in contract", async () => {
  const outDir = await mkdtemp(path.join(os.tmpdir(), "interfacectl-compile-icons-"));
  const contractWithIconsPath = path.join(outDir, "contract-with-icons.json");
  try {
    await writeFile(
      contractWithIconsPath,
      JSON.stringify(
        {
          contractId: "demo-ui-icons",
          version: "1.0.0",
          surfaces: [
            {
              id: "demo-surface",
              displayName: "Demo Surface",
              type: "web",
              requiredSections: ["main.hero"],
              allowedFonts: ["Inter"],
              layout: { maxContentWidth: 960 },
              icons: {
                policy: "warn",
                allowedSources: ["lucide-react"],
              },
            },
          ],
          sections: [
            { id: "main.hero", intent: "Hero", description: "Main hero" },
          ],
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
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = await runCompile(contractWithIconsPath, outDir);
    assert.equal(result.exitCode, 0, `compile should exit 0: ${result.stderr}`);

    const generatedConstraints = await readJson(
      path.join(outDir, "surfaces", "demo-surface", "constraints.json"),
    );
    assert.deepEqual(generatedConstraints.constraints.icons, {
      policy: "warn",
      allowedSources: ["lucide-react"],
    });
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("compile: includes surface flow policy when present in contract", async () => {
  const outDir = await mkdtemp(path.join(os.tmpdir(), "interfacectl-compile-flows-"));
  const contractWithFlowsPath = path.join(outDir, "contract-with-flows.json");
  try {
    await writeFile(
      contractWithFlowsPath,
      JSON.stringify(
        {
          contractId: "demo-ui-flows",
          version: "1.0.0",
          surfaces: [
            {
              id: "demo-surface",
              displayName: "Demo Surface",
              type: "web",
              requiredSections: ["main.hero"],
              allowedFonts: ["Inter"],
              layout: { maxContentWidth: 960 },
              flows: {
                policy: "warn",
                requirements: [
                  {
                    flowId: "checkout",
                    minSteps: 2,
                    requiredSteps: ["start", "review"],
                    requiredTransitions: [{ from: "start", to: "review" }],
                    terminalSteps: ["review"],
                  },
                ],
              },
            },
          ],
          sections: [
            { id: "main.hero", intent: "Hero", description: "Main hero" },
          ],
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
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = await runCompile(contractWithFlowsPath, outDir);
    assert.equal(result.exitCode, 0, `compile should exit 0: ${result.stderr}`);

    const generation = await readJson(
      path.join(outDir, "surfaces", "demo-surface", "generation.json"),
    );
    assert.deepEqual(generation.structure.flowSummary, {
      policy: "warn",
      flowIds: ["checkout"],
      requirementCount: 1,
    });
    const repairMap = await readJson(
      path.join(outDir, "surfaces", "demo-surface", "repair-map.json"),
    );
    assert.ok(
      repairMap.repairs.some((repair) => repair.code === "flow.unobservable"),
      "repair map should include flow.unobservable guidance",
    );
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("compile: omits authoring.json when authoring metadata is absent", async () => {
  const outDir = await mkdtemp(path.join(os.tmpdir(), "interfacectl-compile-no-authoring-"));
  try {
    const result = await runCompile(contractPath, outDir);
    assert.equal(result.exitCode, 0, `compile should exit 0: ${result.stderr}`);
    await assertNoPath(path.join(outDir, "surfaces", "demo-surface", "authoring.json"));
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("compile: invalid contract fails with non-zero exit", async () => {
  const outDir = await mkdtemp(path.join(os.tmpdir(), "interfacectl-compile-fail-"));
  const invalidContract = path.join(outDir, "invalid.json");
  try {
    await writeFile(
      invalidContract,
      JSON.stringify({
        contractId: "bad",
        version: "1.0.0",
        surfaces: [],
        sections: [],
        constraints: {},
      }, null, 2),
      "utf8",
    );
    const result = await runCompile(invalidContract, outDir);
    assert.notEqual(result.exitCode, 0, "invalid contract must cause non-zero exit");
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("compile: missing required field (constraints) fails", async () => {
  const outDir = await mkdtemp(path.join(os.tmpdir(), "interfacectl-compile-fail2-"));
  const badContract = path.join(outDir, "bad.json");
  try {
    await writeFile(
      badContract,
      JSON.stringify({
        contractId: "bad",
        version: "1.0.0",
        surfaces: [{ id: "x", displayName: "X", type: "web", requiredSections: [], allowedFonts: [], layout: { maxContentWidth: 100 } }],
        sections: [],
      }, null, 2),
      "utf8",
    );
    const result = await runCompile(badContract, outDir);
    assert.notEqual(result.exitCode, 0, "contract missing required constraints must fail");
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});
