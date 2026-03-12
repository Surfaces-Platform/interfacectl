import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import url from "node:url";
import {
  getBundledContractSchema,
  validateContractStructure,
} from "../dist/index.js";

const fixturePath = path.join(
  url.fileURLToPath(new URL(".", import.meta.url)),
  "fixtures",
  "authoring",
  "reference-target-web.contract.json",
);

async function loadFixture() {
  const raw = await readFile(fixturePath, "utf8");
  return JSON.parse(raw);
}

test("validateContractStructure accepts generic authoring metadata for a web surface", async () => {
  const schema = getBundledContractSchema();
  const contract = await loadFixture();
  const result = validateContractStructure(contract, schema);
  assert.equal(result.ok, true);
});

test("validateContractStructure rejects section anatomy references to unknown components", async () => {
  const schema = getBundledContractSchema();
  const contract = await loadFixture();
  contract.sections[0].anatomy.defaultComponent = "missing-component";
  const result = validateContractStructure(contract, schema);
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((error) => error.includes("/sections/page.intro/anatomy/defaultComponent")),
    `expected defaultComponent validation error, got ${JSON.stringify(result.errors)}`,
  );
});

test("validateContractStructure rejects component states that reference unknown slots", async () => {
  const schema = getBundledContractSchema();
  const contract = await loadFixture();
  contract.components[1].states[0].requiredSlots.push("missing-slot");
  const result = validateContractStructure(contract, schema);
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((error) => error.includes("/components/feature-card/states/default/requiredSlots/missing-slot")),
    `expected requiredSlots validation error, got ${JSON.stringify(result.errors)}`,
  );
});

test("validateContractStructure rejects interactions with unknown effects", async () => {
  const schema = getBundledContractSchema();
  const contract = await loadFixture();
  contract.components[1].interactions[0].effect = "launch";
  const result = validateContractStructure(contract, schema);
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((error) => error.includes("/components/1/interactions/0/effect")),
    `expected effect schema validation error, got ${JSON.stringify(result.errors)}`,
  );
});

test("validateContractStructure rejects invalid viewport ranges", async () => {
  const schema = getBundledContractSchema();
  const contract = await loadFixture();
  contract.surfaces[0].viewports[0].minWidthPx = 900;
  contract.surfaces[0].viewports[0].maxWidthPx = 767;
  const result = validateContractStructure(contract, schema);
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((error) => error.includes("/surfaces/reference-target-web/viewports/mobile")),
    `expected viewport range validation error, got ${JSON.stringify(result.errors)}`,
  );
});

test("validateContractStructure rejects authoring metadata on non-web surfaces", async () => {
  const schema = getBundledContractSchema();
  const contract = await loadFixture();
  contract.surfaces[0].type = "cli";
  const result = validateContractStructure(contract, schema);
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((error) => error.includes("/surfaces/0")),
    `expected surface type validation error, got ${JSON.stringify(result.errors)}`,
  );
});
