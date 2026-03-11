import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { inspectAuthProfile } from "../utils/auth-profiles.js";
import { analyzeSurface, stringifyStableArtifact, } from "../utils/first-run-analysis.js";
import { suggestSurfaceIdFromPath, suggestSurfaceIdFromUrl, suggestSurfaceName } from "../utils/onboarding.js";
import { redactSensitiveText } from "../utils/redaction.js";
const DEFAULT_OUT_DIR = "contracts/generated";
function normalizeSurfaceId(raw) {
    return raw
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
}
function inferSourceMode(options) {
    if (options.extractMode === "local-root" || options.extractMode === "remote-url") {
        return options.extractMode;
    }
    if (options.appRoot && !options.url) {
        return "local-root";
    }
    if (options.appRoot) {
        return "local-root";
    }
    return "remote-url";
}
function resolveOutputPath(rootDir, surfaceId, options) {
    if (options.out) {
        return path.resolve(rootDir, options.out);
    }
    const outDir = options.outDir
        ? path.resolve(rootDir, options.outDir)
        : path.resolve(rootDir, DEFAULT_OUT_DIR);
    return path.join(outDir, `${surfaceId}.analysis.json`);
}
export async function runAnalyzeCommand(options) {
    const rootDir = process.cwd();
    try {
        const sourceMode = inferSourceMode(options);
        if (sourceMode === "remote-url" && !options.url) {
            throw new Error("Missing required --url for remote-url analysis.");
        }
        if (sourceMode === "local-root" && !options.appRoot) {
            throw new Error("Missing required --app-root for local-root analysis.");
        }
        if (sourceMode === "local-root") {
            const appRoot = path.resolve(rootDir, options.appRoot ?? ".");
            if (!existsSync(path.join(appRoot, "app"))) {
                throw new Error(`Local app root is missing app/: ${appRoot}`);
            }
        }
        const surfaceSuggestion = options.surface ??
            (sourceMode === "remote-url" && options.url
                ? suggestSurfaceIdFromUrl(options.url)
                : suggestSurfaceIdFromPath(options.appRoot ?? "surface"));
        const surfaceId = normalizeSurfaceId(surfaceSuggestion);
        const surfaceName = options.surfaceName ?? suggestSurfaceName(surfaceId);
        let authMode = "none";
        let authProfileName;
        let authStorageState;
        if (sourceMode === "remote-url" && options.authProfile && options.url) {
            const url = new URL(options.url);
            const inspection = await inspectAuthProfile(options.authProfile, url.hostname);
            if (inspection.status !== "ready" || !inspection.profile || !inspection.storageState) {
                const reason = inspection.status === "missing"
                    ? "was not found"
                    : inspection.status === "expired"
                        ? "is expired"
                        : inspection.status === "legacy"
                            ? "is legacy and must be re-captured"
                            : "is not replay-ready and must be re-captured";
                throw new Error(`Auth profile "${options.authProfile}" for ${url.hostname} ${reason}.`);
            }
            authMode = "browser-session";
            authProfileName = inspection.profile.name;
            authStorageState = inspection.storageState;
        }
        const result = await analyzeSurface({
            workspaceRoot: rootDir,
            surfaceId,
            surfaceName,
            sourceMode,
            appRoot: options.appRoot,
            url: options.url,
            surfaceKindOverride: options.surfaceKind,
            authMode,
            authProfileName,
            authStorageState,
        });
        const outputPath = resolveOutputPath(rootDir, surfaceId, options);
        await mkdir(path.dirname(outputPath), { recursive: true });
        await writeFile(outputPath, stringifyStableArtifact(result.analysis), "utf-8");
        console.log(`Wrote analysis: ${outputPath}`);
        console.log(`Inferred surface kind: ${result.analysis.classification.inferredKind} (${result.analysis.classification.confidence.toFixed(2)})`);
        if (result.analysis.classification.requiresConfirmation && !options.surfaceKind) {
            console.log("Note: classification is low confidence; pass --surface-kind to confirm seeding intent.");
        }
        return 0;
    }
    catch (error) {
        console.error(redactSensitiveText(error.message));
        return 1;
    }
}
