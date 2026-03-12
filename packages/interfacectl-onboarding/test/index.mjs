import { readdir } from "node:fs/promises";
import path from "node:path";
import url from "node:url";

const rootDir = url.fileURLToPath(new URL(".", import.meta.url));

async function loadTestsFrom(directory) {
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await loadTestsFrom(entryPath);
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".test.mjs")) {
      const fileUrl = url.pathToFileURL(entryPath);
      await import(fileUrl.href);
    }
  }
}

await loadTestsFrom(rootDir);
