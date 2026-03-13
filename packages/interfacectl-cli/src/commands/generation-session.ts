import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  AdapterInputError,
  loadCompiledSurfaceBundle,
  readJsonFile,
  type JsonRecord,
} from "../adapter/bundle.js";
import { runGenerationAdapter } from "../adapter/core.js";
import { buildPreparedGenerationPayload } from "./prepare-generation.js";
import {
  emitContractRunArtifact,
  type RunArtifactStatus,
} from "../utils/run-artifacts.js";
import { stringifyDeterministicJson, writeDeterministicJsonSync } from "../utils/deterministic-json.js";

type SessionTool = "codex" | "cursor";
type AssessmentGrade = "strong" | "partial" | "weak";
type ValidateStatus = "pass" | "warn" | "block";

export interface InitGenerationSessionCommandOptions {
  bundleRoot?: string;
  surfaceId?: string;
  workspaceRoot?: string;
  tool?: string;
  sessionId?: string;
  artifactsRoot?: string;
}

export interface RecordGenerationAttemptCommandOptions {
  sessionDir?: string;
  assessmentFile?: string;
}

export interface SummarizeGenerationSessionCommandOptions {
  sessionDir?: string;
}

interface GenerationAssessment {
  structure: AssessmentGrade;
  visual: AssessmentGrade;
  responsiveness: AssessmentGrade;
  notes: string;
  touchedFiles?: string[];
}

interface GenerationSession {
  schemaVersion: 1;
  surfaceId: string;
  sessionId: string;
  tool: SessionTool;
  workspaceRoot: string;
  sourceBundleRoot: string;
  sessionDir: string;
  bundleRoot: string;
  preparedInputPath: string;
  contractPath: string;
  repairMapPath: string;
  startedAt: string;
  successRule: {
    finalStatus: "pass";
  };
}

interface GenerationSessionAttemptMetadata {
  schemaVersion: 1;
  surfaceId: string;
  sessionId: string;
  attemptNumber: number;
  tool: SessionTool;
  createdAt: string;
  validateStatus: ValidateStatus;
  validateExitCode: number;
  findingCodes: string[];
  assessmentPath: string;
  validatePath: string;
  touchedFiles: string[];
  contractRun: {
    deduped: boolean;
    runId: string;
    surfaceId: string;
    runsPath: string;
    lineagePath: string;
  } | null;
}

interface GenerationSessionSummary {
  schemaVersion: 1;
  surfaceId: string;
  sessionId: string;
  tool: SessionTool;
  attemptCount: number;
  firstPassAttempt: number | null;
  latestStatus: ValidateStatus;
  recurringFindingCodes: Array<{ code: string; count: number }>;
  recurringRepairCodes: Array<{
    code: string;
    count: number;
    priority: string;
    category: string;
    actionType: string;
  }>;
  latestAssessment: GenerationAssessment | null;
  successRule: {
    finalStatus: "pass";
  };
  paths: {
    sessionPath: string;
    bundleRoot: string;
    preparedInputPath: string;
  };
  attempts: Array<{
    attemptNumber: number;
    status: ValidateStatus;
    findingCodes: string[];
    validatePath: string;
    assessmentPath: string;
    metadataPath: string;
    createdAt?: string;
  }>;
}

const VALID_TOOLS = new Set<SessionTool>(["codex", "cursor"]);
const VALID_GRADES = new Set<AssessmentGrade>(["strong", "partial", "weak"]);

class SessionInputError extends Error {
  code: string;

  constructor(message: string, code = "generation-session.input") {
    super(message);
    this.name = "SessionInputError";
    this.code = code;
  }
}

function writeError(error: SessionInputError | AdapterInputError | Error, code: string) {
  process.stderr.write(
    `${JSON.stringify(
      {
        status: "error",
        code,
        error: error.message,
      },
      null,
      2,
    )}\n`,
  );
}

