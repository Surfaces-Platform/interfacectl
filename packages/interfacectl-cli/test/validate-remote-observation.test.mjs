import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  mkdtemp,
  mkdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliExecutable = path.resolve(__dirname, "..", "dist", "index.js");

let chromiumAvailability;

async function ensureChromiumAvailable(t) {
  if (chromiumAvailability === undefined) {
    chromiumAvailability = await new Promise((resolve) => {
      const child = spawn(
        "node",
        [
          "-e",
          "import('playwright').then(async ({ chromium }) => { const browser = await chromium.launch({ headless: true }); await browser.close(); }).then(() => process.exit(0)).catch(() => process.exit(1));",
        ],
        {
          cwd: path.resolve(__dirname, ".."),
          env: process.env,
        },
      );
      child.on("exit", (code) => resolve(code === 0));
    });
  }

  if (!chromiumAvailability) {
    t.skip("Playwright Chromium is not installed.");
  }
}

async function withServer(handler, callback) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    return await callback(origin);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function runValidate(workspaceRoot, contractPath, remoteUrl) {
  const child = spawn(
    "node",
    [
      cliExecutable,
      "validate",
      "--contract",
      contractPath,
      "--workspace-root",
      workspaceRoot,
      "--surface",
      "test-surface",
      "--remote-url",
      remoteUrl,
      "--format",
      "json",
      "--exit-codes",
      "v2",
    ],
    {
      cwd: workspaceRoot,
      env: {
        ...process.env,
        INTERFACECTL_PLAYWRIGHT_HEADLESS: "1",
      },
    },
  );

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const [exitCode] = await once(child, "exit");
  return {
    exitCode: Number(exitCode),
    stdout,
    stderr,
  };
}

