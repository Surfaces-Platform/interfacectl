#!/usr/bin/env node

import { mkdir, cp } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const schemas = [
  "web.surface.contract.schema.json",
  "ui.surface.ast.schema.json",
  "interfacectl.diff.schema.json",
  "interfacectl.policy.schema.json",
  "interfacectl.fix-summary.schema.json",
];

const destinationDir = path.resolve(__dirname, "../dist/schema");
await mkdir(destinationDir, { recursive: true });

for (const schema of schemas) {
  const source = path.resolve(__dirname, "../src/schema", schema);
  const destination = path.join(destinationDir, schema);
  await cp(source, destination);
}
