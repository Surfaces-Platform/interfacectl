import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { AdapterInputError, isRecord, loadCompiledSurfaceBundle, readJsonFile, } from "../adapter/bundle.js";
import { runGenerationAdapter } from "../adapter/core.js";
import { buildPreparedGenerationPayload } from "./prepare-generation.js";
import { emitContractRunArtifact, } from "../utils/run-artifacts.js";
import { writeDeterministicJsonSync } from "../utils/deterministic-json.js";
const VALID_TOOLS = new Set(["codex", "cursor", "local-llm"]);
const VALID_GRADES = new Set(["strong", "partial", "weak"]);
const VALID_GUIDANCE_STRATEGIES = new Set(["prompt-summary", "json-primary", "unguided"]);
const VALID_REVIEW_STATUSES = new Set(["accepted", "rejected"]);
const VALID_SUGGESTION_STATUSES = new Set(["proposed", "accepted", "rejected"]);
const VALID_SUCCESS_RULES = new Set(["pass", "pass-or-reviewed-warn"]);
const ASSESSMENT_DIMENSIONS = [
    "structure",
    "components",
    "boundary",
    "visual",
    "responsiveness",
];
class SessionInputError extends Error {
    code;
    constructor(message, code = "generation-session.input") {
        super(message);
        this.name = "SessionInputError";
        this.code = code;
    }
}
function writeError(error, code) {
    process.stderr.write(`${JSON.stringify({
        status: "error",
        code,
        error: error.message,
    }, null, 2)}\n`);
}
function asRecord(value) {
    return isRecord(value) ? value : {};
}
function asString(value) {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
function asStringArray(value) {
    if (!Array.isArray(value))
        return [];
    return [...new Set(value
            .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
            .filter(Boolean))].sort((left, right) => left.localeCompare(right));
}
function sameStringSet(left, right) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}
function countBySeverity(validatePayload) {
    const findings = Array.isArray(validatePayload.findings) ? validatePayload.findings : [];
    let errors = 0;
    let warnings = 0;
    for (const finding of findings) {
        if (!finding || typeof finding !== "object")
            continue;
        const severity = finding.severity;
        if (severity === "error") {
            errors += 1;
        }
        else if (severity === "warning") {
            warnings += 1;
        }
    }
    return { errors, warnings, total: errors + warnings };
}
function ensureSessionTool(tool) {
    const normalized = typeof tool === "string" ? tool.trim().toLowerCase() : "codex";
    if (!VALID_TOOLS.has(normalized)) {
        throw new SessionInputError(`Invalid --tool value "${tool ?? ""}". Expected codex|cursor|local-llm.`);
    }
    return normalized;
}
function ensureGuidanceStrategy(guidanceStrategy) {
    const normalized = typeof guidanceStrategy === "string" ? guidanceStrategy.trim().toLowerCase() : "prompt-summary";
    const mapped = normalized === "prepared" ? "prompt-summary" : normalized;
    if (!VALID_GUIDANCE_STRATEGIES.has(mapped)) {
        throw new SessionInputError(`Invalid guidance strategy "${guidanceStrategy ?? ""}". Expected prompt-summary|json-primary|unguided.`);
    }
    return mapped;
}
function buildDefaultSessionId() {
    return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}