function ensureSessionTool(tool?: string): SessionTool {
  const normalized = typeof tool === "string" ? tool.trim().toLowerCase() : "codex";
  if (!VALID_TOOLS.has(normalized as SessionTool)) {
    throw new SessionInputError(`Invalid --tool value "${tool ?? ""}". Expected codex|cursor.`);
  }
  return normalized as SessionTool;
}

function buildDefaultSessionId(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function resolveWorkspaceRelative(workspaceRoot: string, candidate?: string): string {
  if (!candidate || candidate.trim().length === 0) {
    return path.join(workspaceRoot, "artifacts", "generation-sessions");
  }
  return path.isAbsolute(candidate) ? candidate : path.resolve(workspaceRoot, candidate);
}

function getSessionPaths(sessionDir: string) {
  return {
    sessionDir,
    sessionPath: path.join(sessionDir, "session.json"),
    bundleRoot: path.join(sessionDir, "bundle"),
    preparedInputPath: path.join(sessionDir, "prepared-input.json"),
    attemptsDir: path.join(sessionDir, "attempts"),
    summaryJsonPath: path.join(sessionDir, "summary.json"),
    summaryMarkdownPath: path.join(sessionDir, "summary.md"),
  };
}

function normalizeAssessment(payload: JsonRecord, filePath: string): GenerationAssessment {
  const grade = (key: keyof Pick<GenerationAssessment, "structure" | "visual" | "responsiveness">) => {
    const value = payload[key];
    if (!VALID_GRADES.has(value as AssessmentGrade)) {
      throw new SessionInputError(
        `Assessment field "${key}" must be one of strong|partial|weak: ${filePath}.`,
      );
    }
    return value as AssessmentGrade;
  };

  const notes = typeof payload.notes === "string" ? payload.notes.trim() : "";
  if (!notes) {
    throw new SessionInputError(`Assessment field "notes" must be a non-empty string: ${filePath}.`);
  }

  let touchedFiles: string[] | undefined;
  if (payload.touchedFiles !== undefined) {
    if (!Array.isArray(payload.touchedFiles)) {
      throw new SessionInputError(`Assessment field "touchedFiles" must be an array when provided: ${filePath}.`);
    }
    touchedFiles = [...new Set(
      payload.touchedFiles
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter(Boolean),
    )].sort((left, right) => left.localeCompare(right));
  }

  return {
    structure: grade("structure"),
    visual: grade("visual"),
    responsiveness: grade("responsiveness"),
    notes,
    ...(touchedFiles && touchedFiles.length > 0 ? { touchedFiles } : {}),
  };
}

function loadAssessment(assessmentPath: string): GenerationAssessment {
  const resolvedPath = path.resolve(assessmentPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new SessionInputError(`Assessment file not found at ${resolvedPath}.`);
  }
  return normalizeAssessment(readJsonFile<JsonRecord>(resolvedPath, "generation assessment"), resolvedPath);
}

function loadSession(sessionDirInput: string): { session: GenerationSession; paths: ReturnType<typeof getSessionPaths> } {
  const sessionDir = path.resolve(sessionDirInput);
  const paths = getSessionPaths(sessionDir);
  if (!fs.existsSync(paths.sessionPath)) {
    throw new SessionInputError(`Generation session not found at ${paths.sessionPath}.`);
  }

  const session = readJsonFile(paths.sessionPath, "generation session") as unknown as GenerationSession;
  if (session.schemaVersion !== 1) {
    throw new SessionInputError(`Unsupported generation session schemaVersion "${String((session as unknown as JsonRecord).schemaVersion ?? "unknown")}".`);
  }
  if (!VALID_TOOLS.has(session.tool)) {
    throw new SessionInputError(`Unsupported session tool "${session.tool}".`);
  }

  return {
    session,
    paths,
  };
}

function nextAttemptNumber(attemptsDir: string): number {
  if (!fs.existsSync(attemptsDir)) {
    return 1;
  }

  const seen = fs.readdirSync(attemptsDir)
    .map((entry) => /^(\d{3})\.metadata\.json$/.exec(entry))
    .filter((match): match is RegExpExecArray => Boolean(match))
    .map((match) => Number.parseInt(match[1], 10));

  if (seen.length === 0) {
    return 1;
  }
  return Math.max(...seen) + 1;
}

function formatAttemptNumber(attemptNumber: number): string {
  return String(attemptNumber).padStart(3, "0");
}

function mapAdapterStatusToRunStatus(status: ValidateStatus): RunArtifactStatus {
  switch (status) {
    case "pass":
      return "pass";
    case "warn":
      return "warn";
    case "block":
      return "fail";
  }
}

function parseFindingCodes(validatePayload: JsonRecord): string[] {
  const findings = Array.isArray(validatePayload.findings) ? validatePayload.findings : [];
  return [...new Set(
    findings
      .map((finding) => {
        if (!finding || typeof finding !== "object") return "";
        const code = (finding as Record<string, unknown>).code;
        return typeof code === "string" ? code : "";
      })
      .filter(Boolean),
  )].sort((left, right) => left.localeCompare(right));
}

function buildRecurringCounts(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([code, count]) => ({ code, count }))
    .sort((left, right) => right.count - left.count || left.code.localeCompare(right.code));
}

