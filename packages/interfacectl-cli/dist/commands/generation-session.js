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
const VALID_GUIDANCE_MODES = new Set(["prepared", "unguided"]);
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
function ensureGuidanceMode(guidanceMode) {
    const normalized = typeof guidanceMode === "string" ? guidanceMode.trim().toLowerCase() : "prepared";
    if (!VALID_GUIDANCE_MODES.has(normalized)) {
        throw new SessionInputError(`Invalid --guidance-mode value "${guidanceMode ?? ""}". Expected prepared|unguided.`);
    }
    return normalized;
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
    return {
        structure: grade("structure"),
        components: grade("components"),
        boundary: grade("boundary"),
        visual: grade("visual"),
        responsiveness: grade("responsiveness"),
        notes,
        ...(touchedFiles && touchedFiles.length > 0 ? { touchedFiles } : {}),
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
    if (schemaVersion !== 1 && schemaVersion !== 2) {
        throw new SessionInputError(`Unsupported generation session schemaVersion "${String(payload.schemaVersion ?? "unknown")}".`);
    }
    const tool = ensureSessionTool(asString(payload.tool));
    const guidanceMode = ensureGuidanceMode(asString(payload.guidanceMode) ?? "prepared");
    const finalStatus = asString(asRecord(payload.successRule).finalStatus) ?? "pass";
    if (!VALID_SUCCESS_RULES.has(finalStatus)) {
        throw new SessionInputError(`Unsupported session successRule.finalStatus "${finalStatus}".`);
    }
    const briefRecord = asRecord(payload.brief);
    const briefPath = asString(briefRecord.path);
    const briefSha256 = asString(briefRecord.sha256);
    const session = {
        schemaVersion: 2,
        surfaceId: asString(payload.surfaceId) ?? "",
        sessionId: asString(payload.sessionId) ?? "",
        tool,
        guidanceMode,
        workspaceRoot: asString(payload.workspaceRoot) ?? "",
        sourceBundleRoot: asString(payload.sourceBundleRoot) ?? "",
        sessionDir: asString(payload.sessionDir) ?? sessionDir,
        bundleRoot: asString(payload.bundleRoot) ?? "",
        preparedInputPath: typeof payload.preparedInputPath === "string" ? payload.preparedInputPath : null,
        contractPath: asString(payload.contractPath) ?? "",
        repairMapPath: asString(payload.repairMapPath) ?? "",
        startedAt: asString(payload.startedAt) ?? "",
        ...(briefPath && briefSha256 ? { brief: { path: briefPath, sha256: briefSha256 } } : {}),
        successRule: {
            finalStatus: finalStatus,
        },
    };
    if (!session.surfaceId || !session.sessionId || !session.workspaceRoot || !session.bundleRoot || !session.contractPath || !session.repairMapPath || !session.startedAt) {
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
function renderSummaryMarkdown(summary) {
    const lines = [
        "# Generation Session Summary",
        "",
        `Surface: ${summary.surfaceId}`,
        `Session: ${summary.sessionId}`,
        `Tool: ${summary.tool}`,
        `Guidance mode: ${summary.guidanceMode}`,
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
    if (summary.latestReview) {
        lines.push(`- latest review: ${summary.latestReview.status} (${summary.latestReview.findingCodes.join(", ")})`);
        lines.push(`- review rationale: ${summary.latestReview.rationale}`);
    }
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
    const summary = {
        schemaVersion: 3,
        surfaceId: session.surfaceId,
        sessionId: session.sessionId,
        tool: session.tool,
        guidanceMode: session.guidanceMode,
        attemptCount: attempts.length,
        firstPassAttempt,
        firstAcceptableAttempt,
        latestStatus,
        latestOutcome,
        recurringFindingCodes,
        recurringRepairCodes,
        latestAssessment,
        latestReview: latestAttempt.review,
        ...(session.brief ? { brief: session.brief } : {}),
        successRule: session.successRule,
        paths: {
            sessionPath: paths.sessionPath,
            bundleRoot: session.bundleRoot,
            preparedInputPath: session.preparedInputPath,
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
        `Baseline session: ${comparison.baseline.sessionId}`,
        `Guided session: ${comparison.guided.sessionId}`,
        `Meets goal: ${comparison.checks.meetsGoal ? "yes" : "no"}`,
        "",
        "## First attempt",
        `- baseline outcome: ${comparison.baseline.firstAttempt.outcome}`,
        `- guided outcome: ${comparison.guided.firstAttempt.outcome}`,
        `- blocking finding delta: ${comparison.delta.firstAttemptBlockingFindingCountDelta}`,
        `- warning finding delta: ${comparison.delta.firstAttemptWarningFindingCountDelta}`,
        "",
        "## Convergence",
        `- baseline first acceptable attempt: ${comparison.baseline.firstAcceptableAttempt ?? "not reached"}`,
        `- guided first acceptable attempt: ${comparison.guided.firstAcceptableAttempt ?? "not reached"}`,
        `- attempts-to-acceptable delta: ${comparison.delta.attemptsToAcceptableOutcome.delta ?? "n/a"}`,
        "",
        "## Rubric delta",
    ];
    for (const dimension of ASSESSMENT_DIMENSIONS) {
        const rubric = comparison.delta.rubric[dimension];
        lines.push(`- ${dimension}: ${rubric.baseline} -> ${rubric.guided} (${rubric.delta})`);
    }
    if (comparison.checks.guidedRubricBetterDimensions.length > 0) {
        lines.push("", `Guided improved dimensions: ${comparison.checks.guidedRubricBetterDimensions.join(", ")}`);
    }
    return `${lines.join("\n")}\n`;
}
function renderSuggestionsMarkdown(artifact) {
    const lines = [
        "# Contract Delta Suggestions",
        "",
        `Surface: ${artifact.surfaceId}`,
        `Session: ${artifact.sessionId}`,
        `Tool: ${artifact.tool}`,
        `Guidance mode: ${artifact.guidanceMode}`,
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
        `Guided fewer first-attempt blocking findings: ${report.overall.guidedFewerFirstAttemptBlockingFindings}`,
        `Guided reached acceptable no later: ${report.overall.guidedReachedAcceptableNoLater}`,
        "",
        "## Comparisons",
    ];
    for (const comparison of report.comparisons) {
        lines.push(`- ${comparison.surfaceId}: meetsGoal=${comparison.meetsGoal}, improved dimensions=${comparison.guidedRubricBetterDimensions.join(", ") || "none"}`);
    }
    lines.push("", "## Suggestion decisions");
    for (const suggestion of report.suggestions) {
        lines.push(`- ${suggestion.surfaceId}: proposed=${suggestion.proposedCount}, accepted=${suggestion.acceptedCount}, rejected=${suggestion.rejectedCount}`);
    }
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
    if (baselineBuilt.session.guidanceMode !== "unguided") {
        throw new SessionInputError("Baseline session must use guidanceMode=unguided.");
    }
    if (guidedBuilt.session.guidanceMode !== "prepared") {
        throw new SessionInputError("Guided session must use guidanceMode=prepared.");
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
    return {
        schemaVersion: 2,
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
            guidanceMode: baselineBuilt.session.guidanceMode,
            attemptCount: baselineBuilt.summary.attemptCount,
            firstAcceptableAttempt: baselineBuilt.summary.firstAcceptableAttempt,
            latestOutcome: baselineBuilt.summary.latestOutcome,
            firstAttempt: baselineFirstAttempt,
            latestAttempt: baselineLatestAttempt,
            recurringFindingCodes: baselineBuilt.summary.recurringFindingCodes,
            recurringRepairCodes: baselineBuilt.summary.recurringRepairCodes,
        },
        guided: {
            sessionId: guidedBuilt.session.sessionId,
            sessionDir: guidedBuilt.session.sessionDir,
            guidanceMode: guidedBuilt.session.guidanceMode,
            attemptCount: guidedBuilt.summary.attemptCount,
            firstAcceptableAttempt: guidedBuilt.summary.firstAcceptableAttempt,
            latestOutcome: guidedBuilt.summary.latestOutcome,
            firstAttempt: guidedFirstAttempt,
            latestAttempt: guidedLatestAttempt,
            recurringFindingCodes: guidedBuilt.summary.recurringFindingCodes,
            recurringRepairCodes: guidedBuilt.summary.recurringRepairCodes,
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
    if (built.session.guidanceMode !== "prepared") {
        throw new SessionInputError("Contract delta suggestions require a guided prepared session.");
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
        schemaVersion: 1,
        surfaceId: built.session.surfaceId,
        sessionId: built.session.sessionId,
        tool: built.session.tool,
        guidanceMode: built.session.guidanceMode,
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
        const guidanceMode = ensureGuidanceMode(options.guidanceMode);
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
        if (guidanceMode === "prepared") {
            const preparedPayload = buildPreparedGenerationPayload(sessionBundle);
            writeDeterministicJsonSync(paths.preparedInputPath, preparedPayload);
            preparedInputPath = paths.preparedInputPath;
        }
        const session = {
            schemaVersion: 2,
            surfaceId: options.surfaceId,
            sessionId,
            tool,
            guidanceMode,
            workspaceRoot,
            sourceBundleRoot: loadedBundle.root,
            sessionDir: paths.sessionDir,
            bundleRoot: paths.bundleRoot,
            preparedInputPath,
            contractPath: sessionBundle.contract.path,
            repairMapPath: sessionBundle.surface.repairMap.path,
            startedAt: new Date().toISOString(),
            ...(options.briefFile ? { brief: freezeBriefFile(paths.sessionDir, options.briefFile) } : {}),
            successRule: {
                finalStatus: "pass-or-reviewed-warn",
            },
        };
        writeDeterministicJsonSync(paths.sessionPath, session);
        process.stdout.write(`${JSON.stringify({ ok: true, session, paths }, null, 2)}\n`);
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
            schemaVersion: 2,
            surfaceId: session.surfaceId,
            sessionId: session.sessionId,
            attemptNumber,
            tool: session.tool,
            guidanceMode: session.guidanceMode,
            createdAt: new Date().toISOString(),
            validateStatus: response.status,
            validateExitCode: response.status === "block" ? 30 : 0,
            findingCodes,
            assessmentPath: attemptPaths.assessmentPath,
            validatePath: attemptPaths.validatePath,
            touchedFiles: assessment.touchedFiles ?? [],
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
            schemaVersion: 1,
            generatedAt: new Date().toISOString(),
            comparisons: comparisons.map(({ path: comparisonPath, value }) => ({
                surfaceId: value.surfaceId,
                tool: value.tool,
                comparisonPath,
                meetsGoal: value.checks.meetsGoal,
                guidedFewerFirstAttemptBlockingFindings: value.checks.guidedFewerFirstAttemptBlockingFindings,
                guidedReachedAcceptableNoLater: value.checks.guidedReachedAcceptableNoLater,
                guidedRubricBetterDimensions: value.checks.guidedRubricBetterDimensions,
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
