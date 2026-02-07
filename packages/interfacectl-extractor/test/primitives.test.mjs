import test from "node:test";
import assert from "node:assert/strict";
import { extractContractFromNextApp } from "../dist/index.js";
import path from "node:path";

const fixturesRoot = path.join(process.cwd(), "test", "fixtures");
const fixture = path.join(fixturesRoot, "simple-app");

test("extracts nav/header primitives from section files", async () => {
  const { report } = await extractContractFromNextApp({
    appRoot: fixture,
    surfaceId: "runs",
  });

  const primitives = report.extracted.primitives;
  assert.ok(Array.isArray(primitives));
  const nav = primitives.find((p) => p.role === "nav");
  assert.ok(nav);
  assert.equal(nav.count, 1);
});