function renderSummaryMarkdown(summary: GenerationSessionSummary): string {
  const lines = [
    "# Generation Session Summary",
    "",
    `Surface: ${summary.surfaceId}`,
    `Session: ${summary.sessionId}`,
    `Tool: ${summary.tool}`,
    `Latest status: ${summary.latestStatus}`,
    `Attempts: ${summary.attemptCount}`,
    `First pass attempt: ${summary.firstPassAttempt ?? "not yet reached"}`,
    "",
    "## Recurring finding codes",
  ];

  if (summary.recurringFindingCodes.length === 0) {
    lines.push("None.");
  } else {
    for (const item of summary.recurringFindingCodes) {
      lines.push(`- ${item.code}: ${item.count}`);
    }
  }

  lines.push("", "## Recurring repair codes");
  if (summary.recurringRepairCodes.length === 0) {
    lines.push("None.");
  } else {
    for (const item of summary.recurringRepairCodes) {
      lines.push(`- ${item.code}: ${item.count} (${item.priority})`);
    }
  }

  lines.push("", "## Latest assessment");
  lines.push(`- structure: ${summary.latestAssessment?.structure ?? "n/a"}`);
  lines.push(`- visual: ${summary.latestAssessment?.visual ?? "n/a"}`);
  lines.push(`- responsiveness: ${summary.latestAssessment?.responsiveness ?? "n/a"}`);
  lines.push(`- notes: ${summary.latestAssessment?.notes ?? "n/a"}`);

  if (summary.latestAssessment?.touchedFiles?.length) {
    lines.push(`- touched files: ${summary.latestAssessment.touchedFiles.join(", ")}`);
  }

  return `${lines.join("\n")}\n`;
}

export async function runInitGenerationSessionCommand(
  options: InitGenerationSessionCommandOptions,
): Promise<number> {
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
    const preparedPayload = buildPreparedGenerationPayload(sessionBundle);
    writeDeterministicJsonSync(paths.preparedInputPath, preparedPayload);

    const session: GenerationSession = {
      schemaVersion: 1,
      surfaceId: options.surfaceId,
      sessionId,
      tool,
      workspaceRoot,
      sourceBundleRoot: loadedBundle.root,
      sessionDir: paths.sessionDir,
      bundleRoot: paths.bundleRoot,
      preparedInputPath: paths.preparedInputPath,
      contractPath: sessionBundle.contract.path,
      repairMapPath: sessionBundle.surface.repairMap.path,
      startedAt: new Date().toISOString(),
      successRule: {
        finalStatus: "pass",
      },
    };
    writeDeterministicJsonSync(paths.sessionPath, session);

    process.stdout.write(
      `${JSON.stringify({ ok: true, session, paths }, null, 2)}\n`,
    );
    return 0;
  } catch (error) {
    if (error instanceof SessionInputError || error instanceof AdapterInputError) {
      writeError(error, error.code);
      return 10;
    }
    writeError(error instanceof Error ? error : new Error(String(error)), "generation-session.internal");
    return 1;
  }
}

