import { describe, it } from "node:test";
import assert from "node:assert";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractContractFromNextApp,
  stableStringify,
} from "../dist/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "fixtures", "next-app-minimal");

describe("extractContractFromNextApp", () => {
  it("returns contract and report with extracted fields", async () => {
    const { contract, report } = await extractContractFromNextApp({
      appRoot: FIXTURE,
      surfaceId: "test-surface",
    });
    assert.ok(contract.contractId === "test-surface.generated");
    assert.ok(contract.version === "0.1.0");
    assert.ok(Array.isArray(contract.surfaces) && contract.surfaces.length === 1);
    assert.strictEqual(contract.surfaces[0].id, "test-surface");
    assert.ok(Array.isArray(contract.sections) && contract.sections.length === 1);
    assert.ok(contract.x_extracted);
    assert.strictEqual(contract.x_extracted.authAware, true);
    assert.strictEqual(contract.x_extracted.hasShell, true);
    assert.ok(Array.isArray(contract.x_extracted.routes));
    assert.ok(contract.x_extracted.routes.includes("/"));
    assert.ok(contract.x_extracted.routes.includes("/auth/login"));
    assert.ok(Array.isArray(contract.x_extracted.designSystemComponents));
    assert.ok(contract.x_extracted.designSystemComponents.includes("Navigation"));
    assert.strictEqual(report.surfaceId, "test-surface");
    assert.ok(Array.isArray(report.warnings) && report.warnings.length > 0);
    assert.ok(report.extracted.routes.includes("/"));
    assert.strictEqual(report.extracted.authAware, true);
    assert.strictEqual(report.extracted.hasShell, true);
  });

  it("produces deterministic contract and report (stable key order)", async () => {
    const run1 = await extractContractFromNextApp({
      appRoot: FIXTURE,
      surfaceId: "test-surface",
    });
    const run2 = await extractContractFromNextApp({
      appRoot: FIXTURE,
      surfaceId: "test-surface",
    });
    const json1 = stableStringify({ contract: run1.contract, report: run1.report });
    const json2 = stableStringify({ contract: run2.contract, report: run2.report });
    assert.strictEqual(json1, json2, "Two runs must produce identical JSON");
  });

  it("report lists warnings for omitted extraction", async () => {
    const { report } = await extractContractFromNextApp({
      appRoot: FIXTURE,
      surfaceId: "test-surface",
    });
    const codes = report.warnings.map((w) => w.code);
    assert.ok(
      codes.includes("requiredSections.omitted"),
      "expected requiredSections.omitted warning",
    );
    assert.ok(
      codes.includes("allowedFonts.default"),
      "expected allowedFonts.default warning",
    );
  });
});

describe("stableStringify", () => {
  it("sorts object keys", () => {
    const obj = { z: 1, a: 2, m: 3 };
    const out = stableStringify(obj);
    assert.ok(out.startsWith('{\n  "a":'));
  });
});
