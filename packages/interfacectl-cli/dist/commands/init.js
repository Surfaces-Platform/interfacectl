import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getBundledContractSchema, getBundledUiAstSchema, deriveLegacyContractFromUiAst, migrateLegacyContractToUiAst, normalizeUiAst, validateContractStructure, validateUiAstStructure, } from "@surfaces/interfacectl-validator";
import { runCompileCommand } from "./compile.js";
import { runValidateCommand } from "./validate.js";
import { runValidateExtractedCommand } from "./validate-extracted.js";
import { getAuthStorageMode, inspectAuthProfile, saveReplayAuthProfile, } from "../utils/auth-profiles.js";
import { captureBrowserStorageState, observeRemotePage } from "../utils/browser-session.js";
import { analyzeSurface, stringifyStableArtifact, } from "../utils/first-run-analysis.js";
import { emitOnboardingRunArtifact, normalizeRemoteUrlInput, suggestSurfaceIdFromPath, suggestSurfaceIdFromUrl, suggestSurfaceName, } from "../utils/onboarding.js";
import { inferSourceMode, normalizeSurfaceId, promptGateResolution, promptInteractiveInitInputs, promptSurfaceKindConfirmation, promptWriteConfirmation, } from "../utils/init-interactive.js";
import { normalizeContract } from "../utils/normalize.js";
import { redactSensitiveText } from "../utils/redaction.js";
const DEFAULT_OUT_DIR = "contracts/generated";
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
async function resolveInputs(options) {
    if (!options.nonInteractive) {
        return promptInteractiveInitInputs(options);
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
        url: options.url ? normalizeRemoteUrlInput(options.url) : undefined,
        appRoot: options.appRoot,
        surfaceId,
        surfaceName,
        surfaceKind: options.surfaceKind,
        requiresAuth: sourceMode === "remote-url" && Boolean(options.authProfile),
        authProfileName: sourceMode === "remote-url" ? options.authProfile ?? null : null,
    };
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
        astPath: resolvePath(options.astOut, `${surfaceId}.ui.surface.ast.json`),
        contractPath: resolvePath(options.contractOut, `${surfaceId}.contract.json`),
        reportPath: resolvePath(options.reportOut, `${surfaceId}.extraction.json`),
        bundleRoot: options.bundleOutDir
            ? path.resolve(rootDir, options.bundleOutDir)
            : path.join(outDir, `${surfaceId}.bundle`),
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
function uniqueMessages(items) {
    return [...new Set(items)];
}
function collectFindingCodes(analysis, validateResult, validateExtractedResult) {
    return [
        ...analysis.warnings.map((warning) => `analysis.${warning.code}`),
        ...analysis.inconsistencies.findings.map((finding) => `analysis.${finding.code}`),
        ...(validateResult.findings ?? []).map((finding) => `validate.${finding.code}`),
        ...validateExtractedResult.findings.map((finding) => `validate-extracted.${finding.code}`),
    ].sort((a, b) => a.localeCompare(b));
}
function summarizeTechnicalDraft(analysis) {
    const { seedCounts } = analysis.proposedContract;
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
function summarizeSurfaceKind(analysis) {
    if (analysis.classification.confirmedKind === "marketing") {
        return "We detected a marketing site.";
    }
    if (analysis.classification.confirmedKind === "application") {
        return "We detected an application surface.";
    }
    return "We could not confidently classify the surface, so the draft stays generic.";
}
function summarizeExistingSystem(analysis) {
    if (analysis.existingSystem.mode === "adopt") {
        return "We found reusable patterns that look like an existing system.";
    }
    return "We did not find a complete existing system, so we will draft one from repeated patterns.";
}
function summarizeSourceAccess(analysis) {
    if (analysis.sourceHealth.confidence === "full" && analysis.sourceHealth.status === "ok") {
        return "We successfully analyzed the source.";
    }
    return "We analyzed a limited view of the source, so results are provisional.";
}
function summarizeDraft(analysis) {
    const { seedCounts } = analysis.proposedContract;
    const createItems = [];
    const reviewItems = [];
    if (seedCounts.typographyTokens > 0) {
        createItems.push(`Typography foundations from ${seedCounts.typographyTokens} repeated styles.`);
    }
    if (seedCounts.layoutTokens > 0) {
        createItems.push(`Layout foundations from ${seedCounts.layoutTokens} repeated patterns.`);
    }
    else {
        reviewItems.push("We could not confidently infer layout foundations yet.");
    }
    if (seedCounts.motionTokens > 0) {
        createItems.push(`Motion foundations from ${seedCounts.motionTokens} repeated timings.`);
    }
    if (seedCounts.colors > 0) {
        createItems.push(`Color foundation with ${seedCounts.colors} reusable values.`);
    }
    if (seedCounts.sections > 0) {
        createItems.push(`Detected ${seedCounts.sections} reusable page sections.`);
    }
    if (analysis.proposedContract.suggestedMarketingProfile) {
        createItems.push("Landing-page guidance will be drafted from the detected structure.");
    }
    return {
        createItems,
        reviewItems,
    };
}
function rewritePreviewMessage(message, verbose = false) {
    if (verbose) {
        return message;
    }
    const layoutProfileMatch = message.match(/^Surface "([^"]+)" must declare marketing layout profile "([^"]+)"\.$/);
    if (layoutProfileMatch) {
        return "Landing-page structure was detected, so the draft will include landing layout guidance.";
    }
    const typographyProfileMatch = message.match(/^Surface "([^"]+)" must declare marketing typography profile "([^"]+)"\.$/);
    if (typographyProfileMatch) {
        return "Marketing typography signals were detected, so the draft will include typography guidance.";
    }
    const rawColorMatch = message.match(/^Detected (\d+) raw color literals; consider canonicalizing them into stable tokens or approved values\.$/);
    if (rawColorMatch) {
        return `We found ${rawColorMatch[1]} one-off color values that should probably be normalized.`;
    }
    if (message.includes("access-denied page")) {
        return "We reached an access-denied page instead of the target surface, so the results are provisional.";
    }
    if (message.includes("login page")) {
        return "We reached a login page instead of the target surface, so the results are provisional.";
    }
    return message;
}
function logStage(step, total, message, enabled = true) {
    if (!enabled) {
        return;
    }
    console.log(`[${step}/${total}] ${message}`);
}
function hasBlockingValidationError(validateResult, validateExtractedResult) {
    return ((validateResult.findings ?? []).some((finding) => finding.category === "E0") ||
        validateExtractedResult.findings.some((finding) => finding.category === "E0"));
}
function isLimitedRemoteSource(analysis) {
    return analysis.source.mode === "remote-url" && analysis.sourceHealth.status !== "ok";
}
function buildProvisionalWarning(analysis) {
    const detail = analysis.sourceHealth.status === "access-denied"
        ? "the remote URL resolved to an access-denied page"
        : analysis.sourceHealth.status === "login"
            ? "the remote URL resolved to a login page"
            : "remote source access is limited";
    return {
        code: "remote.source.provisional",
        message: `Writing provisional onboarding artifacts because ${detail}.`,
    };
}
function applyProvisionalWarning(analysisResult) {
    const warning = buildProvisionalWarning(analysisResult.analysis);
    const dedupeWarnings = (items) => [...new Map(items.map((item) => [`${item.code}:${item.message}`, item])).values()]
        .sort((a, b) => a.code.localeCompare(b.code) || a.message.localeCompare(b.message));
    return {
        ...analysisResult,
        analysis: {
            ...analysisResult.analysis,
            warnings: dedupeWarnings([...analysisResult.analysis.warnings, warning]),
        },
        draft: {
            ...analysisResult.draft,
            warnings: dedupeWarnings([...analysisResult.draft.warnings, warning]),
        },
    };
}
async function validateTempArtifacts(input) {
    const analysisPath = path.join(input.tempDir, `${input.surfaceId}.analysis.json`);
    const draftPath = path.join(input.tempDir, `${input.surfaceId}.design-system.draft.json`);
    const contractPath = path.join(input.tempDir, `${input.surfaceId}.contract.json`);
    const reportPath = path.join(input.tempDir, `${input.surfaceId}.extraction.json`);
    const validatePath = path.join(input.tempDir, "validate.json");
    const validateExtractedPath = path.join(input.tempDir, "validate-extracted.json");
    await writeArtifact(analysisPath, input.analysisResult.analysis);
    await writeArtifact(draftPath, input.analysisResult.draft);
    await writeArtifact(contractPath, input.compatibilityContract);
    await writeArtifact(reportPath, input.analysisResult.extractionReport);
    const validateExitCode = await runValidateCommand({
        contractPath,
        workspaceRoot: input.rootDir,
        surfaceFilters: [input.surfaceId],
        descriptorOverrides: [input.analysisResult.descriptor],
        outputFormat: "json",
        outputPath: validatePath,
        exitCodes: "v2",
    });
    const validateExtractedExitCode = await runValidateExtractedCommand({
        contractPath,
        extractedPath: reportPath,
        surfaceId: input.surfaceId,
        format: "json",
        outputPath: validateExtractedPath,
        exitCodes: "v2",
    });
    return {
        analysisPath,
        draftPath,
        contractPath,
        reportPath,
        validateExitCode,
        validateExtractedExitCode,
        validateResult: await readJsonFile(validatePath),
        validateExtractedResult: await readJsonFile(validateExtractedPath),
    };
}
function collectAttentionMessages(analysis, validateResult, validateExtractedResult, verbose = false) {
    const gateWarnings = analysis.warnings
        .filter((warning) => warning.code.startsWith("remote.auth.") || warning.code === "remote.source.provisional")
        .map((warning) => rewritePreviewMessage(warning.message, verbose));
    const otherMessages = collectFlagMessages(analysis, validateResult, validateExtractedResult)
        .map((message) => rewritePreviewMessage(message, verbose))
        .filter((message) => !gateWarnings.includes(message));
    const items = uniqueMessages([...gateWarnings, ...otherMessages]);
    return verbose ? items.slice(0, 8) : items.slice(0, 3);
}
function printPreviewSummary(input) {
    const { analysis, validateResult, validateExtractedResult, provisional, verbose } = input;
    const draftSummary = summarizeDraft(analysis);
    const technicalDraftItems = summarizeTechnicalDraft(analysis);
    const attention = uniqueMessages([
        ...draftSummary.reviewItems,
        ...collectAttentionMessages(analysis, validateResult, validateExtractedResult, verbose),
    ]).slice(0, verbose ? 8 : 3);
    console.log("");
    console.log("What we found");
    console.log(`  - ${summarizeSurfaceKind(analysis)}`);
    console.log(`  - ${summarizeExistingSystem(analysis)}`);
    console.log(`  - ${summarizeSourceAccess(analysis)}`);
    if (verbose) {
        console.log(`  - Technical detail: surface kind confidence ${analysis.classification.confidence.toFixed(2)}.`);
        console.log(`  - Technical detail: existing-system mode ${analysis.existingSystem.mode} (${analysis.existingSystem.score.toFixed(2)} score).`);
        console.log(`  - Technical detail: source access ${analysis.sourceHealth.status} (${analysis.sourceHealth.confidence}).`);
    }
    console.log("What we'll create");
    for (const item of draftSummary.createItems) {
        console.log(`  - ${item}`);
    }
    if (draftSummary.createItems.length === 0) {
        console.log("  - We will draft a minimal system from the strongest repeated patterns we found.");
    }
    if (verbose) {
        for (const item of technicalDraftItems) {
            console.log(`  - Technical detail: ${item}`);
        }
    }
    else if (provisional && !draftSummary.createItems.some((item) => item.includes("Landing-page guidance"))) {
        console.log("  - Results will be marked provisional.");
    }
    console.log("What needs review");
    if (attention.length === 0) {
        console.log("  - No immediate issues need review before writing.");
    }
    else {
        for (const item of attention) {
            console.log(`  - ${item}`);
        }
    }
    console.log("Continue");
    console.log("  - Review this summary, then create the draft artifacts.");
    console.log("  - Press Enter to create them now, or q to cancel.");
}
function printWriteSummary(input) {
    const { rootDir, resolved, artifacts, provisional, verbose, runId, storageMode, authProfileName, } = input;
    console.log("");
    console.log("Created");
    console.log(`  - Created a first UI AST bootstrap for ${resolved.surfaceName}.`);
    if (provisional) {
        console.log("  - Results are marked provisional because the source view was limited.");
    }
    console.log("Next");
    console.log("  - Review the generated UI AST, derived compatibility contract, and compiled bundle.");
    if (resolved.sourceMode === "local-root") {
        console.log("  - Connect the local app root in interfacectl.config.json for stronger repeatable validation.");
    }
    else {
        console.log("  - Re-run with --app-root once the local checkout is available for stronger validation.");
    }
    if (verbose) {
        console.log(`  - interfacectl validate-extracted --contract ${relativeDisplay(rootDir, artifacts.contractPath)} --extracted ${relativeDisplay(rootDir, artifacts.reportPath)} --surface ${resolved.surfaceId}`);
        console.log(`  - interfacectl validate --ast ${relativeDisplay(rootDir, artifacts.astPath)} --surface ${resolved.surfaceId}`);
        console.log(`  - interfacectl compile --ast ${relativeDisplay(rootDir, artifacts.astPath)} --out-dir ${relativeDisplay(rootDir, artifacts.bundleRoot)}`);
    }
    console.log("Artifacts");
    const displayPath = (filePath) => verbose ? filePath : relativeDisplay(rootDir, filePath);
    console.log(`  - analysis: ${displayPath(artifacts.analysisPath)}`);
    console.log(`  - draft: ${displayPath(artifacts.draftPath)}`);
    console.log(`  - ast: ${displayPath(artifacts.astPath)}`);
    console.log(`  - compatibility contract: ${displayPath(artifacts.contractPath)}`);
    console.log(`  - report: ${displayPath(artifacts.reportPath)}`);
    console.log(`  - bundle: ${displayPath(artifacts.bundleRoot)}`);
    if (verbose) {
        console.log("Technical details");
        console.log(`  - Run id: ${runId}`);
        console.log(`  - Auth storage: ${storageMode}`);
        if (storageMode === "file") {
            console.log("  - Keychain unavailable; using encrypted local file storage for replay state.");
        }
        if (authProfileName) {
            console.log(`  - Auth profile: ${authProfileName}`);
        }
    }
}
function buildInitJsonSummary(input) {
    return {
        state: "completed",
        surfaceId: input.resolved.surfaceId,
        surfaceName: input.resolved.surfaceName,
        status: input.status,
        runId: input.runId,
        recommendedNextStep: "review-ui-ast",
        artifacts: {
            analysisPath: relativeDisplay(input.rootDir, input.artifacts.analysisPath),
            draftPath: relativeDisplay(input.rootDir, input.artifacts.draftPath),
            astPath: relativeDisplay(input.rootDir, input.artifacts.astPath),
            compatibilityContractPath: relativeDisplay(input.rootDir, input.artifacts.contractPath),
            extractionReportPath: relativeDisplay(input.rootDir, input.artifacts.reportPath),
            bundleRoot: relativeDisplay(input.rootDir, input.artifacts.bundleRoot),
        },
    };
}
function gateFailureMessage(analysis) {
    if (analysis.sourceHealth.status === "access-denied") {
        return "Remote onboarding stopped because we reached an access-denied page instead of the target surface. Capture auth, switch to --app-root, or pass --continue-on-gate for provisional output.";
    }
    return "Remote onboarding stopped because we reached a login page instead of the target surface. Provide --auth-profile, capture auth interactively, switch to --app-root, or pass --continue-on-gate for provisional output.";
}
function validateLocalAppRoot(rootDir, resolved) {
    if (resolved.sourceMode !== "local-root") {
        return null;
    }
    const appRoot = path.resolve(rootDir, resolved.appRoot ?? ".");
    if (!existsSync(path.join(appRoot, "app"))) {
        console.error(`Local app root is missing app/: ${appRoot}`);
        return 1;
    }
    return null;
}
export async function runInitCommand(options) {
    const rootDir = process.cwd();
    const storageMode = getAuthStorageMode();
    try {
        if (options.json === true && options.nonInteractive !== true) {
            console.error("--json requires --non-interactive.");
            return 1;
        }
        let resolved = await resolveInputs(options);
        let pendingAuthCapture;
        while (true) {
            const localRootValidation = validateLocalAppRoot(rootDir, resolved);
            if (localRootValidation !== null) {
                return localRootValidation;
            }
            logStage(1, 6, "Discovering source", options.json !== true);
            const authCapture = pendingAuthCapture ??
                (resolved.sourceMode === "remote-url" && resolved.url
                    ? await maybeCaptureAuthProfile({
                        requiresAuth: resolved.requiresAuth,
                        profileName: resolved.authProfileName,
                        url: resolved.url,
                        nonInteractive: Boolean(options.nonInteractive),
                    })
                    : { authMode: "none", storageState: undefined });
            pendingAuthCapture = undefined;
            logStage(2, 6, "Checking access", options.json !== true);
            const remoteObservation = resolved.sourceMode === "remote-url" && resolved.url
                ? await observeRemotePage({
                    url: resolved.url,
                    storageState: authCapture.storageState,
                })
                : undefined;
            const remoteSourceBlocked = resolved.sourceMode === "remote-url" &&
                remoteObservation &&
                remoteObservation.sourceHealth.status !== "ok";
            if (remoteSourceBlocked && authCapture.authMode === "browser-session") {
                console.error(remoteObservation.sourceHealth.status === "access-denied"
                    ? `Authenticated replay reached an access-denied page at ${remoteObservation.sourceHealth.finalUrl}.`
                    : `Authenticated replay still resolved to a login page at ${remoteObservation.sourceHealth.finalUrl}. Re-capture the auth profile and retry.`);
                return 1;
            }
            logStage(3, 6, "Analyzing surface kind and UI system", options.json !== true);
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
                remoteObservation,
            });
            if (remoteSourceBlocked && authCapture.authMode === "none") {
                if (options.nonInteractive && options.continueOnGate !== true) {
                    console.error(gateFailureMessage(analysisResult.analysis));
                    return 1;
                }
                if (!options.nonInteractive) {
                    const gateResolution = await promptGateResolution(analysisResult.analysis);
                    if (gateResolution === "quit") {
                        console.log("Exited onboarding before artifacts were written.");
                        return 0;
                    }
                    if (gateResolution === "switch-local-root") {
                        resolved = await promptInteractiveInitInputs({
                            extractMode: "local-root",
                            surface: resolved.surfaceId,
                            surfaceName: resolved.surfaceName,
                            surfaceKind: resolved.surfaceKind,
                            appRoot: resolved.appRoot,
                        });
                        pendingAuthCapture = undefined;
                        continue;
                    }
                    if (gateResolution === "capture-auth") {
                        pendingAuthCapture = await maybeCaptureAuthProfile({
                            requiresAuth: true,
                            profileName: resolved.authProfileName,
                            url: resolved.url,
                            nonInteractive: false,
                        });
                        resolved = {
                            ...resolved,
                            requiresAuth: true,
                            authProfileName: pendingAuthCapture.profileName ?? resolved.authProfileName,
                        };
                        continue;
                    }
                }
                analysisResult = applyProvisionalWarning(analysisResult);
            }
            if (!resolved.surfaceKind && analysisResult.analysis.classification.requiresConfirmation) {
                if (options.nonInteractive) {
                    console.error(`Surface kind inference was low confidence (${analysisResult.analysis.classification.inferredKind}, ${analysisResult.analysis.classification.confidence.toFixed(2)}). Re-run with --surface-kind marketing|application|unknown.`);
                    return 1;
                }
                const confirmedKind = await promptSurfaceKindConfirmation(analysisResult.analysis);
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
                        remoteObservation,
                    });
                    if (remoteSourceBlocked && authCapture.authMode === "none" && (options.continueOnGate === true || !options.nonInteractive)) {
                        analysisResult = applyProvisionalWarning(analysisResult);
                    }
                }
            }
            const structure = validateContractStructure(analysisResult.contract, getBundledContractSchema());
            if (!structure.ok) {
                console.error("Generated contract failed schema validation:");
                for (const issue of structure.errors) {
                    console.error(`  ${issue}`);
                }
                return 1;
            }
            const astDraft = normalizeUiAst(migrateLegacyContractToUiAst(analysisResult.contract));
            const astStructure = validateUiAstStructure(astDraft, getBundledUiAstSchema());
            if (!astStructure.ok || !astStructure.ast) {
                console.error("Generated UI AST failed schema validation:");
                for (const issue of astStructure.errors) {
                    console.error(`  ${issue}`);
                }
                return 1;
            }
            const compatibilityContract = normalizeContract(deriveLegacyContractFromUiAst(astStructure.ast)).contract;
            logStage(4, 6, "Validating generated outputs", options.json !== true);
            const tempDir = await mkdtemp(path.join(os.tmpdir(), "interfacectl-init-preview-"));
            try {
                const validation = await validateTempArtifacts({
                    tempDir,
                    rootDir,
                    surfaceId: resolved.surfaceId,
                    analysisResult,
                    compatibilityContract,
                });
                const blockingValidationError = hasBlockingValidationError(validation.validateResult, validation.validateExtractedResult);
                if (blockingValidationError) {
                    console.error("Generated outputs failed blocking validation:");
                    for (const message of collectAttentionMessages(analysisResult.analysis, validation.validateResult, validation.validateExtractedResult)) {
                        console.error(`  - ${message}`);
                    }
                    return 1;
                }
                logStage(5, 6, "Previewing generated draft", options.json !== true);
                if (!options.nonInteractive) {
                    printPreviewSummary({
                        analysis: analysisResult.analysis,
                        validateResult: validation.validateResult,
                        validateExtractedResult: validation.validateExtractedResult,
                        provisional: isLimitedRemoteSource(analysisResult.analysis),
                        verbose: options.verbose === true,
                    });
                    const confirmedWrite = await promptWriteConfirmation();
                    if (!confirmedWrite) {
                        console.log("Exited onboarding before artifacts were written.");
                        return 0;
                    }
                }
                logStage(6, 6, "Writing onboarding artifacts", options.json !== true);
                const artifacts = resolveArtifactPaths(rootDir, resolved.surfaceId, options);
                await writeArtifact(artifacts.analysisPath, analysisResult.analysis);
                await writeArtifact(artifacts.draftPath, analysisResult.draft);
                await writeArtifact(artifacts.astPath, astStructure.ast);
                await writeArtifact(artifacts.contractPath, compatibilityContract);
                await writeArtifact(artifacts.reportPath, analysisResult.extractionReport);
                const compileExitCode = await runCompileCommand({
                    astPath: artifacts.astPath,
                    outDir: artifacts.bundleRoot,
                }, options.toolVersion ?? "0.0.0");
                if (compileExitCode !== 0) {
                    return compileExitCode;
                }
                const findingCodes = collectFindingCodes(analysisResult.analysis, validation.validateResult, validation.validateExtractedResult);
                const status = findingCodes.length > 0
                    ? "warn"
                    : "pass";
                const run = await emitOnboardingRunArtifact({
                    rootDir,
                    surfaceId: resolved.surfaceId,
                    source: "bootstrap",
                    status,
                    findingCodes,
                    extractionPath: artifacts.contractPath,
                    reportPath: artifacts.reportPath,
                });
                if (options.json) {
                    console.log(JSON.stringify(buildInitJsonSummary({
                        rootDir,
                        resolved,
                        artifacts,
                        runId: run.runId,
                        status,
                    }), null, 2));
                    return 0;
                }
                printWriteSummary({
                    rootDir,
                    resolved,
                    artifacts,
                    provisional: isLimitedRemoteSource(analysisResult.analysis),
                    verbose: options.verbose === true,
                    runId: run.runId,
                    storageMode,
                    authProfileName: authCapture.profileName,
                });
                return 0;
            }
            finally {
                await rm(tempDir, { recursive: true, force: true });
            }
        }
    }
    catch (error) {
        console.error(redactSensitiveText(error.message));
        return 1;
    }
}
