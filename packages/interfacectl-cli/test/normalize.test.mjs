import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeSetField,
  stripEphemeralFields,
  normalizeContract,
  normalizeDescriptor,
} from "../dist/utils/normalize.js";
import { normalizeRemoteUrlInput, suggestSurfaceIdFromUrl } from "../dist/utils/onboarding.js";

test("normalizeSetField sorts arrays deterministically", () => {
  const input = ["c", "a", "b"];
  const normalized = normalizeSetField(input);
  assert.deepEqual(normalized, ["a", "b", "c"]);
});

test("normalizeSetField handles empty arrays", () => {
  const input = [];
  const normalized = normalizeSetField(input);
  assert.deepEqual(normalized, []);
});

test("stripEphemeralFields removes source fields", () => {
  const input = {
    id: "test",
    source: "file.ts",
    value: "test-value",
  };
  const { result } = stripEphemeralFields(input);
  assert.equal(result.id, "test");
  assert.equal(result.value, "test-value");
  assert.equal(result.source, undefined);
});

test("stripEphemeralFields tracks stripped paths", () => {
  const input = {
    id: "test",
    source: "file.ts",
  };
  const { result, strippedPaths } = stripEphemeralFields(input);
  assert(strippedPaths.includes("source") || strippedPaths.includes("id.source"));
  assert.equal(result.source, undefined);
});

test("normalizeContract sorts set-like arrays", () => {
  const contract = {
    contractId: "test",
    version: "1.0.0",
    surfaces: [
      {
        id: "test-surface",
        displayName: "Test",
        type: "web",
        requiredSections: ["b", "a", "c"],
        allowedFonts: ["font2", "font1"],
        icons: {
          policy: "warn",
          allowedSources: ["react-icons/fi", "lucide-react"],
        },
        layout: { maxContentWidth: 1000 },
      },
    ],
    sections: [],
    constraints: {
      motion: {
        allowedDurationsMs: [200, 100],
        allowedTimingFunctions: ["ease", "linear"],
      },
    },
    color: {
      policy: "off",
      allowedValues: ["color2", "color1"],
    },
  };
  const normalized = normalizeContract(contract);
  assert.deepEqual(
    normalized.contract.surfaces[0].requiredSections,
    ["a", "b", "c"],
  );
  assert.deepEqual(
    normalized.contract.surfaces[0].allowedFonts,
    ["font1", "font2"],
  );
  assert.deepEqual(
    normalized.contract.surfaces[0].icons.allowedSources,
    ["lucide-react", "react-icons/fi"],
  );
  assert.deepEqual(
    normalized.contract.color.allowedValues,
    ["color1", "color2"],
  );
});

test("normalizeDescriptor strips ephemeral fields", () => {
  const descriptor = {
    surfaceId: "test",
    sections: [{ id: "section1", source: "file.ts" }],
    fonts: [{ value: "font1", source: "file.ts" }],
    colors: [{ value: "color1", source: "file.ts" }],
    icons: [{ value: "react-icons/fi", source: "file.ts" }],
    layout: { maxContentWidth: 1000, source: "file.ts" },
    motion: [],
  };
  const normalized = normalizeDescriptor(descriptor);
  assert.equal(normalized.descriptor.sections[0].source, undefined);
  assert.equal(normalized.descriptor.fonts[0].source, undefined);
  assert.equal(normalized.descriptor.icons[0].source, undefined);
  assert.equal(normalized.descriptor.layout.source, undefined);
});

test("normalizeRemoteUrlInput defaults bare domains to https", () => {
  assert.equal(
    normalizeRemoteUrlInput("surfaces.systems"),
    "https://surfaces.systems/",
  );
});

test("normalizeRemoteUrlInput defaults local hosts to http", () => {
  assert.equal(
    normalizeRemoteUrlInput("127.0.0.1:3000/app"),
    "http://127.0.0.1:3000/app",
  );
  assert.equal(
    normalizeRemoteUrlInput("localhost:3000/app"),
    "http://localhost:3000/app",
  );
});

test("suggestSurfaceIdFromUrl accepts bare domains", () => {
  assert.equal(
    suggestSurfaceIdFromUrl("surfaces.systems/start"),
    "surfaces-systems-start",
  );
});