function resolveWorkspaceRelative(workspaceRoot, candidate) {
    if (!candidate || candidate.trim().length === 0) {
        return path.join(workspaceRoot, "artifacts", "generation-sessions");
    }
    return path.isAbsolute(candidate) ? candidate : path.resolve(workspaceRoot, candidate);
}
function getSessionPaths(sessionDir) {
    return {
        sessionDir,
        sessionPath: path.join(sessionDir, "session.json"),
        bundleRoot: path.join(sessionDir, "bundle"),
        preparedInputPath: path.join(sessionDir, "prepared-input.json"),
        guidanceHandoffPath: path.join(sessionDir, "guidance-handoff.json"),
        attemptsDir: path.join(sessionDir, "attempts"),
        summaryJsonPath: path.join(sessionDir, "summary.json"),
        summaryMarkdownPath: path.join(sessionDir, "summary.md"),
        suggestionsJsonPath: path.join(sessionDir, "contract-delta-suggestions.json"),
        suggestionsMarkdownPath: path.join(sessionDir, "contract-delta-suggestions.md"),
    };
}
function getAttemptPaths(attemptsDir, attemptNumber) {
    const attemptId = formatAttemptNumber(attemptNumber);
    return {
        validatePath: path.join(attemptsDir, `${attemptId}.validate.json`),
        assessmentPath: path.join(attemptsDir, `${attemptId}.assessment.json`),
        metadataPath: path.join(attemptsDir, `${attemptId}.metadata.json`),
        reviewPath: path.join(attemptsDir, `${attemptId}.review.json`),
        previewMetadataPath: path.join(attemptsDir, `${attemptId}.preview.json`),
        previewImagePath: path.join(attemptsDir, `${attemptId}.preview.png`),
    };
}
function normalizeAssessment(payload, filePath, options = {}) {
    const structureFallback = payload.structure;
    const grade = (key) => {
        let value = payload[key];
        if (value === undefined && options.allowLegacyMissing && (key === "components" || key === "boundary")) {
            value = structureFallback;
        }
        if (!VALID_GRADES.has(value)) {
            throw new SessionInputError(`Assessment field "${key}" must be one of strong|partial|weak: ${filePath}.`);
        }
        return value;
    };
    const notes = typeof payload.notes === "string" ? payload.notes.trim() : "";
    if (!notes) {
        throw new SessionInputError(`Assessment field "notes" must be a non-empty string: ${filePath}.`);
    }
    let touchedFiles;
    if (payload.touchedFiles !== undefined) {
        if (!Array.isArray(payload.touchedFiles)) {
            throw new SessionInputError(`Assessment field "touchedFiles" must be an array when provided: ${filePath}.`);
        }
        touchedFiles = [...new Set(payload.touchedFiles
                .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
                .filter(Boolean))].sort((left, right) => left.localeCompare(right));
    }
    let heuristics;
    if (payload.heuristics !== undefined) {
        const candidate = asRecord(payload.heuristics);
        heuristics = {};
        const numericField = (key, allowNull = false) => {
            const value = candidate[key];
            if (value === undefined) {
                return;
            }
            if (value === null && allowNull) {
                heuristics[key] = null;
                return;
            }
            if (typeof value !== "number" || !Number.isFinite(value)) {
                throw new SessionInputError(`Assessment heuristic "${String(key)}" must be a finite number${allowNull ? " or null" : ""}: ${filePath}.`);
            }
            heuristics[key] = value;
        };
        numericField("unresolvedAcceptedSuggestionCount");
        numericField("unresolvedAcceptedSuggestionRate", true);
        numericField("noChangesAfterEditFailureCount");
        numericField("recoverableToolErrorCount");
        numericField("touchedFilesPerResolvedFinding", true);
        if (Object.keys(heuristics).length === 0) {
            heuristics = undefined;
        }
    }
    return {
        structure: grade("structure"),
        components: grade("components"),
        boundary: grade("boundary"),
        visual: grade("visual"),
        responsiveness: grade("responsiveness"),
        notes,
        ...(touchedFiles && touchedFiles.length > 0 ? { touchedFiles } : {}),
        ...(heuristics ? { heuristics } : {}),
    };
}
function loadAssessment(assessmentPath) {
    const resolvedPath = path.resolve(assessmentPath);
    if (!fs.existsSync(resolvedPath)) {
        throw new SessionInputError(`Assessment file not found at ${resolvedPath}.`);
    }
    return normalizeAssessment(readJsonFile(resolvedPath, "generation assessment"), resolvedPath);
}
function loadStoredAttemptReview(reviewPath) {
    if (!fs.existsSync(reviewPath)) {
        return null;
    }
    const payload = readJsonFile(reviewPath, "generation attempt review");
    const status = payload.status;
    if (!VALID_REVIEW_STATUSES.has(status)) {
        throw new SessionInputError(`Unsupported review status in ${reviewPath}.`);
    }
    const rationale = typeof payload.rationale === "string" ? payload.rationale.trim() : "";
    if (!rationale) {
        throw new SessionInputError(`Review rationale must be a non-empty string: ${reviewPath}.`);
    }
    return {
        schemaVersion: 1,
        surfaceId: asString(payload.surfaceId) ?? "",
        sessionId: asString(payload.sessionId) ?? "",
        attemptNumber: Number(payload.attemptNumber),
        status: status,
        findingCodes: asStringArray(payload.findingCodes),
        rationale,
        reviewedAt: asString(payload.reviewedAt) ?? "",
    };
}
function loadStoredAttemptPreview(previewMetadataPath, previewImagePath) {
    if (!fs.existsSync(previewMetadataPath)) {
        return null;
    }
    if (!fs.existsSync(previewImagePath)) {
        throw new SessionInputError(`Preview image not found at ${previewImagePath}.`);
    }
    const payload = readJsonFile(previewMetadataPath, "generation attempt preview");
    const pageTitle = asString(payload.pageTitle);
    const waitFor = asString(payload.waitFor);
    const viewport = asRecord(payload.viewport);
    const width = Number(viewport.width);
    const height = Number(viewport.height);
    if (!Number.isFinite(width) || width < 1 || !Number.isFinite(height) || height < 1) {
        throw new SessionInputError(`Preview viewport is invalid in ${previewMetadataPath}.`);
    }
    const preview = {
        schemaVersion: 1,
        surfaceId: asString(payload.surfaceId) ?? "",
        sessionId: asString(payload.sessionId) ?? "",
        attemptNumber: Number(payload.attemptNumber),
        url: asString(payload.url) ?? "",
        finalUrl: asString(payload.finalUrl) ?? "",
        imagePath: asString(payload.imagePath) ?? previewImagePath,
        capturedAt: asString(payload.capturedAt) ?? "",
        viewport: {
            width,
            height,
        },
        ...(pageTitle ? { pageTitle } : {}),
        ...(waitFor ? { waitFor } : {}),
    };
    if (preview.attemptNumber < 1 ||
        !preview.surfaceId ||
        !preview.sessionId ||
        !preview.url ||
        !preview.finalUrl ||
        !preview.imagePath ||
        !preview.capturedAt) {
        throw new SessionInputError(`Generation attempt preview is missing required fields: ${previewMetadataPath}.`);
    }
    return preview;
}
function toPreviewReference(preview, previewMetadataPath) {
    if (!preview || !previewMetadataPath) {
        return undefined;
    }
    return {
        imagePath: preview.imagePath,
        metadataPath: previewMetadataPath,
        url: preview.url,
        finalUrl: preview.finalUrl,
        capturedAt: preview.capturedAt,
        ...(preview.waitFor ? { waitFor: preview.waitFor } : {}),
    };
}
function normalizeReviewInput(payload, filePath, findingCodes) {
    const status = payload.status;
    if (!VALID_REVIEW_STATUSES.has(status)) {
        throw new SessionInputError(`Review field "status" must be accepted|rejected: ${filePath}.`);
    }
    const rationale = typeof payload.rationale === "string" ? payload.rationale.trim() : "";
    if (!rationale) {
        throw new SessionInputError(`Review field "rationale" must be a non-empty string: ${filePath}.`);
    }
    const reviewedCodes = asStringArray(payload.findingCodes);
    if (reviewedCodes.length === 0) {
        throw new SessionInputError(`Review field "findingCodes" must list the reviewed findings: ${filePath}.`);
    }
    for (const code of reviewedCodes) {
        if (!findingCodes.includes(code)) {
            throw new SessionInputError(`Review field "findingCodes" includes unknown finding code "${code}": ${filePath}.`);
        }
    }
    if (status === "accepted" && !sameStringSet(reviewedCodes, findingCodes)) {
        throw new SessionInputError(`Accepted warn reviews must cover every remaining finding code: ${filePath}.`);
    }
    return {
        status: status,
        findingCodes: reviewedCodes,
        rationale,
    };
}
function loadSession(sessionDirInput) {
    const sessionDir = path.resolve(sessionDirInput);
    const paths = getSessionPaths(sessionDir);
    if (!fs.existsSync(paths.sessionPath)) {
        throw new SessionInputError(`Generation session not found at ${paths.sessionPath}.`);
    }
    const payload = readJsonFile(paths.sessionPath, "generation session");
    const schemaVersion = Number(payload.schemaVersion ?? 1);
    if (schemaVersion !== 1 && schemaVersion !== 2 && schemaVersion !== 3) {
        throw new SessionInputError(`Unsupported generation session schemaVersion "${String(payload.schemaVersion ?? "unknown")}".`);
    }
    const tool = ensureSessionTool(asString(payload.tool));
    const guidanceStrategy = ensureGuidanceStrategy(asString(payload.guidanceStrategy) ?? asString(payload.guidanceMode) ?? "prompt-summary");
    const finalStatus = asString(asRecord(payload.successRule).finalStatus) ?? "pass";
    if (!VALID_SUCCESS_RULES.has(finalStatus)) {
        throw new SessionInputError(`Unsupported session successRule.finalStatus "${finalStatus}".`);
    }
    const briefRecord = asRecord(payload.brief);
    const briefPath = asString(briefRecord.path);
    const briefSha256 = asString(briefRecord.sha256);
    const guidanceArtifacts = asRecord(payload.guidanceArtifacts);
    const session = {
        schemaVersion: 3,
        surfaceId: asString(payload.surfaceId) ?? "",
        sessionId: asString(payload.sessionId) ?? "",
        tool,
        guidanceStrategy,
        workspaceRoot: asString(payload.workspaceRoot) ?? "",
        sourceBundleRoot: asString(payload.sourceBundleRoot) ?? "",
        sessionDir: asString(payload.sessionDir) ?? sessionDir,
        bundleRoot: asString(payload.bundleRoot) ?? "",
        preparedInputPath: typeof payload.preparedInputPath === "string" ? payload.preparedInputPath : null,
        contractPath: asString(payload.contractPath) ?? "",
        repairMapPath: asString(payload.repairMapPath) ?? "",
        guidanceArtifacts: {
            baseHandoffPath: typeof guidanceArtifacts.baseHandoffPath === "string"
                ? guidanceArtifacts.baseHandoffPath
                : fs.existsSync(paths.guidanceHandoffPath)
                    ? paths.guidanceHandoffPath
                    : null,
        },
        startedAt: asString(payload.startedAt) ?? "",
        ...(briefPath && briefSha256 ? { brief: { path: briefPath, sha256: briefSha256 } } : {}),
        successRule: {
            finalStatus: finalStatus,
        },
    };
    if (!session.surfaceId
        || !session.sessionId
        || !session.workspaceRoot
        || !session.bundleRoot
        || !session.contractPath
        || !session.repairMapPath
        || !session.startedAt) {
        throw new SessionInputError(`Generation session is missing required fields: ${paths.sessionPath}.`);
    }
    return {
        session,
        paths,
    };
}
function toBrowserLaunchError(error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/Executable doesn't exist|browserType\.launch/i.test(message)) {
        return new Error(`Playwright Chromium is not installed. Run "pnpm exec playwright install chromium" in /Users/mike/SurfacesPlatform/interfacectl.`);
    }
    return error instanceof Error ? error : new Error(message);
}
async function waitForPageSettle(page) {
    await page.waitForLoadState("domcontentloaded");
    await page.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => undefined);
    await page.waitForTimeout(300);
}
async function waitForPreviewCondition(page, waitFor) {
    const timeout = 5_000;
    try {
        await page.locator(waitFor).first().waitFor({ state: "visible", timeout });
        return;
    }
    catch (selectorError) {
        try {
            await page.getByText(waitFor, { exact: false }).first().waitFor({ state: "visible", timeout });
            return;
        }
        catch (textError) {
            const selectorMessage = selectorError instanceof Error ? selectorError.message : String(selectorError);
            const textMessage = textError instanceof Error ? textError.message : String(textError);
            throw new SessionInputError(`Preview wait condition "${waitFor}" was not satisfied. Selector error: ${selectorMessage}. Text error: ${textMessage}.`);
        }
    }
}
function nextAttemptNumber(attemptsDir) {
    if (!fs.existsSync(attemptsDir)) {
        return 1;
    }
    const seen = fs.readdirSync(attemptsDir)
        .map((entry) => /^(\d{3})\.metadata\.json$/.exec(entry))
        .filter((match) => Boolean(match))
        .map((match) => Number.parseInt(match[1], 10));
    if (seen.length === 0) {
        return 1;
    }
    return Math.max(...seen) + 1;
}
function formatAttemptNumber(attemptNumber) {
    return String(attemptNumber).padStart(3, "0");
}
function mapAdapterStatusToRunStatus(status) {
    switch (status) {
        case "pass":
            return "pass";
        case "warn":
            return "warn";
        case "block":
            return "fail";
    }
}
function parseFindingCodes(validatePayload) {
    const findings = Array.isArray(validatePayload.findings) ? validatePayload.findings : [];
    return [...new Set(findings
            .map((finding) => {
            if (!finding || typeof finding !== "object")
                return "";
            const code = finding.code;
            return typeof code === "string" ? code : "";
        })
            .filter(Boolean))].sort((left, right) => left.localeCompare(right));
}
function buildRecurringCounts(values) {
    const counts = new Map();
    for (const value of values) {
        counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return [...counts.entries()]
        .filter(([, count]) => count > 1)
        .map(([code, count]) => ({ code, count }))
        .sort((left, right) => right.count - left.count || left.code.localeCompare(right.code));
}
function repeatedFindingCarryoverCount(recurringFindingCodes) {
    return recurringFindingCodes.reduce((total, entry) => total + Math.max(0, entry.count - 1), 0);
}
function rerunsToAcceptableOutcome(firstAcceptableAttempt) {
    if (firstAcceptableAttempt === null) {
        return null;
    }
    return Math.max(0, firstAcceptableAttempt - 1);
}
function numericHeuristicDelta(baseline, guided) {
    if (baseline === null || baseline === undefined || guided === null || guided === undefined) {
        return null;
    }
    return guided - baseline;
}
function countHeuristicImprovement(values) {
    return values.reduce((total, value) => total + (typeof value === "number" && value < 0 ? 1 : 0), 0);
}
function averageNullable(values) {
    const filtered = values.filter((value) => typeof value === "number" && Number.isFinite(value));
    if (filtered.length === 0) {
        return null;
    }
    return Math.round((filtered.reduce((sum, value) => sum + value, 0) / filtered.length) * 1000) / 1000;
}
function renderSummaryMarkdown(summary) {
    const lines = [
        "# Generation Session Summary",
        "",
        `Surface: ${summary.surfaceId}`,
        `Session: ${summary.sessionId}`,
        `Tool: ${summary.tool}`,
        `Guidance strategy: ${summary.guidanceStrategy}`,
        `Latest status: ${summary.latestStatus}`,
        `Latest outcome: ${summary.latestOutcome}`,
        `Attempts: ${summary.attemptCount}`,
        `First pass attempt: ${summary.firstPassAttempt ?? "not yet reached"}`,
        `First acceptable attempt: ${summary.firstAcceptableAttempt ?? "not yet reached"}`,
        "",
        "## Recurring finding codes",
    ];
    if (summary.recurringFindingCodes.length === 0) {
        lines.push("None.");
    }
    else {
        for (const item of summary.recurringFindingCodes) {
            lines.push(`- ${item.code}: ${item.count}`);
        }
    }
    lines.push("", "## Recurring repair codes");
    if (summary.recurringRepairCodes.length === 0) {
        lines.push("None.");
    }
    else {
        for (const item of summary.recurringRepairCodes) {
            lines.push(`- ${item.code}: ${item.count} (${item.priority})`);
        }
    }
    lines.push("", "## Latest assessment");
    lines.push(`- structure: ${summary.latestAssessment?.structure ?? "n/a"}`);
    lines.push(`- components: ${summary.latestAssessment?.components ?? "n/a"}`);
    lines.push(`- boundary: ${summary.latestAssessment?.boundary ?? "n/a"}`);
    lines.push(`- visual: ${summary.latestAssessment?.visual ?? "n/a"}`);
    lines.push(`- responsiveness: ${summary.latestAssessment?.responsiveness ?? "n/a"}`);
    lines.push(`- notes: ${summary.latestAssessment?.notes ?? "n/a"}`);
    if (summary.latestAssessment?.touchedFiles?.length) {
        lines.push(`- touched files: ${summary.latestAssessment.touchedFiles.join(", ")}`);
    }
    if (summary.latestAssessment?.heuristics) {
        if (typeof summary.latestAssessment.heuristics.unresolvedAcceptedSuggestionRate === "number") {
            lines.push(`- unresolved accepted suggestion rate: ${summary.latestAssessment.heuristics.unresolvedAcceptedSuggestionRate}`);
        }
        if (typeof summary.latestAssessment.heuristics.noChangesAfterEditFailureCount === "number") {
            lines.push(`- noChanges-after-edit failures: ${summary.latestAssessment.heuristics.noChangesAfterEditFailureCount}`);
        }
        if (typeof summary.latestAssessment.heuristics.recoverableToolErrorCount === "number") {
            lines.push(`- recoverable tool errors: ${summary.latestAssessment.heuristics.recoverableToolErrorCount}`);
        }
        if (typeof summary.latestAssessment.heuristics.touchedFilesPerResolvedFinding === "number") {
            lines.push(`- touched files per resolved finding: ${summary.latestAssessment.heuristics.touchedFilesPerResolvedFinding}`);
        }
    }
    if (summary.latestReview) {
        lines.push(`- latest review: ${summary.latestReview.status} (${summary.latestReview.findingCodes.join(", ")})`);
        lines.push(`- review rationale: ${summary.latestReview.rationale}`);
    }
    lines.push("", "## Heuristics");
    lines.push(`- repeated finding carryover count: ${summary.heuristics.repeatedFindingCarryoverCount}`);
    lines.push(`- reruns to acceptable outcome: ${summary.heuristics.rerunsToAcceptableOutcome ?? "n/a"}`);
    lines.push(`- base guidance handoff: ${summary.paths.guidanceHandoffPath ?? "none"}`);
    return `${lines.join("\n")}\n`;
}
function getSuccessOutcome(status, review, findingCodes, successRule) {
    if (status === "pass") {
        return "pass";
    }
    if (status === "warn" &&
        successRule === "pass-or-reviewed-warn" &&
        review &&
        review.status === "accepted" &&
        sameStringSet(review.findingCodes, findingCodes)) {
        return "accepted-warn";
    }
    return status;
}
function loadAttemptRecords(paths) {
    if (!fs.existsSync(paths.attemptsDir)) {
        return [];
    }
    const attemptNumbers = fs.readdirSync(paths.attemptsDir)
        .map((entry) => /^(\d{3})\.metadata\.json$/.exec(entry))
        .filter((match) => Boolean(match))
        .map((match) => Number.parseInt(match[1], 10))
        .sort((left, right) => left - right);
    return attemptNumbers.map((attemptNumber) => {
        const attemptPaths = getAttemptPaths(paths.attemptsDir, attemptNumber);
        const review = loadStoredAttemptReview(attemptPaths.reviewPath);
        const preview = loadStoredAttemptPreview(attemptPaths.previewMetadataPath, attemptPaths.previewImagePath);
        return {
            attemptNumber,
            validate: readJsonFile(attemptPaths.validatePath, `attempt ${attemptNumber} validate payload`),
            assessment: readJsonFile(attemptPaths.assessmentPath, `attempt ${attemptNumber} assessment`),
            metadata: readJsonFile(attemptPaths.metadataPath, `attempt ${attemptNumber} metadata`),
            review,
            preview,
            validatePath: attemptPaths.validatePath,
            assessmentPath: attemptPaths.assessmentPath,
            metadataPath: attemptPaths.metadataPath,
            ...(review ? { reviewPath: attemptPaths.reviewPath } : {}),
            ...(preview ? { previewMetadataPath: attemptPaths.previewMetadataPath } : {}),
        };
    });
}
function buildGenerationSessionSummary(sessionDirInput) {
    const { session, paths } = loadSession(sessionDirInput);
    const attempts = loadAttemptRecords(paths);
    if (attempts.length === 0) {
        throw new SessionInputError(`No attempts recorded for session ${session.sessionId}.`);
    }
    const firstPassAttempt = attempts.find((attempt) => attempt.validate.status === "pass")?.attemptNumber ?? null;
    const firstAcceptableAttempt = attempts.find((attempt) => {
        const status = attempt.validate.status;
        if (status !== "pass" && status !== "warn" && status !== "block") {
            throw new SessionInputError(`Unsupported validate status "${String(status)}" in ${attempt.validatePath}.`);
        }
        const outcome = getSuccessOutcome(status, attempt.review, parseFindingCodes(attempt.validate), session.successRule.finalStatus);
        return outcome === "pass" || outcome === "accepted-warn";
    })?.attemptNumber ?? null;
    const latestAttempt = attempts[attempts.length - 1];
    const recurringFindingCodes = buildRecurringCounts(attempts.flatMap((attempt) => parseFindingCodes(attempt.validate)));
    const repairMapDoc = readJsonFile(session.repairMapPath, "repair map");
    const repairs = Array.isArray(repairMapDoc.repairs) ? repairMapDoc.repairs : [];
    const repairMapByCode = new Map(repairs
        .filter((entry) => Boolean(entry) && typeof entry === "object")
        .map((entry) => [typeof entry.code === "string" ? entry.code : "", entry])
        .filter(([code]) => Boolean(code)));
    const recurringRepairCodes = recurringFindingCodes
        .map((entry) => {
        const repair = repairMapByCode.get(entry.code);
        if (!repair)
            return undefined;
        const action = repair.action && typeof repair.action === "object"
            ? repair.action
            : {};
        return {
            code: entry.code,
            count: entry.count,
            priority: typeof repair.priority === "string" ? repair.priority : "medium",
            category: typeof repair.category === "string" ? repair.category : "unknown",
            actionType: typeof action.type === "string" ? action.type : "unknown",
        };
    })
        .filter((entry) => Boolean(entry))
        .sort((left, right) => right.count - left.count || left.code.localeCompare(right.code));
    const latestAssessment = normalizeAssessment(latestAttempt.assessment, latestAttempt.assessmentPath, {
        allowLegacyMissing: true,
    });
    const latestStatus = latestAttempt.validate.status;
    if (latestStatus !== "pass" && latestStatus !== "warn" && latestStatus !== "block") {
        throw new SessionInputError(`Unsupported validate status "${String(latestStatus)}" in ${latestAttempt.validatePath}.`);
    }
    const latestOutcome = getSuccessOutcome(latestStatus, latestAttempt.review, parseFindingCodes(latestAttempt.validate), session.successRule.finalStatus);
    const heuristics = {
        latestAttempt: latestAssessment.heuristics ?? {},
        repeatedFindingCarryoverCount: repeatedFindingCarryoverCount(recurringFindingCodes),
        rerunsToAcceptableOutcome: rerunsToAcceptableOutcome(firstAcceptableAttempt),
    };
    const summary = {
        schemaVersion: 4,
        surfaceId: session.surfaceId,
        sessionId: session.sessionId,
        tool: session.tool,
        guidanceStrategy: session.guidanceStrategy,
        attemptCount: attempts.length,
        firstPassAttempt,
        firstAcceptableAttempt,
        latestStatus,
        latestOutcome,
        recurringFindingCodes,
        recurringRepairCodes,
        latestAssessment,
        latestReview: latestAttempt.review,
        heuristics,
        ...(session.brief ? { brief: session.brief } : {}),
        successRule: session.successRule,
        paths: {
            sessionPath: paths.sessionPath,
            bundleRoot: session.bundleRoot,
            preparedInputPath: session.preparedInputPath,
            guidanceHandoffPath: session.guidanceArtifacts.baseHandoffPath,
        },
        attempts: attempts.map((attempt) => {
            const status = attempt.validate.status;
            if (status !== "pass" && status !== "warn" && status !== "block") {
                throw new SessionInputError(`Unsupported validate status "${String(status)}" in ${attempt.validatePath}.`);
            }
            const findingCodes = parseFindingCodes(attempt.validate);
            return {
                attemptNumber: attempt.attemptNumber,
                status,
                outcome: getSuccessOutcome(status, attempt.review, findingCodes, session.successRule.finalStatus),
                findingCodes,
                validatePath: attempt.validatePath,
                assessmentPath: attempt.assessmentPath,
                metadataPath: attempt.metadataPath,
                ...(attempt.reviewPath ? { reviewPath: attempt.reviewPath } : {}),
                ...(attempt.review ? { reviewStatus: attempt.review.status } : {}),
                createdAt: typeof attempt.metadata.createdAt === "string" ? attempt.metadata.createdAt : undefined,
                ...(toPreviewReference(attempt.preview, attempt.previewMetadataPath)
                    ? { preview: toPreviewReference(attempt.preview, attempt.previewMetadataPath) }
                    : {}),
            };
        }),
    };
    return {
        session,
        paths,
        attempts,
        summary,
    };
}
function toComparisonAttemptSnapshot(attempt, successRule) {
    const status = attempt.validate.status;
    if (status !== "pass" && status !== "warn" && status !== "block") {
        throw new SessionInputError(`Unsupported validate status "${String(status)}" in ${attempt.validatePath}.`);
    }
    const findingCodes = parseFindingCodes(attempt.validate);
    const counts = countBySeverity(attempt.validate);
    return {
        attemptNumber: attempt.attemptNumber,
        status,
        outcome: getSuccessOutcome(status, attempt.review, findingCodes, successRule),
        findingCount: counts.total,
        blockingFindingCount: counts.errors,
        warningFindingCount: counts.warnings,
        findingCodes,
        assessment: normalizeAssessment(attempt.assessment, attempt.assessmentPath, { allowLegacyMissing: true }),
        ...(toPreviewReference(attempt.preview, attempt.previewMetadataPath)
            ? { preview: toPreviewReference(attempt.preview, attempt.previewMetadataPath) }
            : {}),
    };
}
function gradeToScore(grade) {
    switch (grade) {
        case "weak":
            return 0;
        case "partial":
            return 1;
        case "strong":
            return 2;
    }
}
function getRepairPriorityRank(priority) {
    switch (priority) {
        case "high":
            return 0;
        case "medium":
            return 1;
        case "low":
            return 2;
        default:
            return 3;
    }
}
function renderComparisonMarkdown(comparison) {
    const lines = [
        "# Generation Session Comparison",
        "",
        `Surface: ${comparison.surfaceId}`,
        `Tool: ${comparison.tool}`,
        `Baseline session: ${comparison.baseline.sessionId} (${comparison.baseline.guidanceStrategy})`,
        `Candidate session: ${comparison.guided.sessionId} (${comparison.guided.guidanceStrategy})`,
        `Meets goal: ${comparison.checks.meetsGoal ? "yes" : "no"}`,
        "",
        "## First attempt",
        `- baseline outcome: ${comparison.baseline.firstAttempt.outcome}`,
        `- candidate outcome: ${comparison.guided.firstAttempt.outcome}`,
        `- blocking finding delta: ${comparison.delta.firstAttemptBlockingFindingCountDelta}`,
        `- warning finding delta: ${comparison.delta.firstAttemptWarningFindingCountDelta}`,
        "",
        "## Convergence",
        `- baseline first acceptable attempt: ${comparison.baseline.firstAcceptableAttempt ?? "not reached"}`,
        `- candidate first acceptable attempt: ${comparison.guided.firstAcceptableAttempt ?? "not reached"}`,
        `- attempts-to-acceptable delta: ${comparison.delta.attemptsToAcceptableOutcome.delta ?? "n/a"}`,
        "",
        "## Rubric delta",
    ];
    for (const dimension of ASSESSMENT_DIMENSIONS) {
        const rubric = comparison.delta.rubric[dimension];
        lines.push(`- ${dimension}: ${rubric.baseline} -> ${rubric.guided} (${rubric.delta})`);
    }
    if (comparison.checks.guidedRubricBetterDimensions.length > 0) {
        lines.push("", `Candidate improved dimensions: ${comparison.checks.guidedRubricBetterDimensions.join(", ")}`);
    }
    lines.push("", "## Heuristics");
    lines.push(`- unresolved accepted suggestion rate delta: ${comparison.heuristics.delta.unresolvedAcceptedSuggestionRate ?? "n/a"}`);
    lines.push(`- noChanges-after-edit failure delta: ${comparison.heuristics.delta.noChangesAfterEditFailureCount}`);
    lines.push(`- recoverable tool error delta: ${comparison.heuristics.delta.recoverableToolErrorCount}`);
    lines.push(`- touched files per resolved finding delta: ${comparison.heuristics.delta.touchedFilesPerResolvedFinding ?? "n/a"}`);
    lines.push(`- repeated finding carryover delta: ${comparison.heuristics.delta.repeatedFindingCarryoverCount}`);
    lines.push(`- reruns to acceptable delta: ${comparison.heuristics.delta.rerunsToAcceptableOutcome ?? "n/a"}`);
    return `${lines.join("\n")}\n`;
}
function renderSuggestionsMarkdown(artifact) {
    const lines = [
        "# Contract Delta Suggestions",
        "",
        `Surface: ${artifact.surfaceId}`,
        `Session: ${artifact.sessionId}`,
        `Tool: ${artifact.tool}`,
        `Guidance strategy: ${artifact.guidanceStrategy}`,
        "",
    ];
    if (artifact.suggestions.length === 0) {
        lines.push("No suggestions.");
        return `${lines.join("\n")}\n`;
    }
    for (const suggestion of artifact.suggestions) {
        lines.push(`## ${suggestion.suggestionId}`);
        lines.push(`- finding: ${suggestion.findingCode}`);
        lines.push(`- status: ${suggestion.status}`);
        lines.push(`- repeated failures: ${suggestion.repeatedFailureCount}`);
        lines.push(`- confidence: ${suggestion.confidence}`);
        lines.push(`- contract path: ${suggestion.proposedChange.path}`);
        lines.push(`- action: ${suggestion.proposedChange.actionType}`);
        lines.push(`- summary: ${suggestion.proposedChange.summary}`);
        if (suggestion.decision) {
            lines.push(`- rationale: ${suggestion.decision.rationale}`);
        }
        lines.push("");
    }
    return `${lines.join("\n")}\n`;
}
function renderBenchmarkReportMarkdown(report) {
    const lines = [
        "# Generation Benchmark Report",
        "",
        `Generated at: ${report.generatedAt}`,
        `Surfaces: ${report.overall.surfaceCount}`,
        `Surfaces meeting goal: ${report.overall.surfacesMeetingGoal}`,
        `Candidate fewer first-attempt blocking findings: ${report.overall.guidedFewerFirstAttemptBlockingFindings}`,
        `Candidate reached acceptable no later: ${report.overall.guidedReachedAcceptableNoLater}`,
        "",
        "## Comparisons",
    ];
    for (const comparison of report.comparisons) {
        lines.push(`- ${comparison.surfaceId}: baseline=${comparison.baselineGuidanceStrategy}, candidate=${comparison.guidedGuidanceStrategy}, meetsGoal=${comparison.meetsGoal}, improved dimensions=${comparison.guidedRubricBetterDimensions.join(", ") || "none"}`);
    }
    lines.push("", "## Suggestion decisions");
    for (const suggestion of report.suggestions) {
        lines.push(`- ${suggestion.surfaceId}: proposed=${suggestion.proposedCount}, accepted=${suggestion.acceptedCount}, rejected=${suggestion.rejectedCount}`);
    }
    lines.push("", "## Heuristic improvements");
    lines.push(`- lower unresolved accepted suggestion rate: ${report.overall.heuristics.lowerUnresolvedAcceptedSuggestionRate}`);
    lines.push(`- lower noChanges-after-edit failures: ${report.overall.heuristics.lowerNoChangesAfterEditFailureCount}`);
    lines.push(`- lower recoverable tool errors: ${report.overall.heuristics.lowerRecoverableToolErrorCount}`);
    lines.push(`- lower touched files per resolved finding: ${report.overall.heuristics.lowerTouchedFilesPerResolvedFinding}`);
    lines.push(`- lower repeated finding carryover count: ${report.overall.heuristics.lowerRepeatedFindingCarryoverCount}`);
    lines.push(`- lower reruns to acceptable outcome: ${report.overall.heuristics.lowerRerunsToAcceptableOutcome}`);
    return `${lines.join("\n")}\n`;
}
function freezeBriefFile(sessionDir, briefFile) {
    const sourcePath = path.resolve(briefFile);
    if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
        throw new SessionInputError(`Brief file not found at ${sourcePath}.`);
    }
    const extension = path.extname(sourcePath) || ".txt";
    const destinationPath = path.join(sessionDir, `task-brief${extension}`);
    const content = fs.readFileSync(sourcePath);
    fs.writeFileSync(destinationPath, content);
    return {
        path: destinationPath,
        sha256: crypto.createHash("sha256").update(content).digest("hex"),
    };
}
function defaultComparisonDir(baseline, guided) {
    return path.join(baseline.workspaceRoot, "artifacts", "generation-benchmarks", baseline.surfaceId, `${baseline.sessionId}--vs--${guided.sessionId}`);
}
function defaultBenchmarkReportDir(comparisonPaths) {
    const firstPath = comparisonPaths[0];
    return path.join(path.dirname(path.dirname(firstPath)), "report");
}
function extractRepairEntries(repairMap) {
    if (Array.isArray(repairMap)) {
        return repairMap.filter((entry) => isRecord(entry));
    }
    const record = asRecord(repairMap);
    const repairs = Array.isArray(record.repairs) ? record.repairs : [];
    return repairs.filter((entry) => isRecord(entry));
}
function summarizeContractForSurface(contractPath, surfaceId) {
    const payload = readJsonFile(contractPath, "generation session contract");
    const surfaces = Array.isArray(payload.surfaces) ? payload.surfaces.filter((entry) => isRecord(entry)) : [];
    const surface = surfaces.find((entry) => asString(entry.id) === surfaceId) ?? surfaces[0] ?? {};
    const sections = Array.isArray(payload.sections) ? payload.sections.filter((entry) => isRecord(entry)) : [];
    const color = asRecord(payload.color);
    const layout = asRecord(surface.layout);
    const requiredSections = asStringArray(surface.requiredSections ?? sections.map((entry) => entry.id));
    const allowedFonts = asStringArray(surface.allowedFonts);
    const allowedColors = asStringArray(color.allowedValues);
    const maxContentWidth = typeof layout.maxContentWidth === "number" ? layout.maxContentWidth : null;
    return [
        `${asString(payload.contractId) ?? surfaceId} v${asString(payload.version) ?? "0.0.0"}`,
        asString(payload.description) ?? "Working contract for generation guidance.",
        `Required sections: ${requiredSections.join(", ") || "none recorded"}`,
        `Fonts: ${allowedFonts.join(", ") || "none recorded"}`,
        `Max content width: ${maxContentWidth ?? "not specified"}`,
        `Color policy: ${asString(color.policy) ?? "off"}`,
        `Allowed colors: ${allowedColors.join(", ") || "none recorded"}`,
    ].join("\n");
}
function buildPreparedPromptSummary(preparedPayload) {
    const generation = asRecord(preparedPayload.generation);
    const structure = asRecord(generation.structure);
    const layout = asRecord(generation.layout);
    const visual = asRecord(generation.visual);
    const guidance = asRecord(generation.guidance);
    const constraints = asRecord(preparedPayload.constraints);
    const color = asRecord(constraints.color);
    const motion = asRecord(constraints.motion);
    const sections = Array.isArray(preparedPayload.sections) ? preparedPayload.sections : [];
    const repairs = extractRepairEntries(preparedPayload.repairMap);
    const requiredSections = asStringArray(structure.requiredSectionIds);
    const focusOrder = asStringArray(guidance.generationFocusOrder);
    const allowedFonts = asStringArray(visual.allowedFonts);
    const requiredContainers = asStringArray(layout.requiredContainers);
    const topRepairs = repairs
        .slice(0, 5)
        .map((entry) => {
        const code = asString(entry.code) ?? "unknown";
        const summary = asString(entry.summary) ?? "";
        return summary ? `${code}: ${summary}` : code;
    });
    return [
        `Contract: ${asString(preparedPayload.contract.id) ?? "unknown"} v${asString(preparedPayload.contract.version) ?? "0.0.0"}`,
        `Focus order: ${focusOrder.join(", ") || "none"}`,
        `Required sections: ${requiredSections.join(", ") || "none"}`,
        `Section count: ${sections.length}`,
        `Allowed fonts: ${allowedFonts.join(", ") || "none"}`,
        `Max content width: ${typeof layout.maxContentWidth === "number" ? `${layout.maxContentWidth}px` : "unspecified"}`,
        `Required containers: ${requiredContainers.join(", ") || "none"}`,
        `Color policy: ${asString(color.policy) ?? "off"}`,
        `Motion durations: ${Array.isArray(motion.allowedDurationsMs)
            ? motion.allowedDurationsMs.map((value) => `${String(value)}ms`).join(", ")
            : "none"}`,
        `Top repair priorities: ${topRepairs.join(", ") || "none"}`,
    ].join("\n");
}
function selectRelevantComponents(preparedPayload) {
    const sections = Array.isArray(preparedPayload.sections)
        ? preparedPayload.sections.filter((entry) => isRecord(entry))
        : [];
    const components = Array.isArray(preparedPayload.components)
        ? preparedPayload.components.filter((entry) => isRecord(entry))
        : [];
    const referencedIds = new Set();
    for (const section of sections) {
        const anatomy = asRecord(section.anatomy);
        const defaultComponentId = asString(anatomy.defaultComponentId);
        if (defaultComponentId) {
            referencedIds.add(defaultComponentId);
        }
        for (const componentId of asStringArray(anatomy.allowedComponentIds)) {
            referencedIds.add(componentId);
        }
        const slots = Array.isArray(anatomy.slots) ? anatomy.slots : [];
        for (const slot of slots) {
            const slotRecord = asRecord(slot);
            for (const componentId of asStringArray(slotRecord.acceptsComponentIds)) {
                referencedIds.add(componentId);
            }
        }
    }
    if (referencedIds.size === 0) {
        return components.slice(0, 12);
    }
    return components.filter((component) => referencedIds.has(asString(component.id) ?? ""));
}
function loadPreparedPayloadForSession(session) {
    if (session.preparedInputPath && fs.existsSync(session.preparedInputPath)) {
        return readJsonFile(session.preparedInputPath, "prepared generation payload");
    }
    const bundle = loadCompiledSurfaceBundle(session.bundleRoot, session.surfaceId, process.cwd());
    return buildPreparedGenerationPayload(bundle);
}
function loadRuntimeAcceptedSuggestions(filePath) {
    if (!filePath) {
        return [];
    }
    const resolvedPath = path.resolve(filePath);
    if (!fs.existsSync(resolvedPath)) {
        throw new SessionInputError(`Accepted suggestions file not found at ${resolvedPath}.`);
    }
    let payload;
    try {
        payload = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
    }
    catch (error) {
        throw new SessionInputError(`Accepted suggestions file is not valid JSON: ${resolvedPath} (${error instanceof Error ? error.message : String(error)}).`);
    }
    const payloadRecord = asRecord(payload);
    const suggestions = Array.isArray(payload)
        ? payload
        : Array.isArray(payloadRecord.suggestions)
            ? payloadRecord.suggestions
            : [];
    return suggestions
        .filter((entry) => isRecord(entry))
        .map((entry) => {
        const findingCode = asString(entry.findingCode);
        const findingMessage = asString(entry.findingMessage);
        const summary = asString(entry.summary);
        const suggestedPath = asString(entry.suggestedPath);
        const rationale = asString(entry.rationale);
        if (!findingCode || !findingMessage || !summary || !suggestedPath) {
            throw new SessionInputError(`Accepted suggestion entries must include findingCode, findingMessage, summary, and suggestedPath: ${resolvedPath}.`);
        }
        return {
            findingCode,
            findingMessage,
            summary,
            suggestedPath,
            ...(rationale ? { rationale } : {}),
        };
    });
}
function loadRuntimeDesignerNotes(filePath) {
    if (!filePath) {
        return [];
    }
    const resolvedPath = path.resolve(filePath);
    if (!fs.existsSync(resolvedPath)) {
        throw new SessionInputError(`Designer notes file not found at ${resolvedPath}.`);
    }
    let payload;
    try {
        payload = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
    }
    catch (error) {
        throw new SessionInputError(`Designer notes file is not valid JSON: ${resolvedPath} (${error instanceof Error ? error.message : String(error)}).`);
    }
    const payloadRecord = asRecord(payload);
    const rawNotes = Array.isArray(payload)
        ? payload
        : Array.isArray(payloadRecord.designerNotes)
            ? payloadRecord.designerNotes
            : Array.isArray(payloadRecord.notes)
                ? payloadRecord.notes
                : [];
    return [...new Set(rawNotes
            .map((entry) => {
            if (typeof entry === "string") {
                return entry.trim();
            }
            if (isRecord(entry)) {
                return asString(entry.content) ?? "";
            }
            return "";
        })
            .filter(Boolean))];
}
function parseRuntimeFindingCodes(value) {
    if (!value) {
        return [];
    }
    return [...new Set(value
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean))].sort((left, right) => left.localeCompare(right));
}
function buildGuidanceHandoff(session, paths, guidanceStrategy, options = {}) {
    const acceptedSuggestions = options.acceptedSuggestions ?? [];
    const designerNotes = options.designerNotes ?? [];
    const findingCodes = [...new Set([
            ...(options.findingCodes ?? []),
            ...acceptedSuggestions.map((entry) => entry.findingCode),
        ])].sort((left, right) => left.localeCompare(right));
    const preparedPayload = guidanceStrategy === "unguided" ? null : loadPreparedPayloadForSession(session);
    const repairMap = preparedPayload ? extractRepairEntries(preparedPayload.repairMap) : [];
    const matchedRepairs = repairMap.filter((entry) => findingCodes.includes(asString(entry.code) ?? ""));
    const brief = session.brief && fs.existsSync(session.brief.path)
        ? {
            ...session.brief,
            text: fs.readFileSync(session.brief.path, "utf8").trim(),
        }
        : null;
    return {
        schemaVersion: 1,
        surfaceId: session.surfaceId,
        sessionId: session.sessionId,
        tool: session.tool,
        guidanceStrategy,
        generatedAt: session.startedAt,
        brief,
        session: {
            sessionPath: paths.sessionPath,
            preparedInputPath: session.preparedInputPath,
            contractPath: session.contractPath,
            repairMapPath: session.repairMapPath,
        },
        runtimeGuidance: {
            findingCodes,
            matchedRepairCodes: matchedRepairs.map((entry) => asString(entry.code) ?? "").filter(Boolean),
            acceptedSuggestions,
            designerNotes,
        },
        promptSummary: guidanceStrategy === "prompt-summary"
            ? {
                effectiveContractSummary: summarizeContractForSurface(session.contractPath, session.surfaceId),
                preparedGuidanceSummary: buildPreparedPromptSummary(preparedPayload),
            }
            : null,
        jsonPrimary: guidanceStrategy === "json-primary"
            ? {
                surface: asRecord(preparedPayload.surface),
                contract: asRecord(preparedPayload.contract),
                summary: asRecord(preparedPayload.summary),
                generation: asRecord(preparedPayload.generation),
                constraints: asRecord(preparedPayload.constraints),
                sections: Array.isArray(preparedPayload.sections)
                    ? preparedPayload.sections.filter((entry) => isRecord(entry))
                    : [],
                components: selectRelevantComponents(preparedPayload),
                repairMap,
                matchedRepairs,
            }
            : null,
    };
}
function parseCsvPaths(value) {
    if (!value)
        return [];
    return [...new Set(value
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean)
            .map((entry) => path.resolve(entry)))];
}
function buildComparisonArtifact(baselineSessionDir, guidedSessionDir) {
    const baselineBuilt = buildGenerationSessionSummary(baselineSessionDir);
    const guidedBuilt = buildGenerationSessionSummary(guidedSessionDir);
    if (baselineBuilt.session.surfaceId !== guidedBuilt.session.surfaceId) {
        throw new SessionInputError("Baseline and guided sessions must target the same surface.");
    }
    if (baselineBuilt.session.tool !== guidedBuilt.session.tool) {
        throw new SessionInputError("Baseline and guided sessions must use the same tool.");
    }
    if (!baselineBuilt.session.brief || !guidedBuilt.session.brief) {
        throw new SessionInputError("Both sessions must freeze the same implementation brief before comparison.");
    }
    if (baselineBuilt.session.brief.sha256 !== guidedBuilt.session.brief.sha256) {
        throw new SessionInputError("Baseline and guided sessions must use the same implementation brief.");
    }
    const baselineFirstAttempt = toComparisonAttemptSnapshot(baselineBuilt.attempts[0], baselineBuilt.session.successRule.finalStatus);
    const guidedFirstAttempt = toComparisonAttemptSnapshot(guidedBuilt.attempts[0], guidedBuilt.session.successRule.finalStatus);
    const baselineLatestAttempt = toComparisonAttemptSnapshot(baselineBuilt.attempts[baselineBuilt.attempts.length - 1], baselineBuilt.session.successRule.finalStatus);
    const guidedLatestAttempt = toComparisonAttemptSnapshot(guidedBuilt.attempts[guidedBuilt.attempts.length - 1], guidedBuilt.session.successRule.finalStatus);
    const rubric = Object.fromEntries(ASSESSMENT_DIMENSIONS.map((dimension) => {
        const baseline = baselineLatestAttempt.assessment[dimension];
        const guided = guidedLatestAttempt.assessment[dimension];
        return [
            dimension,
            {
                baseline,
                guided,
                delta: gradeToScore(guided) - gradeToScore(baseline),
            },
        ];
    }));
    const guidedRubricBetterDimensions = ASSESSMENT_DIMENSIONS.filter((dimension) => rubric[dimension].delta > 0);
    const guidedRubricAtLeastAsGood = ASSESSMENT_DIMENSIONS.every((dimension) => rubric[dimension].delta >= 0);
    const guidedReachedAcceptableNoLater = baselineBuilt.summary.firstAcceptableAttempt === null
        ? guidedBuilt.summary.firstAcceptableAttempt !== null
        : guidedBuilt.summary.firstAcceptableAttempt !== null &&
            guidedBuilt.summary.firstAcceptableAttempt <= baselineBuilt.summary.firstAcceptableAttempt;
    const guidedFewerFirstAttemptBlockingFindings = guidedFirstAttempt.blockingFindingCount < baselineFirstAttempt.blockingFindingCount;
    const heuristics = {
        baseline: baselineBuilt.summary.heuristics,
        guided: guidedBuilt.summary.heuristics,
        delta: {
            unresolvedAcceptedSuggestionRate: numericHeuristicDelta(baselineBuilt.summary.heuristics.latestAttempt.unresolvedAcceptedSuggestionRate, guidedBuilt.summary.heuristics.latestAttempt.unresolvedAcceptedSuggestionRate),
            noChangesAfterEditFailureCount: (guidedBuilt.summary.heuristics.latestAttempt.noChangesAfterEditFailureCount ?? 0) -
                (baselineBuilt.summary.heuristics.latestAttempt.noChangesAfterEditFailureCount ?? 0),
            recoverableToolErrorCount: (guidedBuilt.summary.heuristics.latestAttempt.recoverableToolErrorCount ?? 0) -
                (baselineBuilt.summary.heuristics.latestAttempt.recoverableToolErrorCount ?? 0),
            touchedFilesPerResolvedFinding: numericHeuristicDelta(baselineBuilt.summary.heuristics.latestAttempt.touchedFilesPerResolvedFinding, guidedBuilt.summary.heuristics.latestAttempt.touchedFilesPerResolvedFinding),
            repeatedFindingCarryoverCount: guidedBuilt.summary.heuristics.repeatedFindingCarryoverCount -
                baselineBuilt.summary.heuristics.repeatedFindingCarryoverCount,
            rerunsToAcceptableOutcome: numericHeuristicDelta(baselineBuilt.summary.heuristics.rerunsToAcceptableOutcome, guidedBuilt.summary.heuristics.rerunsToAcceptableOutcome),
        },
    };
    return {
        schemaVersion: 3,
        surfaceId: baselineBuilt.session.surfaceId,
        tool: baselineBuilt.session.tool,
        brief: {
            sha256: baselineBuilt.session.brief.sha256,
            baselinePath: baselineBuilt.session.brief.path,
            guidedPath: guidedBuilt.session.brief.path,
        },
        baseline: {
            sessionId: baselineBuilt.session.sessionId,
            sessionDir: baselineBuilt.session.sessionDir,
            guidanceStrategy: baselineBuilt.session.guidanceStrategy,
            attemptCount: baselineBuilt.summary.attemptCount,
            firstAcceptableAttempt: baselineBuilt.summary.firstAcceptableAttempt,
            latestOutcome: baselineBuilt.summary.latestOutcome,
            firstAttempt: baselineFirstAttempt,
            latestAttempt: baselineLatestAttempt,
            recurringFindingCodes: baselineBuilt.summary.recurringFindingCodes,
            recurringRepairCodes: baselineBuilt.summary.recurringRepairCodes,
            heuristics: baselineBuilt.summary.heuristics,
        },
        guided: {
            sessionId: guidedBuilt.session.sessionId,
            sessionDir: guidedBuilt.session.sessionDir,
            guidanceStrategy: guidedBuilt.session.guidanceStrategy,
            attemptCount: guidedBuilt.summary.attemptCount,
            firstAcceptableAttempt: guidedBuilt.summary.firstAcceptableAttempt,
            latestOutcome: guidedBuilt.summary.latestOutcome,
            firstAttempt: guidedFirstAttempt,
            latestAttempt: guidedLatestAttempt,
            recurringFindingCodes: guidedBuilt.summary.recurringFindingCodes,
            recurringRepairCodes: guidedBuilt.summary.recurringRepairCodes,
            heuristics: guidedBuilt.summary.heuristics,
        },
        delta: {
            firstAttemptVerdict: {
                baseline: baselineFirstAttempt.outcome,
                guided: guidedFirstAttempt.outcome,
            },
            firstAttemptFindingCountDelta: guidedFirstAttempt.findingCount - baselineFirstAttempt.findingCount,
            firstAttemptBlockingFindingCountDelta: guidedFirstAttempt.blockingFindingCount - baselineFirstAttempt.blockingFindingCount,
            firstAttemptWarningFindingCountDelta: guidedFirstAttempt.warningFindingCount - baselineFirstAttempt.warningFindingCount,
            latestFindingCountDelta: guidedLatestAttempt.findingCount - baselineLatestAttempt.findingCount,
            attemptsToAcceptableOutcome: {
                baseline: baselineBuilt.summary.firstAcceptableAttempt,
                guided: guidedBuilt.summary.firstAcceptableAttempt,
                delta: baselineBuilt.summary.firstAcceptableAttempt !== null &&
                    guidedBuilt.summary.firstAcceptableAttempt !== null
                    ? guidedBuilt.summary.firstAcceptableAttempt - baselineBuilt.summary.firstAcceptableAttempt
                    : null,
            },
            rubric,
        },
        heuristics,
        checks: {
            guidedFewerFirstAttemptBlockingFindings,
            guidedReachedAcceptableNoLater,
            guidedRubricAtLeastAsGood,
            guidedRubricBetterDimensions,
            meetsGoal: guidedFewerFirstAttemptBlockingFindings &&
                guidedReachedAcceptableNoLater &&
                guidedRubricAtLeastAsGood &&
                guidedRubricBetterDimensions.length >= 2,
        },
        paths: {
            baselineSessionDir: baselineBuilt.session.sessionDir,
            guidedSessionDir: guidedBuilt.session.sessionDir,
        },
    };
}
function inferContractPath(surfaceId, findingCode, repair) {
    const actionType = asString(asRecord(repair?.action).type) ?? "";
    switch (actionType) {
        case "ensure-required-sections":
        case "restrict-section-set":
        case "restore-top-level-sections":
        case "restore-section-order":
            return `surfaces[id=${surfaceId}].requiredSections`;
        case "restrict-fonts":
        case "restore-marketing-typography-profile":
            return `surfaces[id=${surfaceId}].allowedFonts`;
        case "restrict-colors":
            return "color.allowedValues";
        case "restrict-icon-sources":
            return "icons.allowedSources";
        case "restrict-motion-durations":
            return "constraints.motion.allowedDurationsMs";
        case "restrict-motion-timing":
            return "constraints.motion.allowedTimingFunctions";
        case "reduce-content-width":
        case "ensure-required-containers":
        case "align-page-frame":
        case "restore-page-background-mode":
        case "restore-landing-pattern-signals":
            return `surfaces[id=${surfaceId}].layout`;
        case "restore-required-flows":
        case "restore-required-flow-steps":
        case "restore-required-transitions":
        case "restore-flow-observability":
            return `surfaces[id=${surfaceId}].flows`;
        case "remove-prohibited-primitives":
            return `surfaces[id=${surfaceId}].shell`;
        default:
            if (findingCode.startsWith("section."))
                return `surfaces[id=${surfaceId}].requiredSections`;
            if (findingCode.startsWith("layout.") || findingCode.startsWith("landing."))
                return `surfaces[id=${surfaceId}].layout`;
            if (findingCode.startsWith("font."))
                return `surfaces[id=${surfaceId}].allowedFonts`;
            if (findingCode.startsWith("color."))
                return "color.allowedValues";
            if (findingCode.startsWith("icon."))
                return "icons.allowedSources";
            if (findingCode.startsWith("motion."))
                return "constraints.motion";
            if (findingCode.startsWith("flow."))
                return `surfaces[id=${surfaceId}].flows`;
            return `surfaces[id=${surfaceId}]`;
    }
}
function getSuggestionConfidence(repeatedFailureCount, repairPriority, evidenceRefs, contractPath) {
    let confidence = 0.45;
    if (repeatedFailureCount > 1)
        confidence += 0.2;
    if (repairPriority === "high")
        confidence += 0.15;
    if (repairPriority === "medium")
        confidence += 0.05;
    if (evidenceRefs.length > 0)
        confidence += 0.1;
    if (contractPath === "surfaces[id=unknown]")
        confidence -= 0.15;
    return Math.max(0.1, Math.min(0.95, Math.round(confidence * 100) / 100));
}
function getSuggestionSortKey(left, right) {
    return (right.repeatedFailureCount - left.repeatedFailureCount ||
        getRepairPriorityRank(left.repair.priority) - getRepairPriorityRank(right.repair.priority) ||
        left.findingCode.localeCompare(right.findingCode));
}
function buildSuggestionArtifact(sessionDir) {
    const built = buildGenerationSessionSummary(sessionDir);
    if (built.session.guidanceStrategy === "unguided") {
        throw new SessionInputError("Contract delta suggestions require a guided session.");
    }
    const repairMapDoc = readJsonFile(built.session.repairMapPath, "repair map");
    const repairs = Array.isArray(repairMapDoc.repairs) ? repairMapDoc.repairs : [];
    const repairMapByCode = new Map(repairs
        .filter((entry) => isRecord(entry))
        .map((entry) => [asString(entry.code) ?? "", entry])
        .filter(([code]) => Boolean(code)));
    const recurringCounts = new Map(built.summary.recurringFindingCodes.map((entry) => [entry.code, entry.count]));
    const latestAttempt = built.attempts[built.attempts.length - 1];
    const latestFindings = Array.isArray(latestAttempt.validate.findings) ? latestAttempt.validate.findings : [];
    const latestFindingByCode = new Map();
    for (const finding of latestFindings) {
        if (!finding || typeof finding !== "object")
            continue;
        const entry = finding;
        const code = asString(entry.code);
        if (!code)
            continue;
        latestFindingByCode.set(code, entry);
    }
    const allCodes = [...new Set(built.attempts.flatMap((attempt) => parseFindingCodes(attempt.validate)))].sort((left, right) => left.localeCompare(right));
    const suggestions = allCodes.map((code) => {
        const repair = repairMapByCode.get(code);
        const latestFinding = latestFindingByCode.get(code);
        const action = asRecord(repair?.action);
        const repairPriority = asString(repair?.priority) ?? "medium";
        const repairCategory = asString(repair?.category) ?? "unknown";
        const actionType = asString(action.type) ?? "review-contract";
        const evidence = latestFinding?.evidence;
        const evidenceRefs = isRecord(evidence) && Object.keys(evidence).length > 0 ? [evidence] : [];
        const contractPath = inferContractPath(built.session.surfaceId, code, repair);
        const valueHints = [
            ...(Array.isArray(action.sectionIds) ? action.sectionIds.filter((entry) => typeof entry === "string") : []),
            ...(Array.isArray(action.sectionOrder) ? action.sectionOrder.filter((entry) => typeof entry === "string") : []),
            ...(Array.isArray(action.allowedValues) ? action.allowedValues.filter((entry) => typeof entry === "string") : []),
            ...(Array.isArray(action.allowedSources) ? action.allowedSources.filter((entry) => typeof entry === "string") : []),
            ...(Array.isArray(action.requiredContainers) ? action.requiredContainers.filter((entry) => typeof entry === "string") : []),
        ].slice(0, 6);
        const repeatedFailureCount = recurringCounts.get(code) ?? 1;
        return {
            suggestionId: `suggestion:${code}`,
            findingCode: code,
            findingMessage: asString(latestFinding?.message) ?? `Review contract coverage for ${code}.`,
            repeatedFailureCount,
            confidence: getSuggestionConfidence(repeatedFailureCount, repairPriority, evidenceRefs, contractPath),
            status: "proposed",
            repair: {
                priority: repairPriority,
                category: repairCategory,
                actionType,
            },
            evidenceRefs,
            proposedChange: {
                path: contractPath,
                actionType,
                summary: asString(latestFinding?.message) ??
                    `Review whether ${contractPath} needs refinement to better constrain ${code}.`,
                valueHints,
            },
        };
    }).sort(getSuggestionSortKey);
    return {
        schemaVersion: 2,
        surfaceId: built.session.surfaceId,
        sessionId: built.session.sessionId,
        tool: built.session.tool,
        guidanceStrategy: built.session.guidanceStrategy,
        generatedAt: asString(latestAttempt.metadata.createdAt) ??
            asString(latestAttempt.validate.provenance && asRecord(latestAttempt.validate.provenance).evaluatedAt) ??
            built.session.startedAt,
        contract: {
            path: built.session.contractPath,
        },
        session: {
            sessionPath: built.paths.sessionPath,
            summaryPath: built.paths.summaryJsonPath,
            repairMapPath: built.session.repairMapPath,
        },
        suggestions,
    };
}
function normalizeSuggestionReviewFile(filePath) {
    const payload = readJsonFile(filePath, "contract delta suggestion review");
    const decisions = Array.isArray(payload.decisions) ? payload.decisions : [];
    if (decisions.length === 0) {
        throw new SessionInputError(`Review file must include a non-empty "decisions" array: ${filePath}.`);
    }
    return decisions.map((entry, index) => {
        if (!entry || typeof entry !== "object") {
            throw new SessionInputError(`Review decision at index ${index} is invalid: ${filePath}.`);
        }
        const decision = entry;
        const suggestionId = asString(decision.suggestionId);
        const status = asString(decision.status);
        const rationale = typeof decision.rationale === "string" ? decision.rationale.trim() : "";
        if (!suggestionId) {
            throw new SessionInputError(`Review decision at index ${index} is missing suggestionId: ${filePath}.`);
        }
        if (status !== "accepted" && status !== "rejected") {
            throw new SessionInputError(`Review decision for ${suggestionId} must use accepted|rejected: ${filePath}.`);
        }
        if (!rationale) {
            throw new SessionInputError(`Review decision for ${suggestionId} must include rationale: ${filePath}.`);
        }
        return {
            suggestionId,
            status,
            rationale,
        };
    });
}
export async function runInitGenerationSessionCommand(options) {
    try {
        if (!options.bundleRoot) {
            throw new SessionInputError("--bundle-root is required.");
        }
        if (!options.surfaceId) {
            throw new SessionInputError("--surface is required.");
        }
        if (!options.workspaceRoot) {
            throw new SessionInputError("--workspace-root is required.");
        }
        const tool = ensureSessionTool(options.tool);
        const guidanceStrategy = ensureGuidanceStrategy(options.guidanceStrategy ?? options.guidanceMode);
        const workspaceRoot = path.resolve(options.workspaceRoot);
        if (!fs.existsSync(workspaceRoot) || !fs.statSync(workspaceRoot).isDirectory()) {
            throw new SessionInputError(`Workspace root directory not found at ${workspaceRoot}.`);
        }
        const loadedBundle = loadCompiledSurfaceBundle(options.bundleRoot, options.surfaceId, process.cwd());
        const sessionId = options.sessionId?.trim() || buildDefaultSessionId();
        const artifactsRoot = resolveWorkspaceRelative(workspaceRoot, options.artifactsRoot);
        const sessionDir = path.join(artifactsRoot, options.surfaceId, sessionId);
        const paths = getSessionPaths(sessionDir);
        if (fs.existsSync(paths.sessionDir)) {
            throw new SessionInputError(`Generation session already exists at ${paths.sessionDir}.`);
        }
        fs.mkdirSync(paths.sessionDir, { recursive: true });
        fs.cpSync(loadedBundle.root, paths.bundleRoot, { recursive: true });
        const sessionBundle = loadCompiledSurfaceBundle(paths.bundleRoot, options.surfaceId, process.cwd());
        let preparedInputPath = null;
        if (guidanceStrategy !== "unguided") {
            const preparedPayload = buildPreparedGenerationPayload(sessionBundle);
            writeDeterministicJsonSync(paths.preparedInputPath, preparedPayload);
            preparedInputPath = paths.preparedInputPath;
        }
        const session = {
            schemaVersion: 3,
            surfaceId: options.surfaceId,
            sessionId,
            tool,
            guidanceStrategy,
            workspaceRoot,
            sourceBundleRoot: loadedBundle.root,
            sessionDir: paths.sessionDir,
            bundleRoot: paths.bundleRoot,
            preparedInputPath,
            contractPath: sessionBundle.contract.path,
            repairMapPath: sessionBundle.surface.repairMap.path,
            guidanceArtifacts: {
                baseHandoffPath: paths.guidanceHandoffPath,
            },
            startedAt: new Date().toISOString(),
            ...(options.briefFile ? { brief: freezeBriefFile(paths.sessionDir, options.briefFile) } : {}),
            successRule: {
                finalStatus: "pass-or-reviewed-warn",
            },
        };
        const handoff = buildGuidanceHandoff(session, paths, guidanceStrategy);
        writeDeterministicJsonSync(paths.guidanceHandoffPath, handoff);
        writeDeterministicJsonSync(paths.sessionPath, session);
        process.stdout.write(`${JSON.stringify({ ok: true, session, handoff, paths }, null, 2)}\n`);
        return 0;
    }
    catch (error) {
        if (error instanceof SessionInputError || error instanceof AdapterInputError) {
            writeError(error, error.code);
            return 10;
        }
        writeError(error instanceof Error ? error : new Error(String(error)), "generation-session.internal");
        return 1;
    }
}
export async function runPrepareGenerationHandoffCommand(options) {
    try {
        if (!options.sessionDir) {
            throw new SessionInputError("--session-dir is required.");
        }
        const { session, paths } = loadSession(options.sessionDir);
        const guidanceStrategy = ensureGuidanceStrategy(options.guidanceStrategy ?? session.guidanceStrategy);
        let preparedInputPath = session.preparedInputPath;
        if (guidanceStrategy !== "unguided" && !preparedInputPath) {
            const bundle = loadCompiledSurfaceBundle(session.bundleRoot, session.surfaceId, process.cwd());
            const preparedPayload = buildPreparedGenerationPayload(bundle);
            writeDeterministicJsonSync(paths.preparedInputPath, preparedPayload);
            preparedInputPath = paths.preparedInputPath;
        }
        const sessionForHandoff = {
            ...session,
            guidanceStrategy,
            preparedInputPath,
            guidanceArtifacts: {
                baseHandoffPath: options.outPath ? path.resolve(options.outPath) : paths.guidanceHandoffPath,
            },
        };
        const handoff = buildGuidanceHandoff(sessionForHandoff, paths, guidanceStrategy, {
            acceptedSuggestions: loadRuntimeAcceptedSuggestions(options.acceptedSuggestionsFile),
            designerNotes: loadRuntimeDesignerNotes(options.designerNotesFile),
            findingCodes: parseRuntimeFindingCodes(options.findingCodes),
        });
        const handoffPath = sessionForHandoff.guidanceArtifacts.baseHandoffPath ?? paths.guidanceHandoffPath;
        writeDeterministicJsonSync(handoffPath, handoff);
        const updatedSession = {
            ...sessionForHandoff,
        };
        writeDeterministicJsonSync(paths.sessionPath, updatedSession);
        process.stdout.write(`${JSON.stringify({
            ok: true,
            handoff,
            session: updatedSession,
            paths: {
                handoffPath,
                sessionPath: paths.sessionPath,
            },
        }, null, 2)}\n`);
        return 0;
    }
    catch (error) {
        if (error instanceof SessionInputError || error instanceof AdapterInputError) {
            writeError(error, error.code);
            return 10;
        }
        writeError(error instanceof Error ? error : new Error(String(error)), "generation-session.internal");
        return 1;
    }
}
export async function runRecordGenerationAttemptCommand(options) {
    try {
        if (!options.sessionDir) {
            throw new SessionInputError("--session-dir is required.");
        }
        if (!options.assessmentFile) {
            throw new SessionInputError("--assessment-file is required.");
        }
        const { session, paths } = loadSession(options.sessionDir);
        const assessment = loadAssessment(options.assessmentFile);
        const attemptNumber = nextAttemptNumber(paths.attemptsDir);
        const attemptPaths = getAttemptPaths(paths.attemptsDir, attemptNumber);
        fs.mkdirSync(paths.attemptsDir, { recursive: true });
        const response = await runGenerationAdapter({
            requestId: crypto.randomUUID(),
            tool: session.tool,
            surfaceId: session.surfaceId,
            mode: "workspace",
            bundleRoot: session.bundleRoot,
            workspaceRoot: session.workspaceRoot,
            provenance: {
                sessionId: session.sessionId,
                timestamp: new Date().toISOString(),
            },
        }, {
            cwd: process.cwd(),
        });
        writeDeterministicJsonSync(attemptPaths.validatePath, response);
        writeDeterministicJsonSync(attemptPaths.assessmentPath, assessment);
        const findingCodes = parseFindingCodes(response);
        const contractRun = emitContractRunArtifact({
            rootDir: session.workspaceRoot,
            contractPath: session.contractPath,
            surfaceId: session.surfaceId,
            source: "generation",
            status: mapAdapterStatusToRunStatus(response.status),
            reportPath: attemptPaths.validatePath,
            findingCodes,
            workspaceId: session.sessionId,
            idempotencyKey: `${session.surfaceId}:${session.sessionId}:${formatAttemptNumber(attemptNumber)}`,
        });
        const metadata = {
            schemaVersion: 3,
            surfaceId: session.surfaceId,
            sessionId: session.sessionId,
            attemptNumber,
            tool: session.tool,
            guidanceStrategy: session.guidanceStrategy,
            createdAt: new Date().toISOString(),
            validateStatus: response.status,
            validateExitCode: response.status === "block" ? 30 : 0,
            findingCodes,
            assessmentPath: attemptPaths.assessmentPath,
            validatePath: attemptPaths.validatePath,
            touchedFiles: assessment.touchedFiles ?? [],
            guidanceHandoffPath: session.guidanceArtifacts.baseHandoffPath,
            contractRun,
        };
        writeDeterministicJsonSync(attemptPaths.metadataPath, metadata);
        process.stdout.write(`${JSON.stringify({
            ok: true,
            session,
            attempt: {
                attemptNumber,
                validatePath: attemptPaths.validatePath,
                assessmentPath: attemptPaths.assessmentPath,
                metadataPath: attemptPaths.metadataPath,
                validateStatus: response.status,
                findingCodes,
            },
        }, null, 2)}\n`);
        return 0;
    }
    catch (error) {
        if (error instanceof SessionInputError || error instanceof AdapterInputError) {
            writeError(error, error.code);
            return 10;
        }
        writeError(error instanceof Error ? error : new Error(String(error)), "generation-session.internal");
        return 1;
    }
}
export async function runCaptureGenerationPreviewCommand(options) {
    try {
        if (!options.sessionDir) {
            throw new SessionInputError("--session-dir is required.");
        }
        if (!options.url) {
            throw new SessionInputError("--url is required.");
        }
        const attemptNumber = typeof options.attemptNumber === "number"
            ? options.attemptNumber
            : Number.parseInt(String(options.attemptNumber ?? ""), 10);
        if (!Number.isInteger(attemptNumber) || attemptNumber < 1) {
            throw new SessionInputError("--attempt must be a positive integer.");
        }
        const { session, paths } = loadSession(options.sessionDir);
        const attemptPaths = getAttemptPaths(paths.attemptsDir, attemptNumber);
        if (!fs.existsSync(attemptPaths.metadataPath) || !fs.existsSync(attemptPaths.validatePath)) {
            throw new SessionInputError(`Attempt ${attemptNumber} not found in ${paths.attemptsDir}.`);
        }
        let parsedUrl;
        try {
            parsedUrl = new URL(options.url);
        }
        catch {
            throw new SessionInputError(`Preview URL must be an absolute URL: ${options.url}.`);
        }
        if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
            throw new SessionInputError(`Preview URL must use http or https: ${options.url}.`);
        }
        const viewport = { width: 1440, height: 1024 };
        const storageStatePath = asString(options.storageStatePath);
        if (storageStatePath && !fs.existsSync(storageStatePath)) {
            throw new SessionInputError(`Storage state file not found: ${storageStatePath}.`);
        }
        const browser = await chromium.launch({
            headless: process.env.INTERFACECTL_PLAYWRIGHT_HEADLESS !== "0" &&
                process.env.INTERFACECTL_PLAYWRIGHT_HEADLESS !== "false",
        }).catch((error) => {
            throw toBrowserLaunchError(error);
        });
        const context = await browser.newContext({
            viewport,
            ...(storageStatePath ? { storageState: storageStatePath } : {}),
        });
        const page = await context.newPage();
        try {
            await page.goto(parsedUrl.toString(), { waitUntil: "load", timeout: 15_000 });
            await waitForPageSettle(page);
            const waitFor = asString(options.waitFor);
            if (waitFor) {
                await waitForPreviewCondition(page, waitFor);
                await waitForPageSettle(page);
            }
            await page.screenshot({ path: attemptPaths.previewImagePath, fullPage: true, type: "png" });
            const preview = {
                schemaVersion: 1,
                surfaceId: session.surfaceId,
                sessionId: session.sessionId,
                attemptNumber,
                url: parsedUrl.toString(),
                finalUrl: page.url(),
                imagePath: attemptPaths.previewImagePath,
                capturedAt: new Date().toISOString(),
                viewport,
                ...(asString(await page.title()) ? { pageTitle: asString(await page.title()) } : {}),
                ...(waitFor ? { waitFor } : {}),
            };
            writeDeterministicJsonSync(attemptPaths.previewMetadataPath, preview);
            process.stdout.write(`${JSON.stringify({
                ok: true,
                preview,
                paths: {
                    metadataPath: attemptPaths.previewMetadataPath,
                    imagePath: attemptPaths.previewImagePath,
                },
            }, null, 2)}\n`);
            return 0;
        }
        catch (error) {
            if (error instanceof SessionInputError) {
                throw error;
            }
            const message = error instanceof Error ? error.message : String(error);
            throw new SessionInputError(`Failed to capture preview for attempt ${attemptNumber}: ${message}.`);
        }
        finally {
            await context.close().catch(() => undefined);
            await browser.close().catch(() => undefined);
        }
    }
    catch (error) {
        if (error instanceof SessionInputError || error instanceof AdapterInputError) {
            writeError(error, error.code);
            return 10;
        }
        writeError(error instanceof Error ? error : new Error(String(error)), "generation-session.internal");
        return 1;
    }
}
export async function runReviewGenerationAttemptCommand(options) {
    try {
        if (!options.sessionDir) {
            throw new SessionInputError("--session-dir is required.");
        }
        if (!options.reviewFile) {
            throw new SessionInputError("--review-file is required.");
        }
        const attemptNumber = typeof options.attemptNumber === "number"
            ? options.attemptNumber
            : Number.parseInt(String(options.attemptNumber ?? ""), 10);
        if (!Number.isInteger(attemptNumber) || attemptNumber < 1) {
            throw new SessionInputError("--attempt must be a positive integer.");
        }
        const { session, paths } = loadSession(options.sessionDir);
        const attemptPaths = getAttemptPaths(paths.attemptsDir, attemptNumber);
        if (!fs.existsSync(attemptPaths.validatePath)) {
            throw new SessionInputError(`Attempt ${attemptNumber} validate payload not found at ${attemptPaths.validatePath}.`);
        }
        const validatePayload = readJsonFile(attemptPaths.validatePath, `attempt ${attemptNumber} validate payload`);
        if (validatePayload.status !== "warn") {
            throw new SessionInputError(`Attempt ${attemptNumber} is ${String(validatePayload.status)}; only warn attempts can be reviewed.`);
        }
        const findingCodes = parseFindingCodes(validatePayload);
        if (findingCodes.length === 0) {
            throw new SessionInputError(`Attempt ${attemptNumber} does not have remaining finding codes to review.`);
        }
        const reviewInputPath = path.resolve(options.reviewFile);
        if (!fs.existsSync(reviewInputPath)) {
            throw new SessionInputError(`Review file not found at ${reviewInputPath}.`);
        }
        const reviewInput = normalizeReviewInput(readJsonFile(reviewInputPath, "generation attempt review input"), reviewInputPath, findingCodes);
        const review = {
            schemaVersion: 1,
            surfaceId: session.surfaceId,
            sessionId: session.sessionId,
            attemptNumber,
            status: reviewInput.status,
            findingCodes: reviewInput.findingCodes,
            rationale: reviewInput.rationale,
            reviewedAt: new Date().toISOString(),
        };
        writeDeterministicJsonSync(attemptPaths.reviewPath, review);
        process.stdout.write(`${JSON.stringify({
            ok: true,
            review,
            reviewPath: attemptPaths.reviewPath,
        }, null, 2)}\n`);
        return 0;
    }
    catch (error) {
        if (error instanceof SessionInputError || error instanceof AdapterInputError) {
            writeError(error, error.code);
            return 10;
        }
        writeError(error instanceof Error ? error : new Error(String(error)), "generation-session.internal");
        return 1;
    }
}
export async function runSummarizeGenerationSessionCommand(options) {
    try {
        if (!options.sessionDir) {
            throw new SessionInputError("--session-dir is required.");
        }
        const { paths, summary } = buildGenerationSessionSummary(options.sessionDir);
        writeDeterministicJsonSync(paths.summaryJsonPath, summary);
        fs.writeFileSync(paths.summaryMarkdownPath, renderSummaryMarkdown(summary), "utf8");
        process.stdout.write(`${JSON.stringify({ ok: true, summary, paths }, null, 2)}\n`);
        return summary.latestOutcome === "pass" || summary.latestOutcome === "accepted-warn" ? 0 : 30;
    }
    catch (error) {
        if (error instanceof SessionInputError || error instanceof AdapterInputError) {
            writeError(error, error.code);
            return 10;
        }
        writeError(error instanceof Error ? error : new Error(String(error)), "generation-session.internal");
        return 1;
    }
}
export async function runCompareGenerationSessionsCommand(options) {
    try {
        if (!options.baselineSessionDir) {
            throw new SessionInputError("--baseline-session-dir is required.");
        }
        if (!options.guidedSessionDir) {
            throw new SessionInputError("--guided-session-dir is required.");
        }
        const comparison = buildComparisonArtifact(options.baselineSessionDir, options.guidedSessionDir);
        const baseline = loadSession(options.baselineSessionDir).session;
        const guided = loadSession(options.guidedSessionDir).session;
        const outDir = options.outDir
            ? path.resolve(options.outDir)
            : defaultComparisonDir(baseline, guided);
        const jsonPath = path.join(outDir, "comparison.json");
        const markdownPath = path.join(outDir, "comparison.md");
        writeDeterministicJsonSync(jsonPath, comparison);
        fs.mkdirSync(path.dirname(markdownPath), { recursive: true });
        fs.writeFileSync(markdownPath, renderComparisonMarkdown(comparison), "utf8");
        process.stdout.write(`${JSON.stringify({
            ok: true,
            comparison,
            paths: {
                jsonPath,
                markdownPath,
            },
        }, null, 2)}\n`);
        return 0;
    }
    catch (error) {
        if (error instanceof SessionInputError || error instanceof AdapterInputError) {
            writeError(error, error.code);
            return 10;
        }
        writeError(error instanceof Error ? error : new Error(String(error)), "generation-session.internal");
        return 1;
    }
}
export async function runSuggestContractDeltasCommand(options) {
    try {
        if (!options.sessionDir) {
            throw new SessionInputError("--session-dir is required.");
        }
        const artifact = buildSuggestionArtifact(options.sessionDir);
        const sessionPaths = getSessionPaths(path.resolve(options.sessionDir));
        const outPath = options.outPath
            ? path.resolve(options.outPath)
            : sessionPaths.suggestionsJsonPath;
        const markdownPath = outPath.endsWith(".json")
            ? `${outPath.slice(0, -5)}.md`
            : `${outPath}.md`;
        writeDeterministicJsonSync(outPath, artifact);
        fs.mkdirSync(path.dirname(markdownPath), { recursive: true });
        fs.writeFileSync(markdownPath, renderSuggestionsMarkdown(artifact), "utf8");
        process.stdout.write(`${JSON.stringify({
            ok: true,
            artifact,
            paths: {
                jsonPath: outPath,
                markdownPath,
            },
        }, null, 2)}\n`);
        return 0;
    }
    catch (error) {
        if (error instanceof SessionInputError || error instanceof AdapterInputError) {
            writeError(error, error.code);
            return 10;
        }
        writeError(error instanceof Error ? error : new Error(String(error)), "generation-session.internal");
        return 1;
    }
}
export async function runReviewContractDeltaSuggestionsCommand(options) {
    try {
        if (!options.suggestionsPath) {
            throw new SessionInputError("--suggestions is required.");
        }
        if (!options.reviewFile) {
            throw new SessionInputError("--review-file is required.");
        }
        const suggestionsPath = path.resolve(options.suggestionsPath);
        if (!fs.existsSync(suggestionsPath)) {
            throw new SessionInputError(`Suggestions file not found at ${suggestionsPath}.`);
        }
        const artifact = readJsonFile(suggestionsPath, "contract delta suggestions artifact");
        const reviewFile = path.resolve(options.reviewFile);
        if (!fs.existsSync(reviewFile)) {
            throw new SessionInputError(`Review file not found at ${reviewFile}.`);
        }
        const decisions = normalizeSuggestionReviewFile(reviewFile);
        const decisionMap = new Map(decisions.map((entry) => [entry.suggestionId, entry]));
        const knownIds = new Set(artifact.suggestions.map((suggestion) => suggestion.suggestionId));
        for (const suggestionId of decisionMap.keys()) {
            if (!knownIds.has(suggestionId)) {
                throw new SessionInputError(`Unknown suggestionId "${suggestionId}" in ${reviewFile}.`);
            }
        }
        const updatedArtifact = {
            ...artifact,
            suggestions: artifact.suggestions.map((suggestion) => {
                const decision = decisionMap.get(suggestion.suggestionId);
                if (!decision) {
                    return suggestion;
                }
                return {
                    ...suggestion,
                    status: decision.status,
                    decision: {
                        rationale: decision.rationale,
                        decidedAt: new Date().toISOString(),
                    },
                };
            }),
        };
        const outPath = options.outPath ? path.resolve(options.outPath) : suggestionsPath;
        const markdownPath = outPath.endsWith(".json")
            ? `${outPath.slice(0, -5)}.md`
            : `${outPath}.md`;
        writeDeterministicJsonSync(outPath, updatedArtifact);
        fs.mkdirSync(path.dirname(markdownPath), { recursive: true });
        fs.writeFileSync(markdownPath, renderSuggestionsMarkdown(updatedArtifact), "utf8");
        process.stdout.write(`${JSON.stringify({
            ok: true,
            artifact: updatedArtifact,
            paths: {
                jsonPath: outPath,
                markdownPath,
            },
        }, null, 2)}\n`);
        return 0;
    }
    catch (error) {
        if (error instanceof SessionInputError || error instanceof AdapterInputError) {
            writeError(error, error.code);
            return 10;
        }
        writeError(error instanceof Error ? error : new Error(String(error)), "generation-session.internal");
        return 1;
    }
}
export async function runSummarizeGenerationBenchmarkCommand(options) {
    try {
        const comparisonPaths = parseCsvPaths(options.comparisonPaths);
        if (comparisonPaths.length === 0) {
            throw new SessionInputError("--comparisons must include at least one comparison artifact path.");
        }
        const suggestionPaths = parseCsvPaths(options.suggestionPaths);
        const comparisons = comparisonPaths.map((comparisonPath) => ({
            path: comparisonPath,
            value: readJsonFile(comparisonPath, "generation session comparison"),
        }));
        const suggestions = suggestionPaths.map((suggestionPath) => ({
            path: suggestionPath,
            value: readJsonFile(suggestionPath, "contract delta suggestions artifact"),
        }));
        const report = {
            schemaVersion: 2,
            generatedAt: new Date().toISOString(),
            comparisons: comparisons.map(({ path: comparisonPath, value }) => ({
                surfaceId: value.surfaceId,
                tool: value.tool,
                comparisonPath,
                meetsGoal: value.checks.meetsGoal,
                baselineGuidanceStrategy: value.baseline.guidanceStrategy,
                guidedGuidanceStrategy: value.guided.guidanceStrategy,
                guidedFewerFirstAttemptBlockingFindings: value.checks.guidedFewerFirstAttemptBlockingFindings,
                guidedReachedAcceptableNoLater: value.checks.guidedReachedAcceptableNoLater,
                guidedRubricBetterDimensions: value.checks.guidedRubricBetterDimensions,
                heuristics: value.heuristics.delta,
            })),
            suggestions: suggestions.map(({ path: suggestionsPath, value }) => ({
                surfaceId: value.surfaceId,
                sessionId: value.sessionId,
                suggestionsPath,
                proposedCount: value.suggestions.filter((entry) => entry.status === "proposed").length,
                acceptedCount: value.suggestions.filter((entry) => entry.status === "accepted").length,
                rejectedCount: value.suggestions.filter((entry) => entry.status === "rejected").length,
            })),
            overall: {
                surfaceCount: comparisons.length,
                surfacesMeetingGoal: comparisons.filter(({ value }) => value.checks.meetsGoal).length,
                guidedFewerFirstAttemptBlockingFindings: comparisons.filter(({ value }) => value.checks.guidedFewerFirstAttemptBlockingFindings).length,
                guidedReachedAcceptableNoLater: comparisons.filter(({ value }) => value.checks.guidedReachedAcceptableNoLater).length,
                acceptedSuggestionCount: suggestions.reduce((total, entry) => total + entry.value.suggestions.filter((suggestion) => suggestion.status === "accepted").length, 0),
                rejectedSuggestionCount: suggestions.reduce((total, entry) => total + entry.value.suggestions.filter((suggestion) => suggestion.status === "rejected").length, 0),
                proposedSuggestionCount: suggestions.reduce((total, entry) => total + entry.value.suggestions.filter((suggestion) => suggestion.status === "proposed").length, 0),
                heuristics: {
                    lowerUnresolvedAcceptedSuggestionRate: countHeuristicImprovement(comparisons.map(({ value }) => value.heuristics.delta.unresolvedAcceptedSuggestionRate)),
                    lowerNoChangesAfterEditFailureCount: comparisons.filter(({ value }) => value.heuristics.delta.noChangesAfterEditFailureCount < 0).length,
                    lowerRecoverableToolErrorCount: comparisons.filter(({ value }) => value.heuristics.delta.recoverableToolErrorCount < 0).length,
                    lowerTouchedFilesPerResolvedFinding: countHeuristicImprovement(comparisons.map(({ value }) => value.heuristics.delta.touchedFilesPerResolvedFinding)),
                    lowerRepeatedFindingCarryoverCount: comparisons.filter(({ value }) => value.heuristics.delta.repeatedFindingCarryoverCount < 0).length,
                    lowerRerunsToAcceptableOutcome: countHeuristicImprovement(comparisons.map(({ value }) => value.heuristics.delta.rerunsToAcceptableOutcome)),
                    averageDelta: {
                        unresolvedAcceptedSuggestionRate: averageNullable(comparisons.map(({ value }) => value.heuristics.delta.unresolvedAcceptedSuggestionRate)),
                        noChangesAfterEditFailureCount: averageNullable(comparisons.map(({ value }) => value.heuristics.delta.noChangesAfterEditFailureCount)),
                        recoverableToolErrorCount: averageNullable(comparisons.map(({ value }) => value.heuristics.delta.recoverableToolErrorCount)),
                        touchedFilesPerResolvedFinding: averageNullable(comparisons.map(({ value }) => value.heuristics.delta.touchedFilesPerResolvedFinding)),
                        repeatedFindingCarryoverCount: averageNullable(comparisons.map(({ value }) => value.heuristics.delta.repeatedFindingCarryoverCount)),
                        rerunsToAcceptableOutcome: averageNullable(comparisons.map(({ value }) => value.heuristics.delta.rerunsToAcceptableOutcome)),
                    },
                },
            },
        };
        const outDir = options.outDir
            ? path.resolve(options.outDir)
            : defaultBenchmarkReportDir(comparisonPaths);
        const jsonPath = path.join(outDir, "benchmark-report.json");
        const markdownPath = path.join(outDir, "benchmark-report.md");
        writeDeterministicJsonSync(jsonPath, report);
        fs.mkdirSync(path.dirname(markdownPath), { recursive: true });
        fs.writeFileSync(markdownPath, renderBenchmarkReportMarkdown(report), "utf8");
        process.stdout.write(`${JSON.stringify({
            ok: true,
            report,
            paths: {
                jsonPath,
                markdownPath,
            },
        }, null, 2)}\n`);
        return 0;
    }
    catch (error) {
        if (error instanceof SessionInputError || error instanceof AdapterInputError) {
            writeError(error, error.code);
            return 10;
        }
        writeError(error instanceof Error ? error : new Error(String(error)), "generation-session.internal");
        return 1;
    }
}
