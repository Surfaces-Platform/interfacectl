import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
const SURFACES_UI_IMPORT = /from\s+['"]@surfaces\/ui(?:\/([^'"]*))?['"]/g;
const COMPONENT_PATH = /^components\/([A-Za-z0-9]+)/;
/**
 * Scan directory recursively for .tsx, .ts, .jsx, .js and collect
 * component names from @surfaces/ui (components/ subpath only).
 */
export async function extractDesignSystemComponents(appRoot, extensions = [".tsx", ".ts", ".jsx", ".js"]) {
    const seen = new Set();
    await scanDir(path.join(appRoot, "app"), seen, extensions);
    await scanDir(path.join(appRoot, "components"), seen, extensions);
    await scanDir(path.join(appRoot, "lib"), seen, extensions);
    await scanDir(path.join(appRoot, "src"), seen, extensions);
    const list = Array.from(seen);
    list.sort();
    return list;
}
async function scanDir(dir, seen, extensions) {
    let entries;
    try {
        const e = await readdir(dir, { withFileTypes: true });
        entries = e.map((x) => ({ name: x.name, isFile: x.isFile() }));
    }
    catch {
        return;
    }
    for (const { name, isFile } of entries) {
        const full = path.join(dir, name);
        if (isFile) {
            const ext = path.extname(name);
            if (extensions.includes(ext)) {
                const content = await readFile(full, "utf-8").catch(() => "");
                for (const match of content.matchAll(SURFACES_UI_IMPORT)) {
                    const subpath = match[1]?.trim() ?? "";
                    if (subpath.startsWith("components/")) {
                        const m = subpath.match(COMPONENT_PATH);
                        if (m) {
                            seen.add(m[1]);
                        }
                    }
                }
            }
            continue;
        }
        if (name !== "node_modules" && !name.startsWith(".")) {
            await scanDir(full, seen, extensions);
        }
    }
}
