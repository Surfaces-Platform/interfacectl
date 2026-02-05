import { readdir } from "node:fs/promises";
import path from "node:path";
import type { Dirent } from "node:fs";

const PAGE_FILES = ["page.tsx", "page.js", "page.ts", "page.jsx"];
const ROUTE_FILES = ["route.ts", "route.js", "route.tsx", "route.jsx"];

/**
 * Recursively collect public route paths from app/ directory.
 * Converts file system paths to URL path segments; dynamic segments
 * are preserved as [param], [...rest], [[...optional]].
 */
export async function extractRoutes(appDir: string): Promise<string[]> {
  const routes: string[] = [];
  await walk(appDir, "", routes);
  routes.sort();
  return routes;
}

async function walk(
  dir: string,
  segment: string,
  out: string[],
): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const name = e.name;
    const fullPath = path.join(dir, name);
    const urlSegment = segment ? `${segment}/${name}` : `/${name}`;
    if (e.isDirectory()) {
      if (name.startsWith("(") && name.endsWith(")")) {
        // Route group: (shell) -> no segment added
        const innerSegment = segment;
        await walk(fullPath, innerSegment, out);
      } else {
        await walk(fullPath, urlSegment, out);
      }
      continue;
    }
    if (e.isFile()) {
      const base = path.basename(name, path.extname(name));
      if (PAGE_FILES.includes(name)) {
        const route = segment || "/";
        if (!out.includes(route)) {
          out.push(route);
        }
      } else if (ROUTE_FILES.includes(name)) {
        const route = segment || "/";
        if (!out.includes(route)) {
          out.push(route);
        }
      }
    }
  }
}
