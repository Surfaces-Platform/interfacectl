import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { getBundledContractSchema, validateContractStructure, } from "@surfaces/interfacectl-validator";
import { runValidateCommand } from "./validate.js";
import { runValidateExtractedCommand } from "./validate-extracted.js";
import { getAuthStorageMode, inspectAuthProfile, saveReplayAuthProfile, } from "../utils/auth-profiles.js";
import { captureBrowserStorageState } from "../utils/browser-session.js";
import { analyzeSurface, stringifyStableArtifact, } from "../utils/first-run-analysis.js";
import { emitOnboardingRunArtifact, suggestSurfaceIdFromPath, suggestSurfaceIdFromUrl, suggestSurfaceName } from "../utils/onboarding.js";
import { redactSensitiveText } from "../utils/redaction.js";
const DEFAULT_OUT_DIR = "contracts/generated";
const VALID_SURFACE_KINDS = new Set(["marketing", "application", "unknown"]);
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
async function maybeCaptureAuthProfile(inputValue) {
    if (!inputValue.requiresAuth) {
        return { authMode: "none" };
    }
    const parsed = new URL(inputValue.url);
    const profileName = inputValue.profileName ?? `${parsed.hostname}-default`;
    const inspection = await inspectAuthProfile(profileName, parsed.hostname);
    if (inspection.status === "ready" && inspection.profile && inspection.storageState) {
        return {
            authMode: "browser-session",
            profileName: inspection.profile.name,
            storageState: inspection.storageState,
        };
    }
    if (inputValue.nonInteractive) {
        const reason = inspection.status === "missing"
            ? "was not found"
            : inspection.status === "expired"
                ? "is expired"
                : inspection.status === "legacy"
                    ? "is legacy and must be re-captured"
                    : "is not replay-ready and must be re-captured";
        throw new Error(`Auth profile "${profileName}" for ${parsed.hostname} ${reason}. Capture it interactively first or omit --auth-profile.`);
    }
    const captured = await captureBrowserStorageState({
        url: parsed.toString(),
    });
    const finalUrl = new URL(captured.finalUrl);
    if (finalUrl.hostname !== parsed.hostname) {
        throw new Error(`Capture finished on ${finalUrl.hostname}, but the requested host was ${parsed.hostname}. Capture a profile for the final host instead.`);
    }
    const profile = await saveReplayAuthProfile({
        name: profileName,
        domain: parsed.hostname,
        storageState: captured.storageState,
        captureBrowser: "chromium",
    });
    return {
        authMode: "browser-session",
        profileName: profile.name,
        storageState: captured.storageState,
    };
}
async function promptInteractive(options) {
    const rl = readline.createInterface({ input, output });
    try {
        const inferredMode = inferSourceMode(options);
        const rawMode = ((options.extractMode ??
            (await rl.question(`Source mode (local-root/remote-url) [${inferredMode}]: `)).trim()) ||
            inferredMode).toLowerCase();
        const sourceMode = rawMode === "remote-url" ? "remote-url" : "local-root";
        const url = sourceMode === "remote-url"
            ? new URL(options.url ?? (await rl.question("Surface URL: ")).trim()).toString()
            : options.url?.trim() || undefined;
        const appRoot = sourceMode === "local-root"
            ? (options.appRoot ?? (await rl.question("Local app root: "))).trim()
            : undefined;
        const suggestedSurfaceId = options.surface ?? (sourceMode === "remote-url" && url
            ? suggestSurfaceIdFromUrl(url)
            : suggestSurfaceIdFromPath(appRoot ?? "surface"));
        const rawSurfaceId = (await rl.question(`Surface id [${suggestedSurfaceId}]: `)).trim();
        const surfaceId = normalizeSurfaceId(rawSurfaceId || suggestedSurfaceId);
        const suggestedSurfaceName = options.surfaceName ?? suggestSurfaceName(surfaceId);
        const rawSurfaceName = (await rl.question(`Surface name [${suggestedSurfaceName}]: `)).trim();
        const surfaceName = rawSurfaceName || suggestedSurfaceName;
        const requiresAuth = sourceMode === "remote-url"
            ? ["y", "yes"].includes((await rl.question(`Does ${new URL(url ?? "https://example.com").hostname} require login? (y/N) `)).trim().toLowerCase())
            : false;
        const authProfileName = requiresAuth
            ? (await rl.question(`Auth profile name [${options.authProfile ?? `${new URL(url).hostname}-default`}]: `)).trim() || options.authProfile || `${new URL(url).hostname}-default`
            : null;
        return {
            sourceMode,
            url,
            appRoot: appRoot && appRoot.length > 0 ? appRoot : undefined,
            surfaceId,
            surfaceName,
            surfaceKind: options.surfaceKind,
            requiresAuth,
            authProfileName,
        };
    }
    finally {
        rl.close();
    }
}
async function resolveInputs(options) {
    if (!options.nonInteractive) {
        return promptInteractive(options);
    }
    const sourceMode = inferSourceMode(options);
    if (sourceMode === "remote-url" && !options.url) {
        throw new Error("Missing required --url for remote-url onboarding.");
    }
    if (sourceMode === "local-root" && !options.appRoot) {
        throw new Error("Missing required --app-root for local-root onboarding.");
    }
    const surfaceSuggestion = options.surface ??
        (sourceMode === "remote-url" && options.url
            ? suggestSurfaceIdFromUrl(options.url)
            : suggestSurfaceIdFromPath(options.appRoot ?? "surface"));
    const surfaceId = normalizeSurfaceId(surfaceSuggestion);
    const surfaceName = options.surfaceName ?? suggestSurfaceName(surfaceId);
    return {
        sourceMode,
        url: options.url ? new URL(options.url).toString() : undefined,
        appRoot: options.appRoot,
        surfaceId,
        surfaceName,
        surfaceKind: options.surfaceKind,
        requiresAuth: sourceMode === "remote-url" && Boolean(options.authProfile),
        authProfileName: sourceMode === "remote-url" ? options.authProfile ?? null : null,
    };
}
async function promptSurfaceKind(analysis) {
    const rl = readline.createInterface({ input, output });
    try {
        console.log(`Surface kind needs confirmation. interfacectl inferred "${analysis.classification.inferredKind}" (${analysis.classification.confidence.toFixed(2)} confidence).`);
        for (const evidence of analysis.classification.supporting.slice(0, 3)) {
            console.log(`  support: ${evidence.message}`);
        }
        for (const evidence of analysis.classification.opposing.slice(0, 2)) {
            console.log(`  counter: ${evidence.message}`);
        }
        while (true) {
            const answer = (await rl.question(`Confirm surface kind [${analysis.classification.inferredKind}]: `)).trim().toLowerCase();
            const value = (answer || analysis.classification.inferredKind);
            if (VALID_SURFACE_KINDS.has(value)) {
                return value;
            }
            console.log("Expected one of: marketing, application, unknown.");
        }
    }
    finally {
        rl.close();
    }
}
function resolveArtifactPaths(rootDir, surfaceId, options) {
    const outDir = options.outDir
        ? path.resolve(rootDir, options.outDir)
        : path.resolve(rootDir, DEFAULT_OUT_DIR);
    const resolvePath = (explicit, fileName) => explicit ? path.resolve(rootDir, explicit) : path.join(outDir, fileName);
    return {
        outDir,
        analysisPath: resolvePath(options.analysisOut, `${surfaceId}.analysis.json`),
        draftPath: resolvePath(options.draftOut, `${surfaceId}.design-system.draft.json`),
        contractPath: resolvePath(options.contractOut, `${surfaceId}.contract.json`),
        reportPath: resolvePath(options.reportOut, `${surfaceId}.extraction.json`),
    };
}
async function writeArtifact(filePath, payload) {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, stringifyStableArtifact(payload), "utf-8");
}
async function readJsonFile(filePath) {
    return JSON.parse(await readFile(filePath, "utf-8"));
}
function relativeDisplay(rootDir, filePath) {
    return path.relative(rootDir, filePath) || ".";
}
function collectFlagMessages(analysis, validateResult, validateExtractedResult) {
    const flagged = [
        ...analysis.warnings.map((warning) => warning.message),
        ...analysis.inconsistencies.findings.map((finding) => finding.message),
        ...(validateResult.findings ?? []).map((finding) => finding.message),
        ...validateExtractedResult.findings.map((finding) => finding.message),
    ];
    return [...new Set(flagged)].slice(0, 8);
}
function collectFindingCodes(analysis, validateResult, validateExtractedResult) {
    return [
        ...analysis.warnings.map((warning) => `analysis.${warning.code}`),
        ...analysis.inconsistencies.findings.map((finding) => `analysis.${finding.code}`),
        ...(validateResult.findings ?? []).map((finding) => `validate.${finding.code}`),
        ...validateExtractedResult.findings.map((finding) => `validate-extracted.${finding.code}`),
    ].sort((a, b) => a.localeCompare(b));
}
function summarizeAdopted(analysis) {
    const reasons = analysis.existingSystem.reasons.slice(0, 3);
    if (analysis.existingSystem.mode === "adopt") {
        return reasons.length > 0
            ? reasons
            : ["Observed enough repeated system structure to formalize an existing design system."];
    }
    return [
        `No stable existing system was detected; interfacectl drafted a first system from repeated norms (${analysis.existingSystem.score.toFixed(2)} score).`,
    ];
}
function summarizeNormalized(analysis) {
    const seedCounts = analysis.proposedContract.seedCounts;
    const items = [
        `${seedCounts.typographyTokens} typography token seed(s)`,
        `${seedCounts.layoutTokens} layout token seed(s)`,
        `${seedCounts.motionTokens} motion token seed(s)`,
        `${seedCounts.colors} color value(s)`,
        `${seedCounts.sections} section marker(s)`,
    ];
    if (analysis.proposedContract.suggestedMarketingProfile) {
        items.push("starter marketing profile suggestions");
    }
    return items;
}
function logStage(step, total, message) {
    console.log(`[${step}/${total}] ${message}`);
}
function hasBlockingValidationError(validateResult, validateExtractedResult) {
    return ((validateResult.findings ?? []).some((finding) => finding.category === "E0") ||
        validateExtractedResult.findings.some((finding) => finding.category === "E0"));
}
export async function runInitCommand(options) {
    const rootDir = process.cwd();
    const storageMode = getAuthStorageMode();
    try {
        const resolved = await resolveInputs(options);
        if (resolved.sourceMode === "local-root") {
            const appRoot = path.resolve(rootDir, resolved.appRoot ?? ".");
            if (!existsSync(path.join(appRoot, "app"))) {
                console.error(`Local app root is missing app/: ${appRoot}`);
                return 1;
            }
        }
        logStage(1, 5, "Discovering source");
        const authCapture = resolved.sourceMode === "remote-url" && resolved.url
            ? await maybeCaptureAuthProfile({
                requiresAuth: resolved.requiresAuth,
                profileName: resolved.authProfileName,
                url: resolved.url,
                nonInteractive: Boolean(options.nonInteractive),
            })
            : { authMode: "none", storageState: undefined };
        logStage(2, 5, "Analyzing surface kind and UI system");
        let analysisResult = await analyzeSurface({
            workspaceRoot: rootDir,
            surfaceId: resolved.surfaceId,
            surfaceName: resolved.surfaceName,
            sourceMode: resolved.sourceMode,
            appRoot: resolved.appRoot,
            url: resolved.url,
            surfaceKindOverride: resolved.surfaceKind,
            authMode: authCapture.authMode,
            authProfileName: authCapture.profileName,
            authStorageState: authCapture.storageState,
        });
        if (!resolved.surfaceKind && analysisResult.analysis.classification.requiresConfirmation) {
            if (options.nonInteractive) {
                console.error(`Surface kind inference was low confidence (${analysisResult.analysis.classification.inferredKind}, ${analysisResult.analysis.classification.confidence.toFixed(2)}). Re-run with --surface-kind marketing|application|unknown.`);
                return 1;
            }
            const confirmedKind = await promptSurfaceKind(analysisResult.analysis);
            if (confirmedKind !== analysisResult.analysis.classification.confirmedKind) {
                analysisResult = await analyzeSurface({
                    workspaceRoot: rootDir,
                    surfaceId: resolved.surfaceId,
                    surfaceName: resolved.surfaceName,
                    sourceMode: resolved.sourceMode,
                    appRoot: resolved.appRoot,
                    url: resolved.url,
                    surfaceKindOverride: confirmedKind,
                    authMode: authCapture.authMode,
                    authProfileName: authCapture.profileName,
                    authStorageState: authCapture.storageState,
                });
            }
        }
        logStage(3, 5, "Seeding contract and draft design system");
        const structure = validateContractStructure(analysisResult.contract, getBundledContractSchema());
        if (!structure.ok) {
            console.error("Generated contract failed schema validation:");
            for (const issue of structure.errors) {
                console.error(`  ${issue}`);
            }
            return 1;
        }
        const artifacts = resolveArtifactPaths(rootDir, resolved.surfaceId, options);
        await writeArtifact(artifacts.analysisPath, analysisResult.analysis);
        await writeArtifact(artifacts.draftPath, analysisResult.draft);
        await writeArtifact(artifacts.contractPath, analysisResult.contract);
        await writeArtifact(artifacts.reportPath, analysisResult.extractionReport);
        logStage(4, 5, "Validating generated outputs");
        const tempDir = await mkdtemp(path.join(os.tmpdir(), "interfacectl-init-validate-"));
        try {
            const validatePath = path.join(tempDir, "validate.json");
            const validateExtractedPath = path.join(tempDir, "validate-extracted.json");
            const validateExitCode = await runValidateCommand({
                contractPath: artifacts.contractPath,
                workspaceRoot: rootDir,
                surfaceFilters: [resolved.surfaceId],
                descriptorOverrides: [analysisResult.descriptor],
                outputFormat: "json",
                outputPath: validatePath,
                exitCodes: "v2",
            });
            const validateExtractedExitCode = await runValidateExtractedCommand({
                contractPath: artifacts.contractPath,
                extractedPath: artifacts.reportPath,
                surfaceId: resolved.surfaceId,
                format: "json",
                outputPath: validateExtractedPath,
                exitCodes: "v2",
            });
            const validateResult = await readJsonFile(validatePath);
            const validateExtractedResult = await readJsonFile(validateExtractedPath);
            logStage(5, 5, "Writing onboarding lineage");
            const findingCodes = collectFindingCodes(analysisResult.analysis, validateResult, validateExtractedResult);
            const blockingValidationError = hasBlockingValidationError(validateResult, validateExtractedResult);
            const status = blockingValidationError
                ? "fail"
                : findingCodes.length > 0
                    ? "warn"
                    : "pass";
            const run = await emitOnboardingRunArtifact({
                rootDir,
                surfaceId: resolved.surfaceId,
                source: "generation",
                status,
                findingCodes,
                extractionPath: artifacts.contractPath,
                reportPath: artifacts.reportPath,
            });
            const adopted = summarizeAdopted(analysisResult.analysis);
            const normalized = summarizeNormalized(analysisResult.analysis);
            const flagged = collectFlagMessages(analysisResult.analysis, validateResult, validateExtractedResult);
            console.log(`Onboarding completed for ${resolved.surfaceId}.`);
            console.log(`Wrote analysis: ${artifacts.analysisPath}`);
            console.log(`Wrote draft:    ${artifacts.draftPath}`);
            console.log(`Wrote contract: ${artifacts.contractPath}`);
            console.log(`Wrote report:   ${artifacts.reportPath}`);
            console.log(`Run id: ${run.runId}`);
            console.log(`Auth storage: ${storageMode}`);
            if (storageMode === "file") {
                console.log("Warning: keychain unavailable; using local file storage for opaque session references.");
            }
            if (authCapture.profileName) {
                console.log(`Auth profile: ${authCapture.profileName}`);
            }
            console.log("");
            console.log("adopted");
            for (const line of adopted) {
                console.log(`  - ${line}`);
            }
            console.log("normalized");
            for (const line of normalized) {
                console.log(`  - ${line}`);
            }
            console.log("flagged");
            if (flagged.length === 0) {
                console.log("  - No onboarding findings.");
            }
            else {
                for (const line of flagged) {
                    console.log(`  - ${line}`);
                }
            }
            console.log("next steps");
            console.log(`  - interfacectl validate-extracted --contract ${relativeDisplay(rootDir, artifacts.contractPath)} --extracted ${relativeDisplay(rootDir, artifacts.reportPath)} --surface ${resolved.surfaceId}`);
            if (resolved.sourceMode === "local-root") {
                console.log(`  - Add surfaceRoots.${resolved.surfaceId} = "${relativeDisplay(rootDir, path.resolve(rootDir, resolved.appRoot ?? "."))}" in interfacectl.config.json for repeatable source-backed validation.`);
                console.log(`  - interfacectl validate --contract ${relativeDisplay(rootDir, artifacts.contractPath)} --surface ${resolved.surfaceId}`);
            }
            else {
                console.log(`  - Re-run with --app-root to enable source-backed validate once the local web app checkout is available.`);
            }
            return blockingValidationError || validateExitCode === 10 || validateExtractedExitCode === 10
                ? 1
                : 0;
        }
        finally {
            await rm(tempDir, { recursive: true, force: true });
        }
    }
    catch (error) {
        console.error(redactSensitiveText(error.message));
        return 1;
    }
}
