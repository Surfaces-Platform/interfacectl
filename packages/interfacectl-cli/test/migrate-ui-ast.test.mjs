import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const cliPath = path.resolve(__dirname, "..", "dist", "index.js");

async function runCli(args, cwd = __dirname) {
  const child = spawn("node", [cliPath, ...args], {
    cwd,
    env: process.env,
  });

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

test("migrate-ui-ast imports legacy contracts into AST drafts and emits deterministic escalations", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "interfacectl-migrate-ui-ast-"));
  const contractPath = path.join(tempDir, "contract.json");
  const astPath = path.join(tempDir, "contracts", "ui.surface.ast.json");

  try {
    await writeFile(
      contractPath,
      `${JSON.stringify(
        {
          contractId: "migrate-demo",
          version: "1.0.0",
          surfaces: [
            {
              id: "demo-surface",
              displayName: "Demo Surface",
              type: "web",
              requiredSections: ["main.hero", "main.cta"],
              allowedFonts: ["Demo Sans", "sans-serif"],
              layout: {
                maxContentWidth: 960,
                landingPattern: {
                  policy: "warn",
                  sectionOrder: ["main.hero", "main.cta"],
                  pageBackgroundMode: "solid",
                },
              },
              governance: {
                status: "review",
                roles: {
                  designers: ["designers@example.com"],
                  engineers: ["eng@example.com"],
                },
              },
            },
          ],
          sections: [
            {
              id: "main.hero",
              intent: "primary-intro",
              description: "Hero section",
            },
            {
              id: "main.cta",
              intent: "conversion",
              description: "Call to action",
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
            allowedValues: ["#ffffff"],
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const result = await runCli(
      [
        "migrate-ui-ast",
        "--contract",
        contractPath,
        "--out",
        astPath,
        "--format",
        "json",
      ],
      tempDir,
    );

    assert.equal(result.exitCode, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    const ast = JSON.parse(await readFile(astPath, "utf8"));

    assert.equal(payload.status, "ok");
    assert.equal(payload.sourceKind, "legacy-contract");
    assert.equal(payload.astId, "migrate-demo");
    assert.deepEqual(payload.surfaceIds, ["demo-surface"]);
    assert.ok(
      payload.warnings.some((warning) => warning.includes("--contract is deprecated")),
      "migration should surface the legacy contract deprecation warning",
    );
    assert.ok(
      payload.escalations.some((entry) => entry.code === "marketing.out-of-scope"),
      "migration should flag landing-pattern metadata as an escalation",
    );

    assert.equal(ast.astId, "migrate-demo");
    assert.equal(ast.surfaces[0].rootNodeId, "demo-surface.root");
    assert.deepEqual(
      ast.surfaces[0].nodes.map((node) => node.id),
      ["demo-surface.root", "main.hero", "main.cta"],
    );
    assert.equal(ast.surfaces[0].platforms[0].platform, "web");
    assert.equal(ast.color.policy, "warn");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