export async function runRecordGenerationAttemptCommand(
  options: RecordGenerationAttemptCommandOptions,
): Promise<number> {
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
    const attemptId = formatAttemptNumber(attemptNumber);
    fs.mkdirSync(paths.attemptsDir, { recursive: true });

    const validatePath = path.join(paths.attemptsDir, `${attemptId}.validate.json`);
    const assessmentPath = path.join(paths.attemptsDir, `${attemptId}.assessment.json`);
    const metadataPath = path.join(paths.attemptsDir, `${attemptId}.metadata.json`);

    const response = await runGenerationAdapter(
      {
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
      },
      {
        cwd: process.cwd(),
      },
    );

    writeDeterministicJsonSync(validatePath, response);
    writeDeterministicJsonSync(assessmentPath, assessment);

    const findingCodes = parseFindingCodes(response as unknown as JsonRecord);
    const contractRun = emitContractRunArtifact({
      rootDir: session.workspaceRoot,
      contractPath: session.contractPath,
      surfaceId: session.surfaceId,
      source: "generation",
      status: mapAdapterStatusToRunStatus(response.status),
      reportPath: validatePath,
      findingCodes,
      workspaceId: session.sessionId,
      idempotencyKey: `${session.surfaceId}:${session.sessionId}:${attemptId}`,
    });

    const metadata: GenerationSessionAttemptMetadata = {
      schemaVersion: 1,
      surfaceId: session.surfaceId,
      sessionId: session.sessionId,
      attemptNumber,
      tool: session.tool,
      createdAt: new Date().toISOString(),
      validateStatus: response.status,
      validateExitCode: response.status === "block" ? 30 : 0,
      findingCodes,
      assessmentPath,
      validatePath,
      touchedFiles: assessment.touchedFiles ?? [],
      contractRun,
    };
    writeDeterministicJsonSync(metadataPath, metadata);

    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          session,
          attempt: {
            attemptNumber,
            validatePath,
            assessmentPath,
            metadataPath,
            validateStatus: response.status,
            findingCodes,
          },
        },
        null,
        2,
      )}\n`,
    );
    return 0;
  } catch (error) {
    if (error instanceof SessionInputError || error instanceof AdapterInputError) {
      writeError(error, error.code);
      return 10;
    }
    writeError(error instanceof Error ? error : new Error(String(error)), "generation-session.internal");
    return 1;
  }
}

export async function runSummarizeGenerationSessionCommand(
  options: SummarizeGenerationSessionCommandOptions,
): Promise<number> {
  try {
    if (!options.sessionDir) {
      throw new SessionInputError("--session-dir is required.");
    }
    const { session, paths } = loadSession(options.sessionDir);

    if (!fs.existsSync(paths.attemptsDir)) {
      throw new SessionInputError(`No attempts recorded for session ${session.sessionId}.`);
    }

    const attemptNumbers = fs.readdirSync(paths.attemptsDir)
      .map((entry) => /^(\d{3})\.metadata\.json$/.exec(entry))
      .filter((match): match is RegExpExecArray => Boolean(match))
      .map((match) => Number.parseInt(match[1], 10))
      .sort((left, right) => left - right);

    if (attemptNumbers.length === 0) {
      throw new SessionInputError(`No attempts recorded for session ${session.sessionId}.`);
    }

    const attempts = attemptNumbers.map((attemptNumber) => {
      const attemptId = formatAttemptNumber(attemptNumber);
      const validatePath = path.join(paths.attemptsDir, `${attemptId}.validate.json`);
      const assessmentPath = path.join(paths.attemptsDir, `${attemptId}.assessment.json`);
      const metadataPath = path.join(paths.attemptsDir, `${attemptId}.metadata.json`);

      return {
        attemptNumber,
        validate: readJsonFile<JsonRecord>(validatePath, `attempt ${attemptId} validate payload`),
        assessment: readJsonFile<JsonRecord>(assessmentPath, `attempt ${attemptId} assessment`),
        metadata: readJsonFile<JsonRecord>(metadataPath, `attempt ${attemptId} metadata`),
        validatePath,
        assessmentPath,
        metadataPath,
      };
    });

    const firstPassAttempt = attempts.find((attempt) => attempt.validate.status === "pass")?.attemptNumber ?? null;
    const latestAttempt = attempts[attempts.length - 1];
    const recurringFindingCodes = buildRecurringCounts(
      attempts.flatMap((attempt) => parseFindingCodes(attempt.validate)),
    );
    const repairMapDoc = readJsonFile<JsonRecord>(session.repairMapPath, "repair map");
    const repairs = Array.isArray(repairMapDoc.repairs) ? repairMapDoc.repairs : [];
    const repairMapByCode = new Map(
      repairs
        .filter((entry): entry is JsonRecord => Boolean(entry) && typeof entry === "object")
        .map((entry) => [typeof entry.code === "string" ? entry.code : "", entry] as const)
        .filter(([code]) => Boolean(code)),
    );
    const recurringRepairCodes = recurringFindingCodes
      .map((entry) => {
        const repair = repairMapByCode.get(entry.code);
        if (!repair) return undefined;
        const action = repair.action && typeof repair.action === "object"
          ? (repair.action as Record<string, unknown>)
          : {};
        return {
          code: entry.code,
          count: entry.count,
          priority: typeof repair.priority === "string" ? repair.priority : "medium",
          category: typeof repair.category === "string" ? repair.category : "unknown",
          actionType: typeof action.type === "string" ? action.type : "unknown",
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
      .sort((left, right) => right.count - left.count || left.code.localeCompare(right.code));

    const latestAssessment = normalizeAssessment(latestAttempt.assessment, latestAttempt.assessmentPath);
    const latestStatus = latestAttempt.validate.status;
    if (latestStatus !== "pass" && latestStatus !== "warn" && latestStatus !== "block") {
      throw new SessionInputError(`Unsupported validate status "${String(latestStatus)}" in ${latestAttempt.validatePath}.`);
    }

    const summary: GenerationSessionSummary = {
      schemaVersion: 1,
      surfaceId: session.surfaceId,
      sessionId: session.sessionId,
      tool: session.tool,
      attemptCount: attempts.length,
      firstPassAttempt,
      latestStatus,
      recurringFindingCodes,
      recurringRepairCodes,
      latestAssessment,
      successRule: session.successRule,
      paths: {
        sessionPath: paths.sessionPath,
        bundleRoot: session.bundleRoot,
        preparedInputPath: session.preparedInputPath,
      },
      attempts: attempts.map((attempt) => ({
        attemptNumber: attempt.attemptNumber,
        status: attempt.validate.status as ValidateStatus,
        findingCodes: parseFindingCodes(attempt.validate),
        validatePath: attempt.validatePath,
        assessmentPath: attempt.assessmentPath,
        metadataPath: attempt.metadataPath,
        createdAt: typeof attempt.metadata.createdAt === "string" ? attempt.metadata.createdAt : undefined,
      })),
    };

    writeDeterministicJsonSync(paths.summaryJsonPath, summary);
    fs.writeFileSync(paths.summaryMarkdownPath, renderSummaryMarkdown(summary), "utf8");
    process.stdout.write(`${JSON.stringify({ ok: true, summary, paths }, null, 2)}\n`);
    return latestStatus === "pass" ? 0 : 30;
  } catch (error) {
    if (error instanceof SessionInputError || error instanceof AdapterInputError) {
      writeError(error, error.code);
      return 10;
    }
    writeError(error instanceof Error ? error : new Error(String(error)), "generation-session.internal");
    return 1;
  }
}
