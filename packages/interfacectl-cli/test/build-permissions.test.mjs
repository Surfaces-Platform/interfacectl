import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliPath = path.resolve(__dirname, "..", "dist", "index.js");

test("build output keeps the CLI entrypoint executable", async (t) => {
  if (process.platform === "win32") {
    t.skip("POSIX execute bits are not enforced on Windows");
  }

  const stats = await stat(cliPath);
  assert.notEqual(stats.mode & 0o111, 0, "Expected dist/index.js to be executable");
});
