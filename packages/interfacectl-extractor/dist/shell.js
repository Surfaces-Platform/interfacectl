import { access } from "node:fs/promises";
import path from "node:path";
/**
 * Detect presence of a layout shell: app/layout.tsx or app/(shell)/layout.tsx.
 */
export async function detectHasShell(appRoot) {
    const appDir = path.join(appRoot, "app");
    const rootLayout = path.join(appDir, "layout.tsx");
    const rootLayoutJs = path.join(appDir, "layout.js");
    const shellLayout = path.join(appDir, "(shell)", "layout.tsx");
    const shellLayoutJs = path.join(appDir, "(shell)", "layout.js");
    for (const p of [rootLayout, rootLayoutJs, shellLayout, shellLayoutJs]) {
        try {
            await access(p);
            return true;
        }
        catch {
            // continue
        }
    }
    return false;
}