async function createWorkspace(options = {}) {
  const {
    targetAcquisition = true,
    feedbackRecovery = false,
    flows = false,
  } = options;
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "interfacectl-validate-remote-"));
  const surfaceId = "test-surface";
  const appDir = path.join(tempRoot, "apps", surfaceId, "app");
  const contractPath = path.join(tempRoot, "contract.json");

  await mkdir(appDir, { recursive: true });

  await writeFile(
    path.join(tempRoot, "interfacectl.config.json"),
    JSON.stringify(
      {
        surfaceRoots: {
          [surfaceId]: `apps/${surfaceId}`,
        },
      },
      null,
      2,
    ),
    "utf-8",
  );

  await writeFile(
    path.join(appDir, "layout.tsx"),
    `
      import "./globals.css";
      export default function Layout({ children }) {
        return <html><body>{children}</body></html>;
      }
    `,
    "utf-8",
  );

  await writeFile(
    path.join(appDir, "page.tsx"),
    `
      export default function Page() {
        return (
          <main data-contract="page-container" data-contract-container="page-container">
            <section data-contract-section="main.hero">
              <h1>Remote validate test</h1>
            </section>
          </main>
        );
      }
    `,
    "utf-8",
  );

  await writeFile(
    path.join(appDir, "globals.css"),
    `
      :root {
        --font-inter: "Inter", sans-serif;
        --color-primary: #0f172a;
        --contract-max-width: 960px;
      }
      body {
        font-family: var(--font-inter), Inter, sans-serif;
        color: var(--color-primary);
        background: #ffffff;
      }
      main {
        max-width: var(--contract-max-width);
      }
      .surfaceTarget {
        transition: border-color 120ms linear;
      }
    `,
    "utf-8",
  );

  const surface = {
    id: surfaceId,
    displayName: "Remote Observation Surface",
    type: "web",
    requiredSections: ["main.hero"],
    allowedFonts: ["Inter", "sans-serif", "var(--font-inter)"],
    layout: {
      maxContentWidth: 960,
      ...(targetAcquisition
        ? {
            targetAcquisition: {
              policy: "warn",
              modality: "touch-mouse",
              minHitAreaPx: 44,
              minGapPx: 8,
              minEdgeInsetPx: 8,
              destructiveGapPx: 16,
            },
          }
        : {}),
    },
    ...(feedbackRecovery
      ? {
          runtime: {
            feedbackRecovery: {
              policy: "warn",
              requiredStateKinds: ["loading", "empty", "error", "success"],
            },
            contexts: [
              {
                id: "loading",
                when: "request == pending",
                kind: "loading",
                blockedActionsWhilePending: ["submit-refresh"],
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
        }
      : {}),
    ...(flows
      ? {
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
        }
      : {}),
  };

  await writeFile(
    contractPath,
    JSON.stringify(
      {
        contractId: "remote-observation-test",
        version: "1.0.0",
        surfaces: [surface],
        sections: [
          {
            id: "main.hero",
            intent: "hero",
            description: "Main hero section",
          },
        ],
        components: feedbackRecovery
          ? [
              {
                id: "dashboard-actions",
                intent: "actions",
                slots: [{ id: "actions", kind: "action", required: true }],
                interactions: [
                  {
                    id: "submit-refresh",
                    trigger: "click refresh",
                    effect: "submit",
                  },
                  {
                    id: "retry-dashboard",
                    trigger: "click retry dashboard",
                    effect: "set-state",
                  },
                ],
              },
            ]
          : undefined,
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
    "utf-8",
  );

  return { tempRoot, contractPath };
}

function buildFixtureHtml(content) {
  return `
    <!doctype html>
    <html>
      <head>
        <style>
          body {
            margin: 0;
            font-family: Inter, sans-serif;
          }
          main {
            position: relative;
            min-height: 260px;
          }
          .surfaceTarget {
            position: absolute;
            top: 24px;
            box-sizing: border-box;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            border: 1px solid #cbd5e1;
            background: white;
            color: #0f172a;
            text-decoration: none;
          }
          button.surfaceTarget {
            font: inherit;
            cursor: pointer;
          }
        </style>
      </head>
      <body>
        <main>${content}</main>
      </body>
    </html>
  `;
}

function normalizeFindingCodes(payload) {
  return Array.isArray(payload?.findings)
    ? payload.findings
        .map((entry) => String(entry?.code ?? "").trim())
        .filter(Boolean)
    : [];
}

async function assertRemoteObservationWarning(t, fixtureHtml, expectedCode, expectedFound) {
  await ensureChromiumAvailable(t);
  const { tempRoot, contractPath } = await createWorkspace();

  try {
    await withServer((request, response) => {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(fixtureHtml);
    }, async (origin) => {
      const result = await runValidate(tempRoot, contractPath, origin);
      assert.equal(result.exitCode, 0, result.stderr);

      const payload = JSON.parse(result.stdout);
      const finding = payload.findings.find((entry) => entry.code === expectedCode);
      assert.ok(finding, `missing ${expectedCode} finding: ${result.stdout}`);
      assert.equal(finding.severity, "warning");
      assert.equal(finding.category, "E2");
      assert.equal(finding.location, origin + "/");
      assert.deepEqual(finding.found, expectedFound);
      assert.equal(
        payload.findings.some((entry) => entry.code === "target.unobservable"),
        false,
        `unexpected target.unobservable finding: ${result.stdout}`,
      );
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function assertRemoteObservationPass(t, fixtureHtml) {
  await ensureChromiumAvailable(t);
  const { tempRoot, contractPath } = await createWorkspace();

  try {
    await withServer((request, response) => {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(fixtureHtml);
    }, async (origin) => {
      const result = await runValidate(tempRoot, contractPath, origin);
      assert.equal(result.exitCode, 0, result.stderr);

      const payload = JSON.parse(result.stdout);
      assert.equal(normalizeFindingCodes(payload).length, 0, result.stdout);
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function assertRemoteObservationUnobservable(t, fixtureHtml) {
  await ensureChromiumAvailable(t);
  const { tempRoot, contractPath } = await createWorkspace();

  try {
    await withServer((request, response) => {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(fixtureHtml);
    }, async (origin) => {
      const result = await runValidate(tempRoot, contractPath, origin);
      assert.equal(result.exitCode, 0, result.stderr);

      const payload = JSON.parse(result.stdout);
      assert.deepEqual([...new Set(normalizeFindingCodes(payload))], ["target.unobservable"]);
      const finding = payload.findings.find((entry) => entry.code === "target.unobservable");
      assert.ok(finding, `missing target.unobservable finding: ${result.stdout}`);
      assert.equal(finding.severity, "warning");
      assert.equal(finding.category, "E2");
      assert.equal(finding.location, origin + "/");
      assert.deepEqual(finding.expected, ["contractScopedInteractiveTargets"]);
      assert.deepEqual(finding.found, ["contractScopedInteractiveTargets"]);
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function assertRemoteFeedbackPass(t, fixtureHtml) {
  await ensureChromiumAvailable(t);
  const { tempRoot, contractPath } = await createWorkspace({
    targetAcquisition: false,
    feedbackRecovery: true,
  });

  try {
    await withServer((request, response) => {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(fixtureHtml);
    }, async (origin) => {
      const result = await runValidate(tempRoot, contractPath, origin);
      assert.equal(result.exitCode, 0, result.stderr);

      const payload = JSON.parse(result.stdout);
      assert.equal(normalizeFindingCodes(payload).length, 0, result.stdout);
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function assertRemoteFeedbackWarning(t, fixtureHtml, expectedCode, expectedFound) {
  await ensureChromiumAvailable(t);
  const { tempRoot, contractPath } = await createWorkspace({
    targetAcquisition: false,
    feedbackRecovery: true,
  });

  try {
    await withServer((request, response) => {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(fixtureHtml);
    }, async (origin) => {
      const result = await runValidate(tempRoot, contractPath, origin);
      assert.equal(result.exitCode, 0, result.stderr);

      const payload = JSON.parse(result.stdout);
      const finding = payload.findings.find((entry) => entry.code === expectedCode);
      assert.ok(finding, `missing ${expectedCode} finding: ${result.stdout}`);
      assert.equal(finding.severity, "warning");
      assert.equal(finding.category, "E2");
      assert.equal(finding.location, origin + "/");
      assert.deepEqual(finding.found, expectedFound);
      assert.equal(
        payload.findings.some((entry) => entry.code === "feedback.unobservable"),
        false,
        `unexpected feedback.unobservable finding: ${result.stdout}`,
      );
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function assertRemoteFeedbackUnobservable(t, fixtureHtml) {
  await ensureChromiumAvailable(t);
  const { tempRoot, contractPath } = await createWorkspace({
    targetAcquisition: false,
    feedbackRecovery: true,
  });

  try {
    await withServer((request, response) => {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(fixtureHtml);
    }, async (origin) => {
      const result = await runValidate(tempRoot, contractPath, origin);
      assert.equal(result.exitCode, 0, result.stderr);

      const payload = JSON.parse(result.stdout);
      assert.deepEqual([...new Set(normalizeFindingCodes(payload))], ["feedback.unobservable"]);
      const finding = payload.findings.find((entry) => entry.code === "feedback.unobservable");
      assert.ok(finding, `missing feedback.unobservable finding: ${result.stdout}`);
      assert.equal(finding.severity, "warning");
      assert.equal(finding.category, "E2");
      assert.equal(finding.location, origin + "/");
      assert.deepEqual(finding.expected, ["contractScopedAsyncStates"]);
      assert.deepEqual(finding.found, ["contractScopedAsyncStates"]);
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function assertRemoteFlowPass(t, fixtureHtml) {
  await ensureChromiumAvailable(t);
  const { tempRoot, contractPath } = await createWorkspace({
    targetAcquisition: false,
    feedbackRecovery: false,
    flows: true,
  });

  try {
    await withServer((request, response) => {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(fixtureHtml);
    }, async (origin) => {
      const result = await runValidate(tempRoot, contractPath, origin);
      assert.equal(result.exitCode, 0, result.stderr);

      const payload = JSON.parse(result.stdout);
      assert.equal(normalizeFindingCodes(payload).length, 0, result.stdout);
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function assertRemoteFlowWarning(t, fixtureHtml, expectedCode, expectedFound) {
  await ensureChromiumAvailable(t);
  const { tempRoot, contractPath } = await createWorkspace({
    targetAcquisition: false,
    feedbackRecovery: false,
    flows: true,
  });

  try {
    await withServer((request, response) => {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(fixtureHtml);
    }, async (origin) => {
      const result = await runValidate(tempRoot, contractPath, origin);
      assert.equal(result.exitCode, 0, result.stderr);

      const payload = JSON.parse(result.stdout);
      const finding = payload.findings.find((entry) => entry.code === expectedCode);
      assert.ok(finding, `missing ${expectedCode} finding: ${result.stdout}`);
      assert.equal(finding.severity, "warning");
      assert.equal(finding.category, "E2");
      assert.equal(finding.location, origin + "/");
      assert.deepEqual(finding.found, expectedFound);
      assert.equal(
        payload.findings.some((entry) => entry.code === "flow.unobservable"),
        false,
        `unexpected flow.unobservable finding: ${result.stdout}`,
      );
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function assertRemoteFlowUnobservable(t, fixtureHtml) {
  await ensureChromiumAvailable(t);
  const { tempRoot, contractPath } = await createWorkspace({
    targetAcquisition: false,
    feedbackRecovery: false,
    flows: true,
  });

  try {
    await withServer((request, response) => {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(fixtureHtml);
    }, async (origin) => {
      const result = await runValidate(tempRoot, contractPath, origin);
      assert.equal(result.exitCode, 0, result.stderr);

      const payload = JSON.parse(result.stdout);
      assert.deepEqual([...new Set(normalizeFindingCodes(payload))], ["flow.unobservable"]);
      const finding = payload.findings.find((entry) => entry.code === "flow.unobservable");
      assert.ok(finding, `missing flow.unobservable finding: ${result.stdout}`);
      assert.equal(finding.severity, "warning");
      assert.equal(finding.category, "E2");
      assert.equal(finding.location, origin + "/");
      assert.deepEqual(finding.expected, ["contractScopedFlows"]);
      assert.deepEqual(finding.found, ["contractScopedFlows"]);
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

test("validate: --remote-url reports target.hit-area-too-small from browser-observed controls", async (t) => {
  await assertRemoteObservationWarning(
    t,
    buildFixtureHtml(`
      <a
        class="surfaceTarget"
        style="left: 24px; width: 36px; height: 36px;"
        href="#small"
        data-contract-target="cta.small"
      >
        S
      </a>
      <a
        class="surfaceTarget"
        style="left: 120px; width: 48px; height: 48px;"
        href="#safe"
        data-contract-target="cta.safe"
      >
        Safe
      </a>
    `),
    "target.hit-area-too-small",
    {
      width: 36,
      height: 36,
      targetId: "cta.small",
    },
  );
});

test("validate: --remote-url reports target.gap-too-tight from browser-observed controls", async (t) => {
  await assertRemoteObservationWarning(
    t,
    buildFixtureHtml(`
      <a
        class="surfaceTarget"
        style="left: 24px; width: 48px; height: 48px;"
        href="#tight-a"
        data-contract-target="cta.tight-a"
      >
        A
      </a>
      <a
        class="surfaceTarget"
        style="left: 76px; width: 48px; height: 48px;"
        href="#tight-b"
        data-contract-target="cta.tight-b"
      >
        B
      </a>
    `),
    "target.gap-too-tight",
    {
      nearestNeighborGapPx: 4,
      targetId: "cta.tight-a",
    },
  );
});

test("validate: --remote-url reports target.edge-inset-too-small from browser-observed controls", async (t) => {
  await assertRemoteObservationWarning(
    t,
    buildFixtureHtml(`
      <a
        class="surfaceTarget"
        style="left: 24px; width: 48px; height: 48px;"
        href="#safe"
        data-contract-target="cta.safe"
      >
        Safe
      </a>
      <a
        class="surfaceTarget"
        style="position: fixed; right: 0; top: 120px; width: 48px; height: 48px;"
        href="#edge"
        data-contract-target="cta.edge-pinned"
      >
        Edge
      </a>
    `),
    "target.edge-inset-too-small",
    {
      edgeInsetPx: 0,
      targetId: "cta.edge-pinned",
    },
  );
});

test("validate: --remote-url passes a singleton contract-scoped target when hit area and edge inset are measurable", async (t) => {
  await assertRemoteObservationPass(
    t,
    buildFixtureHtml(`
      <a
        class="surfaceTarget"
        style="left: 24px; width: 48px; height: 48px;"
        href="#solo"
        data-contract-target="cta.solo"
      >
        Solo
      </a>
    `),
  );
});

test("validate: --remote-url reports target.unobservable when only fallback all-visible controls are observed", async (t) => {
  await assertRemoteObservationUnobservable(
    t,
    buildFixtureHtml(`
      <a
        class="surfaceTarget"
        style="left: 24px; width: 48px; height: 48px;"
        href="#fallback-a"
      >
        A
      </a>
      <button
        class="surfaceTarget"
        style="left: 96px; width: 48px; height: 48px;"
        type="button"
      >
        B
      </button>
    `),
  );
});

test("validate: --remote-url reports target.destructive-too-close from browser-observed controls", async (t) => {
  await assertRemoteObservationWarning(
    t,
    buildFixtureHtml(`
      <button
        class="surfaceTarget"
        style="left: 24px; width: 48px; height: 48px;"
        type="button"
        data-contract-target="cta.safe-primary"
      >
        Keep
      </button>
      <button
        class="surfaceTarget"
        style="left: 84px; width: 48px; height: 48px;"
        type="button"
        data-contract-target="cta.destroy"
        data-contract-action-risk="destructive"
      >
        Delete
      </button>
    `),
    "target.destructive-too-close",
    {
      nearestNeighborGapPx: 12,
      targetId: "cta.destroy",
      nearestNeighborClassification: "default",
    },
  );
});

test("validate: --remote-url passes a contract-scoped success async state", async (t) => {
  await assertRemoteFeedbackPass(
    t,
    buildFixtureHtml(`
      <section
        data-contract-state-id="success"
        data-contract-state-kind="success"
        data-contract-section="main.hero"
        style="display: block; min-height: 72px;"
      >
        <h1>Dashboard ready</h1>
      </section>
    `),
  );
});

test("validate: --remote-url passes a contract-scoped loading async state with blocked actions", async (t) => {
  await assertRemoteFeedbackPass(
    t,
    buildFixtureHtml(`
      <section
        data-contract-state-id="loading"
        data-contract-state-kind="loading"
        data-contract-section="main.hero"
        style="display: block; min-height: 72px;"
      >
        <p>Loading dashboard…</p>
        <button
          class="surfaceTarget"
          style="left: 24px; width: 48px; height: 48px;"
          type="button"
          data-contract-state-id="loading"
          data-contract-interaction="submit-refresh"
          disabled
        >
          Refreshing
        </button>
      </section>
    `),
  );
});

test("validate: --remote-url passes a contract-scoped empty async state", async (t) => {
  await assertRemoteFeedbackPass(
    t,
    buildFixtureHtml(`
      <section
        data-contract-state-id="empty"
        data-contract-state-kind="empty"
        data-contract-section="main.hero"
        style="display: block; min-height: 72px;"
      >
        <p>No results remain.</p>
      </section>
    `),
  );
});

test("validate: --remote-url passes a contract-scoped error async state with recovery affordances", async (t) => {
  await assertRemoteFeedbackPass(
    t,
    buildFixtureHtml(`
      <section
        data-contract-state-id="error"
        data-contract-state-kind="error"
        data-contract-section="main.hero"
        data-contract-preserve-last-good="true"
        style="display: block; min-height: 72px;"
      >
        <p>Request failed.</p>
        <button
          class="surfaceTarget"
          style="left: 24px; width: 48px; height: 48px;"
          type="button"
          data-contract-state-id="error"
          data-contract-recovery-action="retry"
        >
          Retry
        </button>
      </section>
    `),
  );
});

test("validate: --remote-url reports feedback.recovery-action-missing from browser-observed async states", async (t) => {
  await assertRemoteFeedbackWarning(
    t,
    buildFixtureHtml(`
      <section
        data-contract-state-id="error"
        data-contract-state-kind="error"
        data-contract-section="main.hero"
        data-contract-preserve-last-good="true"
        style="display: block; min-height: 72px;"
      >
        <p>Request failed.</p>
      </section>
    `),
    "feedback.recovery-action-missing",
    ["retry"],
  );
});

test("validate: --remote-url reports feedback.pending-action-not-blocked from browser-observed async states", async (t) => {
  await assertRemoteFeedbackWarning(
    t,
    buildFixtureHtml(`
      <section
        data-contract-state-id="loading"
        data-contract-state-kind="loading"
        data-contract-section="main.hero"
        style="display: block; min-height: 72px;"
      >
        <p>Loading dashboard…</p>
        <button
          class="surfaceTarget"
          style="left: 24px; width: 48px; height: 48px;"
          type="button"
          data-contract-state-id="loading"
          data-contract-interaction="submit-refresh"
        >
          Refreshing
        </button>
      </section>
    `),
    "feedback.pending-action-not-blocked",
    ["submit-refresh"],
  );
});

test("validate: --remote-url reports feedback.last-good-content-missing from browser-observed async states", async (t) => {
  await assertRemoteFeedbackWarning(
    t,
    buildFixtureHtml(`
      <section
        data-contract-state-id="error"
        data-contract-state-kind="error"
        data-contract-section="main.hero"
        style="display: block; min-height: 72px;"
      >
        <p>Request failed.</p>
        <button
          class="surfaceTarget"
          style="left: 24px; width: 48px; height: 48px;"
          type="button"
          data-contract-state-id="error"
          data-contract-recovery-action="retry"
        >
          Retry
        </button>
      </section>
    `),
    "feedback.last-good-content-missing",
    {
      preserveLastGoodContent: false,
      missingPreserveSections: [],
    },
  );
});

test("validate: --remote-url reports feedback.unobservable when no contract-scoped async states are observed", async (t) => {
  await assertRemoteFeedbackUnobservable(
    t,
    buildFixtureHtml(`
      <div>
        <button
          class="surfaceTarget"
          style="left: 24px; width: 48px; height: 48px;"
          type="button"
        >
          Visible fallback action
        </button>
      </div>
    `),
  );
});

test("validate: --remote-url passes when browser-observed flow markers satisfy the flow policy", async (t) => {
  await assertRemoteFlowPass(
    t,
    buildFixtureHtml(`
      <div data-contract-flow-id="workspace-delete">
        <section data-contract-flow-step="request" style="display: block; min-height: 72px;">
          <button
            class="surfaceTarget"
            style="left: 24px; width: 48px; height: 48px;"
            type="button"
            data-contract-flow-transition-to="review"
          >
            Review delete
          </button>
        </section>
        <section data-contract-flow-step="review" style="display: block; min-height: 72px;">
          <button
            class="surfaceTarget"
            style="left: 96px; width: 48px; height: 48px;"
            type="button"
            data-contract-flow-transition-to="confirm"
          >
            Continue to confirm
          </button>
        </section>
        <section
          data-contract-flow-step="confirm"
          data-contract-flow-terminal="true"
          style="display: block; min-height: 72px;"
        >
          <p>Confirm deletion</p>
        </section>
      </div>
    `),
  );
});

test("validate: --remote-url reports flow.steps.required from browser-observed flow markers", async (t) => {
  await assertRemoteFlowWarning(
    t,
    buildFixtureHtml(`
      <div data-contract-flow-id="workspace-delete">
        <section data-contract-flow-step="request" style="display: block; min-height: 72px;">
          <button
            class="surfaceTarget"
            style="left: 24px; width: 48px; height: 48px;"
            type="button"
            data-contract-flow-transition-to="review"
          >
            Review delete
          </button>
        </section>
        <section style="display: block; min-height: 72px;">
          <p>Review copy without flow markers.</p>
        </section>
        <section
          data-contract-flow-step="confirm"
          data-contract-flow-terminal="true"
          style="display: block; min-height: 72px;"
        >
          <p>Confirm deletion</p>
        </section>
      </div>
    `),
    "flow.steps.required",
    ["review"],
  );
});

test("validate: --remote-url reports flow.transition.required from browser-observed flow markers", async (t) => {
  await assertRemoteFlowWarning(
    t,
    buildFixtureHtml(`
      <div data-contract-flow-id="workspace-delete">
        <section data-contract-flow-step="request" style="display: block; min-height: 72px;">
          <button
            class="surfaceTarget"
            style="left: 24px; width: 48px; height: 48px;"
            type="button"
            data-contract-flow-transition-to="review"
          >
            Review delete
          </button>
        </section>
        <section data-contract-flow-step="review" style="display: block; min-height: 72px;">
          <p>Review without confirm transition.</p>
        </section>
        <section
          data-contract-flow-step="confirm"
          data-contract-flow-terminal="true"
          style="display: block; min-height: 72px;"
        >
          <p>Confirm deletion</p>
        </section>
      </div>
    `),
    "flow.transition.required",
    [{ from: "review", to: "confirm" }],
  );
});

test("validate: --remote-url reports flow.terminal.invalid from browser-observed flow markers", async (t) => {
  await assertRemoteFlowWarning(
    t,
    buildFixtureHtml(`
      <div data-contract-flow-id="workspace-delete">
        <section data-contract-flow-step="request" style="display: block; min-height: 72px;">
          <button
            class="surfaceTarget"
            style="left: 24px; width: 48px; height: 48px;"
            type="button"
            data-contract-flow-transition-to="review"
          >
            Review delete
          </button>
        </section>
        <section data-contract-flow-step="review" style="display: block; min-height: 72px;">
          <button
            class="surfaceTarget"
            style="left: 96px; width: 48px; height: 48px;"
            type="button"
            data-contract-flow-transition-to="confirm"
          >
            Continue to confirm
          </button>
        </section>
        <section
          data-contract-flow-step="confirm"
          data-contract-flow-terminal="true"
          style="display: block; min-height: 72px;"
        >
          <button
            class="surfaceTarget"
            style="left: 168px; width: 48px; height: 48px;"
            type="button"
            data-contract-flow-transition-to="request"
          >
            Go back
          </button>
        </section>
      </div>
    `),
    "flow.terminal.invalid",
    [{ from: "confirm", to: "request" }],
  );
});

test("validate: --remote-url reports flow.unobservable when no contract-scoped flow markers are observed", async (t) => {
  await assertRemoteFlowUnobservable(
    t,
    buildFixtureHtml(`
      <div>
        <section style="display: block; min-height: 72px;">
          <p>Visible staged content without flow markers.</p>
        </section>
      </div>
    `),
  );
});
