import { test } from "node:test";
import assert from "node:assert";
import { spawn } from "node:child_process";
import path from "node:path";
import url from "node:url";

const __dirname = url.fileURLToPath(new URL(".", import.meta.url));
const fixturesDir = path.join(__dirname, "fixtures", "pageframe-static");
const contractPath = path.join(fixturesDir, "contract.json");
const minWidthContractPath = path.join(fixturesDir, "contract.minwidth.json");
const unsupportedSelectorContractPath = path.join(
  fixturesDir,
  "contract.unsupported-selector.json",
);

async function runValidate(fixtureName, selectedContractPath = contractPath) {
  const fixtureRoot = path.join(fixturesDir, fixtureName);
  return new Promise((resolve, reject) => {
    const proc = spawn(
      "node",
      [
        path.join(__dirname, "..", "dist", "index.js"),
        "validate",
        "--contract",
        selectedContractPath,
        "--root",
        fixtureRoot,
        "--format",
        "json",
      ],
      {
        cwd: path.join(__dirname, ".."),
      },
    );

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });

    proc.on("error", (error) => {
      reject(error);
    });
  });
}

test("pageFrame validation - inline styles (passing)", async () => {
  const result = await runValidate("inline-styles");
  const output = JSON.parse(result.stdout);
  
  // Should pass - no pageFrame violations
  const pageFrameViolations = output.findings.filter((f) =>
    f.code.startsWith("layout.pageframe."),
  );
  assert.strictEqual(pageFrameViolations.length, 0, "Should have no pageFrame violations");
  assert.strictEqual(result.code, 0, "Should exit with code 0");
});

test("pageFrame validation - CSS rule (passing)", async () => {
  const result = await runValidate("css-rule");
  const output = JSON.parse(result.stdout);
  
  const pageFrameViolations = output.findings.filter((f) =>
    f.code.startsWith("layout.pageframe."),
  );
  assert.strictEqual(pageFrameViolations.length, 0, "Should have no pageFrame violations");
  assert.strictEqual(result.code, 0, "Should exit with code 0");
});

test("pageFrame validation - Tailwind classes (passing)", async () => {
  const result = await runValidate("tailwind");
  const output = JSON.parse(result.stdout);
  
  const pageFrameViolations = output.findings.filter((f) =>
    f.code.startsWith("layout.pageframe."),
  );
  assert.strictEqual(pageFrameViolations.length, 0, "Should have no pageFrame violations");
  assert.strictEqual(result.code, 0, "Should exit with code 0");
});

test("pageFrame validation - clamp() padding (non-deterministic)", async () => {
  const result = await runValidate("clamp-padding");
  const output = JSON.parse(result.stdout);
  
  const pageFrameViolations = output.findings.filter((f) =>
    f.code.startsWith("layout.pageframe."),
  );
  
  // Should have non-deterministic-value violation for padding (not unextractable-value)
  const paddingViolation = pageFrameViolations.find(
    (v) => v.code === "layout.pageframe.non-deterministic-value",
  );
  assert.ok(paddingViolation, "Should have non-deterministic-value violation for padding");
  // Check that the violation details include the property
  assert.ok(paddingViolation.expected !== undefined, "Violation should have expected value");
  assert.strictEqual(result.code, 1, "Should exit with code 1 (strict mode)");
});

test("pageFrame validation - missing marker (container not found)", async () => {
  const result = await runValidate("missing-marker");
  const output = JSON.parse(result.stdout);
  
  const pageFrameViolations = output.findings.filter((f) =>
    f.code.startsWith("layout.pageframe."),
  );
  
  const containerViolation = pageFrameViolations.find(
    (v) => v.code === "layout.pageframe.container-not-found",
  );
  assert.ok(containerViolation, "Should have container-not-found violation");
  assert.strictEqual(result.code, 1, "Should exit with code 1");
});

test("pageFrame validation - max-width mismatch (failing)", async () => {
  const result = await runValidate("maxwidth-fail");
  const output = JSON.parse(result.stdout);
  
  const pageFrameViolations = output.findings.filter((f) =>
    f.code.startsWith("layout.pageframe."),
  );
  
  const maxWidthViolation = pageFrameViolations.find(
    (v) => v.code === "layout.pageframe.maxwidth-mismatch",
  );
  assert.ok(maxWidthViolation, "Should have maxwidth-mismatch violation");
  assert.strictEqual(maxWidthViolation.expected, 1200);
  assert.strictEqual(maxWidthViolation.found, 1400);
  assert.strictEqual(result.code, 1, "Should exit with code 1");
});

test("pageFrame validation - min-width exact match (passing)", async () => {
  const result = await runValidate("minwidth-pass", minWidthContractPath);
  const output = JSON.parse(result.stdout);

  const pageFrameViolations = output.findings.filter((f) =>
    f.code.startsWith("layout.pageframe."),
  );
  assert.strictEqual(pageFrameViolations.length, 0, "Should have no pageFrame violations");
  assert.strictEqual(result.code, 0, "Should exit with code 0");
});

test("pageFrame validation - min-width mismatch (failing)", async () => {
  const result = await runValidate("minwidth-fail", minWidthContractPath);
  const output = JSON.parse(result.stdout);

  const pageFrameViolations = output.findings.filter((f) =>
    f.code.startsWith("layout.pageframe."),
  );

  const minWidthViolation = pageFrameViolations.find(
    (v) => v.code === "layout.pageframe.minwidth-mismatch",
  );
  assert.ok(minWidthViolation, "Should have minwidth-mismatch violation");
  assert.strictEqual(minWidthViolation.expected, 1024);
  assert.strictEqual(minWidthViolation.found, 960);
  assert.strictEqual(result.code, 1, "Should exit with code 1");
});

test("pageFrame validation - clamp() min-width (non-deterministic)", async () => {
  const result = await runValidate("minwidth-clamp", minWidthContractPath);
  const output = JSON.parse(result.stdout);

  const pageFrameViolations = output.findings.filter((f) =>
    f.code.startsWith("layout.pageframe."),
  );

  const minWidthViolation = pageFrameViolations.find(
    (v) => v.code === "layout.pageframe.non-deterministic-value",
  );
  assert.ok(minWidthViolation, "Should have non-deterministic-value violation");
  assert.strictEqual(result.code, 1, "Should exit with code 1");
});

test("pageFrame validation - unsupported selector reports violation", async () => {
  const result = await runValidate("inline-styles", unsupportedSelectorContractPath);
  const output = JSON.parse(result.stdout);

  const pageFrameViolations = output.findings.filter((f) =>
    f.code.startsWith("layout.pageframe."),
  );
  const selectorViolation = pageFrameViolations.find(
    (v) => v.code === "layout.pageframe.selector-unsupported",
  );
  assert.ok(selectorViolation, "Should have selector-unsupported violation");
  assert.strictEqual(result.code, 1, "Should exit with code 1");
});
