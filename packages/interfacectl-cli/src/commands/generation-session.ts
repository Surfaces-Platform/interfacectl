import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import {
  AdapterInputError,
  isRecord,
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

type SessionTool = "codex" | "cursor" | "local-llm";
type AssessmentGrade = "strong" | "partial" | "weak";
type ValidateStatus = "pass" | "warn" | "block";
type GuidanceStrategy = "prompt-summary" | "baseline-primary" | "json-primary" | "unguided";
type SessionSuccessRule = "pass" | "pass-or-reviewed-warn";
type AttemptReviewStatus = "accepted" | "rejected";
type AttemptOutcome = ValidateStatus | "accepted-warn";
type SuggestionStatus = "proposed" | "accepted" | "rejected";
type EvaluationMode = "zero-shot" | "iterative";
type PlatformTarget = "web" | "ios" | "android";
type ConsumerType = "web-browser" | "desktop-shell" | "ios-native" | "android-native";

type AssessmentDimension =
  | "structure"
  | "components"
  | "boundary"
  | "visual"
  | "responsiveness"
  | "platformFit";

export interface InitGenerationSessionCommandOptions {
  bundleRoot?: string;
  surfaceId?: string;
  workspaceRoot?: string;
  tool?: string;
  sessionId?: string;
  artifactsRoot?: string;
  guidanceStrategy?: string;
  guidanceMode?: string;
  briefFile?: string;
}

export interface PrepareGenerationHandoffCommandOptions {
  sessionDir?: string;
  guidanceStrategy?: string;
  acceptedSuggestionsFile?: string;
  designerNotesFile?: string;
  findingCodes?: string;
  outPath?: string;
}

export interface RecordGenerationAttemptCommandOptions {
  sessionDir?: string;
  assessmentFile?: string;
}

export interface CaptureGenerationPreviewCommandOptions {
  sessionDir?: string;
  attemptNumber?: string | number;
  url?: string;
  waitFor?: string;
  storageStatePath?: string;
}

export interface ReviewGenerationAttemptCommandOptions {
  sessionDir?: string;
  attemptNumber?: string | number;
  reviewFile?: string;
}

export interface SummarizeGenerationSessionCommandOptions {
  sessionDir?: string;
}

export interface CompareGenerationSessionsCommandOptions {
  baselineSessionDir?: string;
  guidedSessionDir?: string;
  outDir?: string;
}

export interface SuggestContractDeltasCommandOptions {
  sessionDir?: string;
  outPath?: string;
}

export interface ReviewContractDeltaSuggestionsCommandOptions {
  suggestionsPath?: string;
  reviewFile?: string;
  outPath?: string;
}

export interface SummarizeGenerationBenchmarkCommandOptions {
  comparisonPaths?: string;
  suggestionPaths?: string;
  outDir?: string;
  runPath?: string;
}

export interface ReplayGenerationBenchmarkCommandOptions {
  specPath?: string;
  tool?: string;
  outDir?: string;
  cohortId?: string;
  sourceRunPath?: string;
  requestedModelLabel?: string;
  resolvedModelId?: string;
  baseUrl?: string;
  fingerprint?: string;
}

interface GenerationAssessment {
  structure: AssessmentGrade;
  components: AssessmentGrade;
  boundary: AssessmentGrade;
  visual: AssessmentGrade;
  responsiveness: AssessmentGrade;
  platformFit: AssessmentGrade;
  notes: string;
  touchedFiles?: string[];
  heuristics?: GenerationAssessmentHeuristics;
}

interface GenerationBrief {
  path: string;
  sha256: string;
}

interface GenerationSession {
  schemaVersion: 3;
  surfaceId: string;
  sessionId: string;
  tool: SessionTool;
  guidanceStrategy: GuidanceStrategy;
  workspaceRoot: string;
  sourceBundleRoot: string;
  sessionDir: string;
  bundleRoot: string;
  preparedInputPath: string | null;
  contractPath: string;
  repairMapPath: string;
  guidanceArtifacts: {
    baseHandoffPath: string | null;
  };
  startedAt: string;
  brief?: GenerationBrief;
  successRule: {
    finalStatus: SessionSuccessRule;
  };
}

interface GenerationAttemptReview {
  schemaVersion: 1;
  surfaceId: string;
  sessionId: string;
  attemptNumber: number;
  status: AttemptReviewStatus;
  findingCodes: string[];
  rationale: string;
  reviewedAt: string;
}

interface GenerationAttemptPreview {
  schemaVersion: 1;
  surfaceId: string;
  sessionId: string;
  attemptNumber: number;
  url: string;
  finalUrl: string;
  imagePath: string;
  capturedAt: string;
  viewport: {
    width: number;
    height: number;
  };
  pageTitle?: string;
  waitFor?: string;
}

interface GenerationSessionAttemptMetadata {
  schemaVersion: 3;
  surfaceId: string;
  sessionId: string;
  attemptNumber: number;
  tool: SessionTool;
  guidanceStrategy: GuidanceStrategy;
  createdAt: string;
  validateStatus: ValidateStatus;
  validateExitCode: number;
  findingCodes: string[];
  assessmentPath: string;
  validatePath: string;
  touchedFiles: string[];
  guidanceHandoffPath: string | null;
  contractRun: {
    deduped: boolean;
    runId: string;
    surfaceId: string;
    runsPath: string;
    lineagePath: string;
  } | null;
}

interface GenerationSessionSummary {
  schemaVersion: 4;
  surfaceId: string;
  sessionId: string;
  tool: SessionTool;
  guidanceStrategy: GuidanceStrategy;
  attemptCount: number;
  firstPassAttempt: number | null;
  firstAcceptableAttempt: number | null;
  latestStatus: ValidateStatus;
  latestOutcome: AttemptOutcome;
  recurringFindingCodes: Array<{ code: string; count: number }>;
  recurringRepairCodes: Array<{
    code: string;
    count: number;
    priority: string;
    category: string;
    actionType: string;
  }>;
  latestAssessment: GenerationAssessment | null;
  latestReview: GenerationAttemptReview | null;
  heuristics: GenerationSessionHeuristics;
  brief?: GenerationBrief;
  successRule: {
    finalStatus: SessionSuccessRule;
  };
  paths: {
    sessionPath: string;
    bundleRoot: string;
    preparedInputPath: string | null;
    guidanceHandoffPath: string | null;
  };
  attempts: Array<{
    attemptNumber: number;
    status: ValidateStatus;
    outcome: AttemptOutcome;
    findingCodes: string[];
    validatePath: string;
    assessmentPath: string;
    metadataPath: string;
    reviewPath?: string;
    reviewStatus?: AttemptReviewStatus;
    createdAt?: string;
    preview?: {
      imagePath: string;
      metadataPath: string;
      url: string;
      finalUrl: string;
      capturedAt: string;
      waitFor?: string;
    };
  }>;
}

interface SessionComparisonSnapshot {
  sessionId: string;
  sessionDir: string;
  guidanceStrategy: GuidanceStrategy;
  attemptCount: number;
  firstAcceptableAttempt: number | null;
  latestOutcome: AttemptOutcome;
  firstAttempt: ComparisonAttemptSnapshot;
  latestAttempt: ComparisonAttemptSnapshot;
  recurringFindingCodes: Array<{ code: string; count: number }>;
  recurringRepairCodes: Array<{
    code: string;
    count: number;
    priority: string;
    category: string;
    actionType: string;
  }>;
  heuristics: GenerationSessionHeuristics;
}

interface ComparisonAttemptSnapshot {
  attemptNumber: number;
  status: ValidateStatus;
  outcome: AttemptOutcome;
  findingCount: number;
  blockingFindingCount: number;
  warningFindingCount: number;
  findingCodes: string[];
  assessment: GenerationAssessment;
  preview?: {
    imagePath: string;
    metadataPath: string;
    url: string;
    finalUrl: string;
    capturedAt: string;
    waitFor?: string;
  };
}

interface GenerationSessionComparison {
  schemaVersion: 3;
  surfaceId: string;
  tool: SessionTool;
  brief: {
    sha256: string;
    baselinePath: string;
    guidedPath: string;
  };
  baseline: SessionComparisonSnapshot;
  guided: SessionComparisonSnapshot;
  delta: {
    firstAttemptVerdict: {
      baseline: AttemptOutcome;
      guided: AttemptOutcome;
    };
    firstAttemptFindingCountDelta: number;
    firstAttemptBlockingFindingCountDelta: number;
    firstAttemptWarningFindingCountDelta: number;
    latestFindingCountDelta: number;
    attemptsToAcceptableOutcome: {
      baseline: number | null;
      guided: number | null;
      delta: number | null;
    };
      rubric: Record<AssessmentDimension, {
      baseline: AssessmentGrade;
      guided: AssessmentGrade;
      delta: number;
    }>;
  };
  heuristics: GenerationComparisonHeuristics;
  checks: {
    guidedFewerFirstAttemptBlockingFindings: boolean;
    guidedReachedAcceptableNoLater: boolean;
    guidedRubricAtLeastAsGood: boolean;
    guidedRubricBetterDimensions: AssessmentDimension[];
    meetsGoal: boolean;
  };
  paths: {
    baselineSessionDir: string;
    guidedSessionDir: string;
  };
}

interface ContractDeltaSuggestion {
  suggestionId: string;
  findingCode: string;
  findingMessage: string;
  repeatedFailureCount: number;
  confidence: number;
  status: SuggestionStatus;
  repair: {
    priority: string;
    category: string;
    actionType: string;
  };
  evidenceRefs: unknown[];
  proposedChange: {
    path: string;
    actionType: string;
    summary: string;
    valueHints: string[];
  };
  decision?: {
    rationale: string;
    decidedAt: string;
  };
}

interface ContractDeltaSuggestionsArtifact {
  schemaVersion: 2;
  surfaceId: string;
  sessionId: string;
  tool: SessionTool;
  guidanceStrategy: GuidanceStrategy;
  generatedAt: string;
  contract: {
    path: string;
  };
  session: {
    sessionPath: string;
    summaryPath: string;
    repairMapPath: string;
  };
  suggestions: ContractDeltaSuggestion[];
}

interface GenerationBenchmarkReport {
  schemaVersion: 3;
  generatedAt: string;
  run?: {
    cohortId: string;
    evaluationMode: EvaluationMode;
    tool: SessionTool;
    sourceSpecPath: string;
    sourceRunPath: string | null;
    guidanceStrategies: GuidanceStrategy[];
    attemptBudget: number;
    model: {
      requestedModelLabel: string | null;
      resolvedModelId: string | null;
      baseUrl: string | null;
      fingerprint: string | null;
    };
  };
  comparisons: Array<{
    surfaceId: string;
    tool: SessionTool;
    comparisonPath: string;
    meetsGoal: boolean;
    baselineGuidanceStrategy: GuidanceStrategy;
    guidedGuidanceStrategy: GuidanceStrategy;
    platformTarget?: PlatformTarget;
    consumerType?: ConsumerType;
    modelLabel?: string | null;
    guidedFewerFirstAttemptBlockingFindings: boolean;
    guidedReachedAcceptableNoLater: boolean;
    guidedRubricBetterDimensions: AssessmentDimension[];
    heuristics: GenerationComparisonHeuristics["delta"];
  }>;
  suggestions: Array<{
    surfaceId: string;
    sessionId: string;
    suggestionsPath: string;
    proposedCount: number;
    acceptedCount: number;
    rejectedCount: number;
  }>;
  overall: {
    surfaceCount: number;
    surfacesMeetingGoal: number;
    guidedFewerFirstAttemptBlockingFindings: number;
    guidedReachedAcceptableNoLater: number;
    acceptedSuggestionCount: number;
    rejectedSuggestionCount: number;
    proposedSuggestionCount: number;
    heuristics: GenerationBenchmarkHeuristicsSummary;
  };
  breakdowns?: {
    byPlatformTarget: Record<string, GenerationBenchmarkBreakdownSummary>;
    byConsumerType: Record<string, GenerationBenchmarkBreakdownSummary>;
    byModelLabel: Record<string, GenerationBenchmarkBreakdownSummary>;
  };
}

interface GenerationBenchmarkBreakdownSummary {
  comparisonCount: number;
  surfaceCount: number;
  surfacesMeetingGoal: number;
  guidedFewerFirstAttemptBlockingFindings: number;
  guidedReachedAcceptableNoLater: number;
}

interface GenerationAssessmentHeuristics {
  unresolvedAcceptedSuggestionCount?: number;
  unresolvedAcceptedSuggestionRate?: number | null;
  noChangesAfterEditFailureCount?: number;
  recoverableToolErrorCount?: number;
  touchedFilesPerResolvedFinding?: number | null;
}

interface GenerationSessionHeuristics {
  latestAttempt: GenerationAssessmentHeuristics;
  repeatedFindingCarryoverCount: number;
  rerunsToAcceptableOutcome: number | null;
}

interface GenerationComparisonHeuristics {
  baseline: GenerationSessionHeuristics;
  guided: GenerationSessionHeuristics;
  delta: {
    unresolvedAcceptedSuggestionRate: number | null;
    noChangesAfterEditFailureCount: number;
    recoverableToolErrorCount: number;
    touchedFilesPerResolvedFinding: number | null;
    repeatedFindingCarryoverCount: number;
    rerunsToAcceptableOutcome: number | null;
  };
}

interface GenerationBenchmarkHeuristicsSummary {
  lowerUnresolvedAcceptedSuggestionRate: number;
  lowerNoChangesAfterEditFailureCount: number;
  lowerRecoverableToolErrorCount: number;
  lowerTouchedFilesPerResolvedFinding: number;
  lowerRepeatedFindingCarryoverCount: number;
  lowerRerunsToAcceptableOutcome: number;
  averageDelta: {
    unresolvedAcceptedSuggestionRate: number | null;
    noChangesAfterEditFailureCount: number | null;
    recoverableToolErrorCount: number | null;
    touchedFilesPerResolvedFinding: number | null;
    repeatedFindingCarryoverCount: number | null;
    rerunsToAcceptableOutcome: number | null;
  };
}

interface RuntimeAcceptedSuggestion {
  findingCode: string;
  findingMessage: string;
  summary: string;
  suggestedPath: string;
  rationale?: string;
}

interface GenerationGuidanceHandoff {
  schemaVersion: 1;
  surfaceId: string;
  sessionId: string;
  tool: SessionTool;
  guidanceStrategy: GuidanceStrategy;
  generatedAt: string;
  brief: ({
    text: string;
  } & GenerationBrief) | null;
  session: {
    sessionPath: string;
    preparedInputPath: string | null;
    contractPath: string;
    repairMapPath: string;
  };
  runtimeGuidance: {
    findingCodes: string[];
    matchedRepairCodes: string[];
    acceptedSuggestions: RuntimeAcceptedSuggestion[];
    designerNotes: string[];
  };
  promptSummary: {
    effectiveContractSummary: string;
    preparedGuidanceSummary: string;
  } | null;
  baselinePrimary: {
    effectiveContractSummary: string;
    baselineContractSummary: string;
  } | null;
  jsonPrimary: {
    surface: Record<string, unknown>;
    contract: Record<string, unknown>;
    summary: Record<string, unknown>;
    generation: Record<string, unknown>;
    constraints: Record<string, unknown>;
    sections: Array<Record<string, unknown>>;
    components: Array<Record<string, unknown>>;
    repairMap: Array<Record<string, unknown>>;
    matchedRepairs: Array<Record<string, unknown>>;
  } | null;
}

interface LoadedAttempt {
  attemptNumber: number;
  validate: JsonRecord;
  assessment: JsonRecord;
  metadata: JsonRecord;
  review: GenerationAttemptReview | null;
  preview: GenerationAttemptPreview | null;
  validatePath: string;
  assessmentPath: string;
  metadataPath: string;
  reviewPath?: string;
  previewMetadataPath?: string;
}

interface GenerationBenchmarkSpecFixture {
  fixtureId: string;
  surfaceId: string;
  brief: GenerationBrief;
  platformTarget: PlatformTarget;
  consumerType: ConsumerType;
  capturePreset: string;
  comparisonPairs: Array<{
    baselineGuidanceStrategy: GuidanceStrategy;
    guidedGuidanceStrategy: GuidanceStrategy;
  }>;
  paths?: {
    fixtureDir?: string;
    sourceContractPath?: string;
    sourceAstPath?: string;
    bundleRoot?: string;
    compiledContractPath?: string;
    effectiveAstPath?: string;
    preparedInputPath?: string;
    acceptedSuggestionsPath?: string;
    designerNotesPath?: string;
    baselineValidatePath?: string;
  };
}

interface GenerationBenchmarkSpec {
  schemaVersion: 1;
  specId: string;
  generatedAt: string;
  evaluationMode: EvaluationMode;
  attemptBudget: number;
  guidanceStrategies: GuidanceStrategy[];
  comparisonPairs: Array<{
    baselineGuidanceStrategy: GuidanceStrategy;
    guidedGuidanceStrategy: GuidanceStrategy;
  }>;
  suiteId?: string;
  suiteName?: string;
  fixtures: GenerationBenchmarkSpecFixture[];
}

interface GenerationBenchmarkRunFixture extends GenerationBenchmarkSpecFixture {
  sessions: Array<{
    guidanceStrategy: GuidanceStrategy;
    sessionId: string;
    sessionDir: string;
    transcriptPath: string;
    guidanceHandoffPath: string;
    agentInputPath: string;
    explainabilityPath: string;
    summaryPath: string;
    previewPath: string | null;
  }>;
  comparisons: Array<{
    baselineGuidanceStrategy: GuidanceStrategy;
    guidedGuidanceStrategy: GuidanceStrategy;
    comparisonDir: string;
    comparisonPath: string;
  }>;
}

interface GenerationBenchmarkRun {
  schemaVersion: 1;
  cohortId: string;
  generatedAt: string;
  evaluationMode: EvaluationMode;
  tool: SessionTool;
  sourceSpecPath: string;
  sourceRunPath: string | null;
  attemptBudget: number;
  guidanceStrategies: GuidanceStrategy[];
  comparisonPairs: Array<{
    baselineGuidanceStrategy: GuidanceStrategy;
    guidedGuidanceStrategy: GuidanceStrategy;
  }>;
  model: {
    requestedModelLabel: string | null;
    resolvedModelId: string | null;
    baseUrl: string | null;
    fingerprint: string | null;
  };
  suiteId?: string;
  suiteName?: string;
  paths: {
    benchmarkDir: string;
    specPath: string;
    runPath: string;
    reportJsonPath: string | null;
    reportMarkdownPath: string | null;
  };
  fixtures: GenerationBenchmarkRunFixture[];
}

const VALID_TOOLS = new Set<SessionTool>(["codex", "cursor", "local-llm"]);
const VALID_GRADES = new Set<AssessmentGrade>(["strong", "partial", "weak"]);
const VALID_GUIDANCE_STRATEGIES = new Set<GuidanceStrategy>(["prompt-summary", "baseline-primary", "json-primary", "unguided"]);
const VALID_REVIEW_STATUSES = new Set<AttemptReviewStatus>(["accepted", "rejected"]);
const VALID_SUGGESTION_STATUSES = new Set<SuggestionStatus>(["proposed", "accepted", "rejected"]);
const VALID_SUCCESS_RULES = new Set<SessionSuccessRule>(["pass", "pass-or-reviewed-warn"]);
const VALID_EVALUATION_MODES = new Set<EvaluationMode>(["zero-shot", "iterative"]);
const VALID_PLATFORM_TARGETS = new Set<PlatformTarget>(["web", "ios", "android"]);
const VALID_CONSUMER_TYPES = new Set<ConsumerType>(["web-browser", "desktop-shell", "ios-native", "android-native"]);
const ASSESSMENT_DIMENSIONS: AssessmentDimension[] = [
  "structure",
  "components",
  "boundary",
  "visual",
  "responsiveness",
  "platformFit",
];

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

function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter(Boolean),
  )].sort((left, right) => left.localeCompare(right));
}

function sameStringSet(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function countBySeverity(validatePayload: JsonRecord) {
  const findings = Array.isArray(validatePayload.findings) ? validatePayload.findings : [];
  let errors = 0;
  let warnings = 0;
  for (const finding of findings) {
    if (!finding || typeof finding !== "object") continue;
    const severity = (finding as Record<string, unknown>).severity;
    if (severity === "error") {
      errors += 1;
    } else if (severity === "warning") {
      warnings += 1;
    }
  }
  return { errors, warnings, total: errors + warnings };
}

function ensureSessionTool(tool?: string): SessionTool {
  const normalized = typeof tool === "string" ? tool.trim().toLowerCase() : "codex";
  if (!VALID_TOOLS.has(normalized as SessionTool)) {
    throw new SessionInputError(`Invalid --tool value "${tool ?? ""}". Expected codex|cursor|local-llm.`);
  }
  return normalized as SessionTool;
}

function ensureGuidanceStrategy(guidanceStrategy?: string): GuidanceStrategy {
  const normalized = typeof guidanceStrategy === "string" ? guidanceStrategy.trim().toLowerCase() : "prompt-summary";
  const mapped = normalized === "prepared" ? "prompt-summary" : normalized;
  if (!VALID_GUIDANCE_STRATEGIES.has(mapped as GuidanceStrategy)) {
    throw new SessionInputError(
      `Invalid guidance strategy "${guidanceStrategy ?? ""}". Expected prompt-summary|baseline-primary|json-primary|unguided.`,
    );
  }
  return mapped as GuidanceStrategy;
}

function ensureEvaluationMode(value?: string): EvaluationMode {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "zero-shot";
  if (!VALID_EVALUATION_MODES.has(normalized as EvaluationMode)) {
    throw new SessionInputError(`Invalid evaluation mode "${value ?? ""}". Expected zero-shot|iterative.`);
  }
  return normalized as EvaluationMode;
}

function ensurePlatformTarget(value: unknown, label: string): PlatformTarget {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!VALID_PLATFORM_TARGETS.has(normalized as PlatformTarget)) {
    throw new SessionInputError(`Invalid ${label} "${String(value ?? "")}". Expected web|ios|android.`);
  }
  return normalized as PlatformTarget;
}

function ensureConsumerType(value: unknown, label: string): ConsumerType {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!VALID_CONSUMER_TYPES.has(normalized as ConsumerType)) {
    throw new SessionInputError(
      `Invalid ${label} "${String(value ?? "")}". Expected web-browser|desktop-shell|ios-native|android-native.`,
    );
  }
  return normalized as ConsumerType;
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
    guidanceHandoffPath: path.join(sessionDir, "guidance-handoff.json"),
    attemptsDir: path.join(sessionDir, "attempts"),
    summaryJsonPath: path.join(sessionDir, "summary.json"),
    summaryMarkdownPath: path.join(sessionDir, "summary.md"),
    suggestionsJsonPath: path.join(sessionDir, "contract-delta-suggestions.json"),
    suggestionsMarkdownPath: path.join(sessionDir, "contract-delta-suggestions.md"),
  };
}

function getAttemptPaths(attemptsDir: string, attemptNumber: number) {
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

function normalizeAssessment(
  payload: JsonRecord,
  filePath: string,
  options: { allowLegacyMissing?: boolean } = {},
): GenerationAssessment {
  const structureFallback = payload.structure;
  const grade = (key: AssessmentDimension) => {
    let value = payload[key];
    if (
      value === undefined
      && options.allowLegacyMissing
      && (key === "components" || key === "boundary" || key === "platformFit")
    ) {
      value = structureFallback;
    }
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

  let heuristics: GenerationAssessmentHeuristics | undefined;
  if (payload.heuristics !== undefined) {
    const candidate = asRecord(payload.heuristics);
    heuristics = {};
    const numericField = (key: keyof GenerationAssessmentHeuristics, allowNull = false) => {
      const value = candidate[key];
      if (value === undefined) {
        return;
      }
      if (value === null && allowNull) {
        (heuristics as Record<string, number | null | undefined>)[key] = null;
        return;
      }
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new SessionInputError(`Assessment heuristic "${String(key)}" must be a finite number${allowNull ? " or null" : ""}: ${filePath}.`);
      }
      (heuristics as Record<string, number | null | undefined>)[key] = value;
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
    platformFit: grade("platformFit"),
    notes,
    ...(touchedFiles && touchedFiles.length > 0 ? { touchedFiles } : {}),
    ...(heuristics ? { heuristics } : {}),
  };
}

function loadAssessment(assessmentPath: string): GenerationAssessment {
  const resolvedPath = path.resolve(assessmentPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new SessionInputError(`Assessment file not found at ${resolvedPath}.`);
  }
  return normalizeAssessment(readJsonFile<JsonRecord>(resolvedPath, "generation assessment"), resolvedPath);
}

function loadStoredAttemptReview(reviewPath: string): GenerationAttemptReview | null {
  if (!fs.existsSync(reviewPath)) {
    return null;
  }
  const payload = readJsonFile<JsonRecord>(reviewPath, "generation attempt review");
  const status = payload.status;
  if (!VALID_REVIEW_STATUSES.has(status as AttemptReviewStatus)) {
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
    status: status as AttemptReviewStatus,
    findingCodes: asStringArray(payload.findingCodes),
    rationale,
    reviewedAt: asString(payload.reviewedAt) ?? "",
  };
}

function loadStoredAttemptPreview(previewMetadataPath: string, previewImagePath: string): GenerationAttemptPreview | null {
  if (!fs.existsSync(previewMetadataPath)) {
    return null;
  }
  if (!fs.existsSync(previewImagePath)) {
    throw new SessionInputError(`Preview image not found at ${previewImagePath}.`);
  }
  const payload = readJsonFile<JsonRecord>(previewMetadataPath, "generation attempt preview");
  const pageTitle = asString(payload.pageTitle);
  const waitFor = asString(payload.waitFor);
  const viewport = asRecord(payload.viewport);
  const width = Number(viewport.width);
  const height = Number(viewport.height);
  if (!Number.isFinite(width) || width < 1 || !Number.isFinite(height) || height < 1) {
    throw new SessionInputError(`Preview viewport is invalid in ${previewMetadataPath}.`);
  }
  const preview: GenerationAttemptPreview = {
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
  if (
    preview.attemptNumber < 1 ||
    !preview.surfaceId ||
    !preview.sessionId ||
    !preview.url ||
    !preview.finalUrl ||
    !preview.imagePath ||
    !preview.capturedAt
  ) {
    throw new SessionInputError(`Generation attempt preview is missing required fields: ${previewMetadataPath}.`);
  }
  return preview;
}

function toPreviewReference(
  preview: GenerationAttemptPreview | null,
  previewMetadataPath?: string,
): ComparisonAttemptSnapshot["preview"] | GenerationSessionSummary["attempts"][number]["preview"] | undefined {
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

function normalizeReviewInput(
  payload: JsonRecord,
  filePath: string,
  findingCodes: string[],
): Omit<GenerationAttemptReview, "schemaVersion" | "surfaceId" | "sessionId" | "attemptNumber" | "reviewedAt"> {
  const status = payload.status;
  if (!VALID_REVIEW_STATUSES.has(status as AttemptReviewStatus)) {
    throw new SessionInputError(
      `Review field "status" must be accepted|rejected: ${filePath}.`,
    );
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
    throw new SessionInputError(
      `Accepted warn reviews must cover every remaining finding code: ${filePath}.`,
    );
  }

  return {
    status: status as AttemptReviewStatus,
    findingCodes: reviewedCodes,
    rationale,
  };
}

function loadSession(sessionDirInput: string): { session: GenerationSession; paths: ReturnType<typeof getSessionPaths> } {
  const sessionDir = path.resolve(sessionDirInput);
  const paths = getSessionPaths(sessionDir);
  if (!fs.existsSync(paths.sessionPath)) {
    throw new SessionInputError(`Generation session not found at ${paths.sessionPath}.`);
  }

  const payload = readJsonFile<JsonRecord>(paths.sessionPath, "generation session");
  const schemaVersion = Number(payload.schemaVersion ?? 1);
  if (schemaVersion !== 1 && schemaVersion !== 2 && schemaVersion !== 3) {
    throw new SessionInputError(`Unsupported generation session schemaVersion "${String(payload.schemaVersion ?? "unknown")}".`);
  }

  const tool = ensureSessionTool(asString(payload.tool));
  const guidanceStrategy = ensureGuidanceStrategy(
    asString(payload.guidanceStrategy) ?? asString(payload.guidanceMode) ?? "prompt-summary",
  );
  const finalStatus = asString(asRecord(payload.successRule).finalStatus) ?? "pass";
  if (!VALID_SUCCESS_RULES.has(finalStatus as SessionSuccessRule)) {
    throw new SessionInputError(`Unsupported session successRule.finalStatus "${finalStatus}".`);
  }

  const briefRecord = asRecord(payload.brief);
  const briefPath = asString(briefRecord.path);
  const briefSha256 = asString(briefRecord.sha256);
  const guidanceArtifacts = asRecord(payload.guidanceArtifacts);
  const session: GenerationSession = {
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
      finalStatus: finalStatus as SessionSuccessRule,
    },
  };

  if (
    !session.surfaceId
    || !session.sessionId
    || !session.workspaceRoot
    || !session.bundleRoot
    || !session.contractPath
    || !session.repairMapPath
    || !session.startedAt
  ) {
    throw new SessionInputError(`Generation session is missing required fields: ${paths.sessionPath}.`);
  }

  return {
    session,
    paths,
  };
}

function toBrowserLaunchError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (/Executable doesn't exist|browserType\.launch/i.test(message)) {
    return new Error(
      `Playwright Chromium is not installed. Run "pnpm exec playwright install chromium" in /Users/mike/SurfacesPlatform/interfacectl.`,
    );
  }
  return error instanceof Error ? error : new Error(message);
}

async function waitForPageSettle(page: {
  waitForLoadState: (state: "domcontentloaded" | "networkidle", options?: { timeout?: number }) => Promise<void>;
  waitForTimeout: (timeout: number) => Promise<void>;
}) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => undefined);
  await page.waitForTimeout(300);
}

async function waitForPreviewCondition(
  page: {
    locator: (selector: string) => { first: () => { waitFor: (options: { state: "visible"; timeout: number }) => Promise<void> } };
    getByText: (text: string, options: { exact: boolean }) => { first: () => { waitFor: (options: { state: "visible"; timeout: number }) => Promise<void> } };
  },
  waitFor: string,
) {
  const timeout = 5_000;
  try {
    await page.locator(waitFor).first().waitFor({ state: "visible", timeout });
    return;
  } catch (selectorError) {
    try {
      await page.getByText(waitFor, { exact: false }).first().waitFor({ state: "visible", timeout });
      return;
    } catch (textError) {
      const selectorMessage = selectorError instanceof Error ? selectorError.message : String(selectorError);
      const textMessage = textError instanceof Error ? textError.message : String(textError);
      throw new SessionInputError(
        `Preview wait condition "${waitFor}" was not satisfied. Selector error: ${selectorMessage}. Text error: ${textMessage}.`,
      );
    }
  }
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

function repeatedFindingCarryoverCount(recurringFindingCodes: Array<{ code: string; count: number }>): number {
  return recurringFindingCodes.reduce((total, entry) => total + Math.max(0, entry.count - 1), 0);
}

function rerunsToAcceptableOutcome(firstAcceptableAttempt: number | null): number | null {
  if (firstAcceptableAttempt === null) {
    return null;
  }
  return Math.max(0, firstAcceptableAttempt - 1);
}

function numericHeuristicDelta(
  baseline: number | null | undefined,
  guided: number | null | undefined,
): number | null {
  if (baseline === null || baseline === undefined || guided === null || guided === undefined) {
    return null;
  }
  return guided - baseline;
}

function countHeuristicImprovement(values: Array<number | null | undefined>): number {
  return values.reduce<number>(
    (total, value) => total + (typeof value === "number" && value < 0 ? 1 : 0),
    0,
  );
}

function averageNullable(values: Array<number | null | undefined>): number | null {
  const filtered = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (filtered.length === 0) {
    return null;
  }
  return Math.round((filtered.reduce((sum, value) => sum + value, 0) / filtered.length) * 1000) / 1000;
}

function readOptionalTrimmedText(filePath: string | null | undefined): string | null {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }
  return fs.readFileSync(filePath, "utf8").trim();
}

function appendArtifactLines(
  lines: string[],
  title: string,
  artifacts: Array<[label: string, filePath: string | undefined]>,
) {
  const filtered = artifacts.filter(([, filePath]) => Boolean(filePath));
  if (filtered.length === 0) {
    return;
  }
  lines.push("", title);
  for (const [label, filePath] of filtered) {
    lines.push(`- ${label}: ${filePath}`);
  }
}

function renderSummaryMarkdown(summary: GenerationSessionSummary): string {
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
  lines.push(`- components: ${summary.latestAssessment?.components ?? "n/a"}`);
  lines.push(`- boundary: ${summary.latestAssessment?.boundary ?? "n/a"}`);
  lines.push(`- visual: ${summary.latestAssessment?.visual ?? "n/a"}`);
  lines.push(`- responsiveness: ${summary.latestAssessment?.responsiveness ?? "n/a"}`);
  lines.push(`- platform fit: ${summary.latestAssessment?.platformFit ?? "n/a"}`);
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

function getSuccessOutcome(
  status: ValidateStatus,
  review: GenerationAttemptReview | null,
  findingCodes: string[],
  successRule: SessionSuccessRule,
): AttemptOutcome {
  if (status === "pass") {
    return "pass";
  }
  if (
    status === "warn" &&
    successRule === "pass-or-reviewed-warn" &&
    review &&
    review.status === "accepted" &&
    sameStringSet(review.findingCodes, findingCodes)
  ) {
    return "accepted-warn";
  }
  return status;
}

function loadAttemptRecords(paths: ReturnType<typeof getSessionPaths>): LoadedAttempt[] {
  if (!fs.existsSync(paths.attemptsDir)) {
    return [];
  }

  const attemptNumbers = fs.readdirSync(paths.attemptsDir)
    .map((entry) => /^(\d{3})\.metadata\.json$/.exec(entry))
    .filter((match): match is RegExpExecArray => Boolean(match))
    .map((match) => Number.parseInt(match[1], 10))
    .sort((left, right) => left - right);

  return attemptNumbers.map((attemptNumber) => {
    const attemptPaths = getAttemptPaths(paths.attemptsDir, attemptNumber);
    const review = loadStoredAttemptReview(attemptPaths.reviewPath);
    const preview = loadStoredAttemptPreview(attemptPaths.previewMetadataPath, attemptPaths.previewImagePath);
    return {
      attemptNumber,
      validate: readJsonFile<JsonRecord>(attemptPaths.validatePath, `attempt ${attemptNumber} validate payload`),
      assessment: readJsonFile<JsonRecord>(attemptPaths.assessmentPath, `attempt ${attemptNumber} assessment`),
      metadata: readJsonFile<JsonRecord>(attemptPaths.metadataPath, `attempt ${attemptNumber} metadata`),
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

function buildGenerationSessionSummary(sessionDirInput: string) {
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

  const latestAssessment = normalizeAssessment(latestAttempt.assessment, latestAttempt.assessmentPath, {
    allowLegacyMissing: true,
  });
  const latestStatus = latestAttempt.validate.status;
  if (latestStatus !== "pass" && latestStatus !== "warn" && latestStatus !== "block") {
    throw new SessionInputError(`Unsupported validate status "${String(latestStatus)}" in ${latestAttempt.validatePath}.`);
  }
  const latestOutcome = getSuccessOutcome(
    latestStatus,
    latestAttempt.review,
    parseFindingCodes(latestAttempt.validate),
    session.successRule.finalStatus,
  );
  const heuristics: GenerationSessionHeuristics = {
    latestAttempt: latestAssessment.heuristics ?? {},
    repeatedFindingCarryoverCount: repeatedFindingCarryoverCount(recurringFindingCodes),
    rerunsToAcceptableOutcome: rerunsToAcceptableOutcome(firstAcceptableAttempt),
  };

  const summary: GenerationSessionSummary = {
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

function toComparisonAttemptSnapshot(
  attempt: LoadedAttempt,
  successRule: SessionSuccessRule,
): ComparisonAttemptSnapshot {
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

function gradeToScore(grade: AssessmentGrade): number {
  switch (grade) {
    case "weak":
      return 0;
    case "partial":
      return 1;
    case "strong":
      return 2;
  }
}

function getRepairPriorityRank(priority: string): number {
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

function renderComparisonMarkdown(comparison: GenerationSessionComparison): string {
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
    lines.push(
      "",
      `Candidate improved dimensions: ${comparison.checks.guidedRubricBetterDimensions.join(", ")}`,
    );
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

function renderSuggestionsMarkdown(artifact: ContractDeltaSuggestionsArtifact): string {
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

function renderBenchmarkReportMarkdown(report: GenerationBenchmarkReport, run?: GenerationBenchmarkRun | null): string {
  const lines = [
    "# Generation Benchmark Report",
    "",
    `Generated at: ${report.generatedAt}`,
    ...(report.run
      ? [
          `Cohort: ${report.run.cohortId}`,
          `Evaluation mode: ${report.run.evaluationMode}`,
          `Tool: ${report.run.tool}`,
          `Model label: ${report.run.model.requestedModelLabel ?? "not recorded"}`,
          `Resolved model id: ${report.run.model.resolvedModelId ?? "not recorded"}`,
          `Base URL: ${report.run.model.baseUrl ?? "not recorded"}`,
          `Fingerprint: ${report.run.model.fingerprint ?? "not recorded"}`,
          `Source spec: ${report.run.sourceSpecPath}`,
          `Source run: ${report.run.sourceRunPath ?? "none"}`,
        ]
      : []),
    `Surfaces: ${report.overall.surfaceCount}`,
    `Surfaces meeting goal: ${report.overall.surfacesMeetingGoal}`,
    `Candidate fewer first-attempt blocking findings: ${report.overall.guidedFewerFirstAttemptBlockingFindings}`,
    `Candidate reached acceptable no later: ${report.overall.guidedReachedAcceptableNoLater}`,
    "",
    "## Comparisons",
  ];

  if (report.comparisons.length === 0) {
    lines.push("- none");
  } else {
    for (const comparison of report.comparisons) {
      lines.push(
        `- ${comparison.surfaceId}: baseline=${comparison.baselineGuidanceStrategy}, candidate=${comparison.guidedGuidanceStrategy}, platform=${comparison.platformTarget ?? "unknown"}, consumer=${comparison.consumerType ?? "unknown"}, model=${comparison.modelLabel ?? "unknown"}, meetsGoal=${comparison.meetsGoal}, improved dimensions=${comparison.guidedRubricBetterDimensions.join(", ") || "none"}`,
      );
    }
  }

  lines.push("", "## Suggestion decisions");
  for (const suggestion of report.suggestions) {
    lines.push(
      `- ${suggestion.surfaceId}: proposed=${suggestion.proposedCount}, accepted=${suggestion.acceptedCount}, rejected=${suggestion.rejectedCount}`,
    );
  }

  lines.push("", "## Heuristic improvements");
  lines.push(`- lower unresolved accepted suggestion rate: ${report.overall.heuristics.lowerUnresolvedAcceptedSuggestionRate}`);
  lines.push(`- lower noChanges-after-edit failures: ${report.overall.heuristics.lowerNoChangesAfterEditFailureCount}`);
  lines.push(`- lower recoverable tool errors: ${report.overall.heuristics.lowerRecoverableToolErrorCount}`);
  lines.push(`- lower touched files per resolved finding: ${report.overall.heuristics.lowerTouchedFilesPerResolvedFinding}`);
  lines.push(`- lower repeated finding carryover count: ${report.overall.heuristics.lowerRepeatedFindingCarryoverCount}`);
  lines.push(`- lower reruns to acceptable outcome: ${report.overall.heuristics.lowerRerunsToAcceptableOutcome}`);

  if (report.breakdowns) {
    const renderBreakdownBlock = (title: string, entries: Record<string, GenerationBenchmarkBreakdownSummary>) => {
      lines.push("", title);
      const keys = Object.keys(entries).sort((left, right) => left.localeCompare(right));
      if (keys.length === 0) {
        lines.push("- none");
        return;
      }
      for (const key of keys) {
        const entry = entries[key];
        lines.push(
          `- ${key}: comparisons=${entry.comparisonCount}, surfaces=${entry.surfaceCount}, meetsGoal=${entry.surfacesMeetingGoal}, fewerBlocking=${entry.guidedFewerFirstAttemptBlockingFindings}, acceptableNoLater=${entry.guidedReachedAcceptableNoLater}`,
        );
      }
    };
    renderBreakdownBlock("## By Platform Target", report.breakdowns.byPlatformTarget);
    renderBreakdownBlock("## By Consumer Type", report.breakdowns.byConsumerType);
    renderBreakdownBlock("## By Model", report.breakdowns.byModelLabel);
  }

  if (run) {
    lines.push("", "## Zero-Shot Evidence");
    for (const fixture of run.fixtures) {
      lines.push(
        "",
        `### ${fixture.surfaceId}`,
        `- fixture: ${fixture.fixtureId}`,
        `- platform target: ${fixture.platformTarget}`,
        `- consumer type: ${fixture.consumerType}`,
        `- capture preset: ${fixture.capturePreset}`,
        `- brief path: ${fixture.brief.path}`,
        `- brief sha256: ${fixture.brief.sha256}`,
      );

      const briefText = readOptionalTrimmedText(fixture.brief.path);
      if (briefText) {
        lines.push("", "#### Benchmark Brief", "", "```md", briefText, "```");
      }

      appendArtifactLines(lines, "#### Contract Artifacts", [
        ["source contract", fixture.paths?.sourceContractPath],
        ["source AST", fixture.paths?.sourceAstPath],
        ["bundle root", fixture.paths?.bundleRoot],
        ["compiled contract", fixture.paths?.compiledContractPath],
        ["effective AST", fixture.paths?.effectiveAstPath],
      ]);

      appendArtifactLines(lines, "#### Prompt And Input Artifacts", [
        ["prepared input", fixture.paths?.preparedInputPath],
        ["accepted suggestions", fixture.paths?.acceptedSuggestionsPath],
        ["designer notes", fixture.paths?.designerNotesPath],
        ["baseline validate", fixture.paths?.baselineValidatePath],
      ]);

      if (fixture.comparisons.length > 0) {
        lines.push("", "#### Fixture Comparisons");
        for (const comparison of fixture.comparisons) {
          lines.push(
            `- ${comparison.baselineGuidanceStrategy} vs ${comparison.guidedGuidanceStrategy}: ${comparison.comparisonPath}`,
          );
        }
      }

      if (fixture.sessions.length > 0) {
        lines.push("", "#### Session Evidence");
        for (const session of fixture.sessions) {
          const summary = fs.existsSync(session.summaryPath)
            ? readJsonFile<JsonRecord>(session.summaryPath, "generation benchmark session summary")
            : null;
          lines.push(
            "",
            `##### ${session.guidanceStrategy}`,
            `- session id: ${session.sessionId}`,
            `- session dir: ${session.sessionDir}`,
            `- latest status: ${asString(summary?.latestStatus) ?? "not recorded"}`,
            `- latest outcome: ${asString(summary?.latestOutcome) ?? "not recorded"}`,
            `- error: ${asString(summary?.errorMessage) ?? "none"}`,
            `- summary path: ${session.summaryPath}`,
            `- guidance handoff: ${session.guidanceHandoffPath}`,
            `- agent input: ${session.agentInputPath}`,
            `- preview: ${session.previewPath ?? "not captured"}`,
          );
          const agentInput = readOptionalTrimmedText(session.agentInputPath);
          if (agentInput) {
            lines.push("", "```txt", agentInput, "```");
          }
        }
      }
    }
  }

  return `${lines.join("\n")}\n`;
}

function freezeBriefFile(sessionDir: string, briefFile: string): GenerationBrief {
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

function defaultComparisonDir(baseline: GenerationSession, guided: GenerationSession): string {
  return path.join(
    baseline.workspaceRoot,
    "artifacts",
    "generation-benchmarks",
    baseline.surfaceId,
    `${baseline.sessionId}--vs--${guided.sessionId}`,
  );
}

function defaultBenchmarkReportDir(comparisonPaths: string[]): string {
  const firstPath = comparisonPaths[0];
  return path.join(
    path.dirname(path.dirname(firstPath)),
    "report",
  );
}

function extractRepairEntries(repairMap: unknown): JsonRecord[] {
  if (Array.isArray(repairMap)) {
    return repairMap.filter((entry): entry is JsonRecord => isRecord(entry));
  }
  const record = asRecord(repairMap);
  const repairs = Array.isArray(record.repairs) ? record.repairs : [];
  return repairs.filter((entry): entry is JsonRecord => isRecord(entry));
}

function summarizeContractForSurface(contractPath: string, surfaceId: string): string {
  const payload = readJsonFile<JsonRecord>(contractPath, "generation session contract");
  const surfaces = Array.isArray(payload.surfaces) ? payload.surfaces.filter((entry): entry is JsonRecord => isRecord(entry)) : [];
  const surface = surfaces.find((entry) => asString(entry.id) === surfaceId) ?? surfaces[0] ?? {};
  const sections = Array.isArray(payload.sections) ? payload.sections.filter((entry): entry is JsonRecord => isRecord(entry)) : [];
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

function buildPreparedPromptSummary(preparedPayload: ReturnType<typeof buildPreparedGenerationPayload>): string {
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
    `Motion durations: ${
      Array.isArray(motion.allowedDurationsMs)
        ? motion.allowedDurationsMs.map((value) => `${String(value)}ms`).join(", ")
        : "none"
    }`,
    `Top repair priorities: ${topRepairs.join(", ") || "none"}`,
  ].join("\n");
}

function buildBaselinePrimarySummary(preparedPayload: ReturnType<typeof buildPreparedGenerationPayload>): string {
  const surface = asRecord(preparedPayload.surface);
  const contract = asRecord(preparedPayload.contract);
  const constraints = asRecord(preparedPayload.constraints);
  const generation = asRecord(preparedPayload.generation);
  const layout = asRecord(generation.layout);
  const guidance = asRecord(generation.guidance);
  const boundaryRules = Array.isArray(guidance.boundaryRules)
    ? guidance.boundaryRules.filter((entry): entry is JsonRecord => isRecord(entry))
    : [];
  const sections = Array.isArray(preparedPayload.sections)
    ? preparedPayload.sections.filter((entry): entry is JsonRecord => isRecord(entry))
    : [];
  const repairMap = extractRepairEntries(preparedPayload.repairMap);
  const color = asRecord(constraints.color);
  const motion = asRecord(constraints.motion);

  return [
    `Surface: ${asString(surface.id) ?? "unknown"} (${asString(surface.type) ?? "unspecified"})`,
    `Contract: ${asString(contract.id) ?? "unknown"} v${asString(contract.version) ?? "0.0.0"}`,
    `Required sections: ${sections.map((entry) => asString(entry.id) ?? "").filter(Boolean).join(", ") || "none recorded"}`,
    `Boundary rules: ${boundaryRules.map((entry) => asString(entry.id) ?? "").filter(Boolean).join(", ") || "none recorded"}`,
    `Max content width: ${typeof layout.maxContentWidth === "number" ? `${layout.maxContentWidth}px` : "unspecified"}`,
    `Allowed colors: ${asStringArray(color.allowedValues).join(", ") || "none recorded"}`,
    `Motion durations: ${
      Array.isArray(motion.allowedDurationsMs)
        ? motion.allowedDurationsMs.map((value) => `${String(value)}ms`).join(", ")
        : "none recorded"
    }`,
    `Top repair codes: ${repairMap.slice(0, 5).map((entry) => asString(entry.code) ?? "").filter(Boolean).join(", ") || "none"}`,
  ].join("\n");
}

function selectRelevantComponents(preparedPayload: ReturnType<typeof buildPreparedGenerationPayload>): Array<Record<string, unknown>> {
  const sections = Array.isArray(preparedPayload.sections)
    ? preparedPayload.sections.filter((entry): entry is JsonRecord => isRecord(entry))
    : [];
  const components = Array.isArray(preparedPayload.components)
    ? preparedPayload.components.filter((entry): entry is JsonRecord => isRecord(entry))
    : [];
  const referencedIds = new Set<string>();

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

function loadPreparedPayloadForSession(session: GenerationSession): ReturnType<typeof buildPreparedGenerationPayload> {
  if (session.preparedInputPath && fs.existsSync(session.preparedInputPath)) {
    return readJsonFile<ReturnType<typeof buildPreparedGenerationPayload>>(session.preparedInputPath, "prepared generation payload");
  }
  const bundle = loadCompiledSurfaceBundle(session.bundleRoot, session.surfaceId, process.cwd());
  return buildPreparedGenerationPayload(bundle);
}

function loadRuntimeAcceptedSuggestions(filePath?: string): RuntimeAcceptedSuggestion[] {
  if (!filePath) {
    return [];
  }
  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    throw new SessionInputError(`Accepted suggestions file not found at ${resolvedPath}.`);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(fs.readFileSync(resolvedPath, "utf8")) as unknown;
  } catch (error) {
    throw new SessionInputError(
      `Accepted suggestions file is not valid JSON: ${resolvedPath} (${error instanceof Error ? error.message : String(error)}).`,
    );
  }
  const payloadRecord = asRecord(payload);
  const suggestions: unknown[] = Array.isArray(payload)
    ? payload
    : Array.isArray(payloadRecord.suggestions)
      ? payloadRecord.suggestions
      : [];
  return suggestions
    .filter((entry): entry is JsonRecord => isRecord(entry))
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

function loadRuntimeDesignerNotes(filePath?: string): string[] {
  if (!filePath) {
    return [];
  }
  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    throw new SessionInputError(`Designer notes file not found at ${resolvedPath}.`);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(fs.readFileSync(resolvedPath, "utf8")) as unknown;
  } catch (error) {
    throw new SessionInputError(
      `Designer notes file is not valid JSON: ${resolvedPath} (${error instanceof Error ? error.message : String(error)}).`,
    );
  }
  const payloadRecord = asRecord(payload);
  const rawNotes: unknown[] = Array.isArray(payload)
    ? payload
    : Array.isArray(payloadRecord.designerNotes)
      ? payloadRecord.designerNotes
      : Array.isArray(payloadRecord.notes)
        ? payloadRecord.notes
        : [];
  return [...new Set(
    rawNotes
      .map((entry) => {
        if (typeof entry === "string") {
          return entry.trim();
        }
        if (isRecord(entry)) {
          return asString(entry.content) ?? "";
        }
        return "";
      })
      .filter(Boolean),
  )];
}

function parseRuntimeFindingCodes(value?: string): string[] {
  if (!value) {
    return [];
  }
  return [...new Set(
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  )].sort((left, right) => left.localeCompare(right));
}

function buildGuidanceHandoff(
  session: GenerationSession,
  paths: ReturnType<typeof getSessionPaths>,
  guidanceStrategy: GuidanceStrategy,
  options: {
    acceptedSuggestions?: RuntimeAcceptedSuggestion[];
    designerNotes?: string[];
    findingCodes?: string[];
  } = {},
): GenerationGuidanceHandoff {
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
          preparedGuidanceSummary: buildPreparedPromptSummary(preparedPayload!),
        }
      : null,
    baselinePrimary: guidanceStrategy === "baseline-primary"
      ? {
          effectiveContractSummary: summarizeContractForSurface(session.contractPath, session.surfaceId),
          baselineContractSummary: buildBaselinePrimarySummary(preparedPayload!),
        }
      : null,
    jsonPrimary: guidanceStrategy === "json-primary"
      ? {
          surface: asRecord(preparedPayload!.surface),
          contract: asRecord(preparedPayload!.contract),
          summary: asRecord(preparedPayload!.summary),
          generation: asRecord(preparedPayload!.generation),
          constraints: asRecord(preparedPayload!.constraints),
          sections: Array.isArray(preparedPayload!.sections)
            ? preparedPayload!.sections.filter((entry): entry is JsonRecord => isRecord(entry))
            : [],
          components: selectRelevantComponents(preparedPayload!),
          repairMap,
          matchedRepairs,
        }
      : null,
  };
}

function parseCsvPaths(value?: string): string[] {
  if (!value) return [];
  return [...new Set(
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => path.resolve(entry)),
  )];
}

function buildComparisonArtifact(
  baselineSessionDir: string,
  guidedSessionDir: string,
): GenerationSessionComparison {
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

  const baselineFirstAttempt = toComparisonAttemptSnapshot(
    baselineBuilt.attempts[0],
    baselineBuilt.session.successRule.finalStatus,
  );
  const guidedFirstAttempt = toComparisonAttemptSnapshot(
    guidedBuilt.attempts[0],
    guidedBuilt.session.successRule.finalStatus,
  );
  const baselineLatestAttempt = toComparisonAttemptSnapshot(
    baselineBuilt.attempts[baselineBuilt.attempts.length - 1],
    baselineBuilt.session.successRule.finalStatus,
  );
  const guidedLatestAttempt = toComparisonAttemptSnapshot(
    guidedBuilt.attempts[guidedBuilt.attempts.length - 1],
    guidedBuilt.session.successRule.finalStatus,
  );

  const rubric = Object.fromEntries(
    ASSESSMENT_DIMENSIONS.map((dimension) => {
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
    }),
  ) as GenerationSessionComparison["delta"]["rubric"];

  const guidedRubricBetterDimensions = ASSESSMENT_DIMENSIONS.filter(
    (dimension) => rubric[dimension].delta > 0,
  );
  const guidedRubricAtLeastAsGood = ASSESSMENT_DIMENSIONS.every(
    (dimension) => rubric[dimension].delta >= 0,
  );
  const guidedReachedAcceptableNoLater = baselineBuilt.summary.firstAcceptableAttempt === null
    ? guidedBuilt.summary.firstAcceptableAttempt !== null
    : guidedBuilt.summary.firstAcceptableAttempt !== null &&
      guidedBuilt.summary.firstAcceptableAttempt <= baselineBuilt.summary.firstAcceptableAttempt;
  const guidedFewerFirstAttemptBlockingFindings =
    guidedFirstAttempt.blockingFindingCount < baselineFirstAttempt.blockingFindingCount;
  const heuristics: GenerationSessionComparison["heuristics"] = {
    baseline: baselineBuilt.summary.heuristics,
    guided: guidedBuilt.summary.heuristics,
    delta: {
      unresolvedAcceptedSuggestionRate: numericHeuristicDelta(
        baselineBuilt.summary.heuristics.latestAttempt.unresolvedAcceptedSuggestionRate,
        guidedBuilt.summary.heuristics.latestAttempt.unresolvedAcceptedSuggestionRate,
      ),
      noChangesAfterEditFailureCount:
        (guidedBuilt.summary.heuristics.latestAttempt.noChangesAfterEditFailureCount ?? 0) -
        (baselineBuilt.summary.heuristics.latestAttempt.noChangesAfterEditFailureCount ?? 0),
      recoverableToolErrorCount:
        (guidedBuilt.summary.heuristics.latestAttempt.recoverableToolErrorCount ?? 0) -
        (baselineBuilt.summary.heuristics.latestAttempt.recoverableToolErrorCount ?? 0),
      touchedFilesPerResolvedFinding: numericHeuristicDelta(
        baselineBuilt.summary.heuristics.latestAttempt.touchedFilesPerResolvedFinding,
        guidedBuilt.summary.heuristics.latestAttempt.touchedFilesPerResolvedFinding,
      ),
      repeatedFindingCarryoverCount:
        guidedBuilt.summary.heuristics.repeatedFindingCarryoverCount -
        baselineBuilt.summary.heuristics.repeatedFindingCarryoverCount,
      rerunsToAcceptableOutcome: numericHeuristicDelta(
        baselineBuilt.summary.heuristics.rerunsToAcceptableOutcome,
        guidedBuilt.summary.heuristics.rerunsToAcceptableOutcome,
      ),
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
      firstAttemptBlockingFindingCountDelta:
        guidedFirstAttempt.blockingFindingCount - baselineFirstAttempt.blockingFindingCount,
      firstAttemptWarningFindingCountDelta:
        guidedFirstAttempt.warningFindingCount - baselineFirstAttempt.warningFindingCount,
      latestFindingCountDelta: guidedLatestAttempt.findingCount - baselineLatestAttempt.findingCount,
      attemptsToAcceptableOutcome: {
        baseline: baselineBuilt.summary.firstAcceptableAttempt,
        guided: guidedBuilt.summary.firstAcceptableAttempt,
        delta:
          baselineBuilt.summary.firstAcceptableAttempt !== null &&
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
      meetsGoal:
        guidedFewerFirstAttemptBlockingFindings &&
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

function inferContractPath(surfaceId: string, findingCode: string, repair?: JsonRecord): string {
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
      if (findingCode.startsWith("section.")) return `surfaces[id=${surfaceId}].requiredSections`;
      if (findingCode.startsWith("layout.") || findingCode.startsWith("landing.")) return `surfaces[id=${surfaceId}].layout`;
      if (findingCode.startsWith("font.")) return `surfaces[id=${surfaceId}].allowedFonts`;
      if (findingCode.startsWith("color.")) return "color.allowedValues";
      if (findingCode.startsWith("icon.")) return "icons.allowedSources";
      if (findingCode.startsWith("motion.")) return "constraints.motion";
      if (findingCode.startsWith("flow.")) return `surfaces[id=${surfaceId}].flows`;
      return `surfaces[id=${surfaceId}]`;
  }
}

function getSuggestionConfidence(
  repeatedFailureCount: number,
  repairPriority: string,
  evidenceRefs: unknown[],
  contractPath: string,
): number {
  let confidence = 0.45;
  if (repeatedFailureCount > 1) confidence += 0.2;
  if (repairPriority === "high") confidence += 0.15;
  if (repairPriority === "medium") confidence += 0.05;
  if (evidenceRefs.length > 0) confidence += 0.1;
  if (contractPath === "surfaces[id=unknown]") confidence -= 0.15;
  return Math.max(0.1, Math.min(0.95, Math.round(confidence * 100) / 100));
}

function getSuggestionSortKey(left: ContractDeltaSuggestion, right: ContractDeltaSuggestion): number {
  return (
    right.repeatedFailureCount - left.repeatedFailureCount ||
    getRepairPriorityRank(left.repair.priority) - getRepairPriorityRank(right.repair.priority) ||
    left.findingCode.localeCompare(right.findingCode)
  );
}

function buildSuggestionArtifact(sessionDir: string): ContractDeltaSuggestionsArtifact {
  const built = buildGenerationSessionSummary(sessionDir);
  if (built.session.guidanceStrategy === "unguided") {
    throw new SessionInputError("Contract delta suggestions require a guided session.");
  }

  const repairMapDoc = readJsonFile<JsonRecord>(built.session.repairMapPath, "repair map");
  const repairs = Array.isArray(repairMapDoc.repairs) ? repairMapDoc.repairs : [];
  const repairMapByCode = new Map(
    repairs
      .filter((entry): entry is JsonRecord => isRecord(entry))
      .map((entry) => [asString(entry.code) ?? "", entry] as const)
      .filter(([code]) => Boolean(code)),
  );
  const recurringCounts = new Map(
    built.summary.recurringFindingCodes.map((entry) => [entry.code, entry.count] as const),
  );

  const latestAttempt = built.attempts[built.attempts.length - 1];
  const latestFindings = Array.isArray(latestAttempt.validate.findings) ? latestAttempt.validate.findings : [];
  const latestFindingByCode = new Map<string, JsonRecord>();
  for (const finding of latestFindings) {
    if (!finding || typeof finding !== "object") continue;
    const entry = finding as JsonRecord;
    const code = asString(entry.code);
    if (!code) continue;
    latestFindingByCode.set(code, entry);
  }

  const allCodes = [...new Set(
    built.attempts.flatMap((attempt) => parseFindingCodes(attempt.validate)),
  )].sort((left, right) => left.localeCompare(right));

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
      ...(Array.isArray(action.sectionIds) ? action.sectionIds.filter((entry) => typeof entry === "string") as string[] : []),
      ...(Array.isArray(action.sectionOrder) ? action.sectionOrder.filter((entry) => typeof entry === "string") as string[] : []),
      ...(Array.isArray(action.allowedValues) ? action.allowedValues.filter((entry) => typeof entry === "string") as string[] : []),
      ...(Array.isArray(action.allowedSources) ? action.allowedSources.filter((entry) => typeof entry === "string") as string[] : []),
      ...(Array.isArray(action.requiredContainers) ? action.requiredContainers.filter((entry) => typeof entry === "string") as string[] : []),
    ].slice(0, 6);
    const repeatedFailureCount = recurringCounts.get(code) ?? 1;

    return {
      suggestionId: `suggestion:${code}`,
      findingCode: code,
      findingMessage: asString(latestFinding?.message) ?? `Review contract coverage for ${code}.`,
      repeatedFailureCount,
      confidence: getSuggestionConfidence(repeatedFailureCount, repairPriority, evidenceRefs, contractPath),
      status: "proposed" as const,
      repair: {
        priority: repairPriority,
        category: repairCategory,
        actionType,
      },
      evidenceRefs,
      proposedChange: {
        path: contractPath,
        actionType,
        summary:
          asString(latestFinding?.message) ??
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
    generatedAt:
      asString(latestAttempt.metadata.createdAt) ??
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

function normalizeSuggestionReviewFile(filePath: string): Array<{
  suggestionId: string;
  status: Exclude<SuggestionStatus, "proposed">;
  rationale: string;
}> {
  const payload = readJsonFile<JsonRecord>(filePath, "contract delta suggestion review");
  const decisions = Array.isArray(payload.decisions) ? payload.decisions : [];
  if (decisions.length === 0) {
    throw new SessionInputError(`Review file must include a non-empty "decisions" array: ${filePath}.`);
  }
  return decisions.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new SessionInputError(`Review decision at index ${index} is invalid: ${filePath}.`);
    }
    const decision = entry as JsonRecord;
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

function buildDefaultBenchmarkCohortId(): string {
  return new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
}

function normalizeBenchmarkComparisonPairs(value: unknown, label: string): GenerationBenchmarkSpec["comparisonPairs"] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new SessionInputError(`${label} must be a non-empty array.`);
  }
  return value.map((entry, index) => {
    const record = asRecord(entry);
    return {
      baselineGuidanceStrategy: ensureGuidanceStrategy(
        asString(record.baselineGuidanceStrategy) ?? (() => {
          throw new SessionInputError(`${label}[${index}].baselineGuidanceStrategy is required.`);
        })(),
      ),
      guidedGuidanceStrategy: ensureGuidanceStrategy(
        asString(record.guidedGuidanceStrategy) ?? (() => {
          throw new SessionInputError(`${label}[${index}].guidedGuidanceStrategy is required.`);
        })(),
      ),
    };
  });
}

function loadGenerationBenchmarkSpec(specPath: string): GenerationBenchmarkSpec {
  const resolvedPath = path.resolve(specPath);
  const payload = readJsonFile<JsonRecord>(resolvedPath, "generation benchmark spec");
  const fixturesValue = payload.fixtures;
  if (!Array.isArray(fixturesValue) || fixturesValue.length === 0) {
    throw new SessionInputError(`Benchmark spec must include a non-empty fixtures array: ${resolvedPath}.`);
  }
  const guidanceStrategies = asStringArray(payload.guidanceStrategies).map((entry) => ensureGuidanceStrategy(entry));
  if (guidanceStrategies.length < 2) {
    throw new SessionInputError(`Benchmark spec must freeze at least two guidance strategies: ${resolvedPath}.`);
  }
  const comparisonPairs = normalizeBenchmarkComparisonPairs(payload.comparisonPairs, "comparisonPairs");
  const attemptBudget = Number(payload.attemptBudget);
  if (!Number.isInteger(attemptBudget) || attemptBudget < 1) {
    throw new SessionInputError(`Benchmark spec attemptBudget must be a positive integer: ${resolvedPath}.`);
  }

  return {
    schemaVersion: 1,
    specId: asString(payload.specId) ?? path.basename(resolvedPath, path.extname(resolvedPath)),
    generatedAt: asString(payload.generatedAt) ?? new Date().toISOString(),
    evaluationMode: ensureEvaluationMode(asString(payload.evaluationMode) ?? "zero-shot"),
    attemptBudget,
    guidanceStrategies,
    comparisonPairs,
    ...(asString(payload.suiteId) ? { suiteId: asString(payload.suiteId) ?? undefined } : {}),
    ...(asString(payload.suiteName) ? { suiteName: asString(payload.suiteName) ?? undefined } : {}),
    fixtures: fixturesValue.map((entry, index) => {
      const record = asRecord(entry);
      const brief = asRecord(record.brief);
      const pathsRecord = record.paths !== undefined ? asRecord(record.paths) : null;
      const fixtureComparisonPairs = record.comparisonPairs !== undefined
        ? normalizeBenchmarkComparisonPairs(record.comparisonPairs, `fixtures[${index}].comparisonPairs`)
        : comparisonPairs;
      return {
        fixtureId: asString(record.fixtureId) ?? (() => {
          throw new SessionInputError(`fixtures[${index}].fixtureId is required in ${resolvedPath}.`);
        })(),
        surfaceId: asString(record.surfaceId) ?? (() => {
          throw new SessionInputError(`fixtures[${index}].surfaceId is required in ${resolvedPath}.`);
        })(),
        brief: {
          path: asString(brief.path) ?? (() => {
            throw new SessionInputError(`fixtures[${index}].brief.path is required in ${resolvedPath}.`);
          })(),
          sha256: asString(brief.sha256) ?? (() => {
            throw new SessionInputError(`fixtures[${index}].brief.sha256 is required in ${resolvedPath}.`);
          })(),
        },
        platformTarget: ensurePlatformTarget(record.platformTarget, `fixtures[${index}].platformTarget`),
        consumerType: ensureConsumerType(record.consumerType, `fixtures[${index}].consumerType`),
        capturePreset: asString(record.capturePreset) ?? "web-browser",
        comparisonPairs: fixtureComparisonPairs,
        ...(pathsRecord
          ? {
              paths: {
                ...(asString(pathsRecord.fixtureDir) ? { fixtureDir: asString(pathsRecord.fixtureDir) ?? undefined } : {}),
                ...(asString(pathsRecord.sourceContractPath)
                  ? { sourceContractPath: asString(pathsRecord.sourceContractPath) ?? undefined }
                  : {}),
                ...(asString(pathsRecord.sourceAstPath)
                  ? { sourceAstPath: asString(pathsRecord.sourceAstPath) ?? undefined }
                  : {}),
                ...(asString(pathsRecord.bundleRoot)
                  ? { bundleRoot: asString(pathsRecord.bundleRoot) ?? undefined }
                  : {}),
                ...(asString(pathsRecord.compiledContractPath)
                  ? { compiledContractPath: asString(pathsRecord.compiledContractPath) ?? undefined }
                  : {}),
                ...(asString(pathsRecord.effectiveAstPath)
                  ? { effectiveAstPath: asString(pathsRecord.effectiveAstPath) ?? undefined }
                  : {}),
                ...(asString(pathsRecord.preparedInputPath)
                  ? { preparedInputPath: asString(pathsRecord.preparedInputPath) ?? undefined }
                  : {}),
                ...(asString(pathsRecord.acceptedSuggestionsPath)
                  ? { acceptedSuggestionsPath: asString(pathsRecord.acceptedSuggestionsPath) ?? undefined }
                  : {}),
                ...(asString(pathsRecord.designerNotesPath)
                  ? { designerNotesPath: asString(pathsRecord.designerNotesPath) ?? undefined }
                  : {}),
                ...(asString(pathsRecord.baselineValidatePath)
                  ? { baselineValidatePath: asString(pathsRecord.baselineValidatePath) ?? undefined }
                  : {}),
              },
            }
          : {}),
      };
    }),
  };
}

function loadGenerationBenchmarkRun(runPath: string): GenerationBenchmarkRun {
  return readJsonFile<JsonRecord>(path.resolve(runPath), "generation benchmark run") as unknown as GenerationBenchmarkRun;
}

function buildBreakdownSummary(entries: Array<GenerationBenchmarkReport["comparisons"][number]>): GenerationBenchmarkBreakdownSummary {
  return {
    comparisonCount: entries.length,
    surfaceCount: new Set(entries.map((entry) => entry.surfaceId)).size,
    surfacesMeetingGoal: entries.filter((entry) => entry.meetsGoal).length,
    guidedFewerFirstAttemptBlockingFindings: entries.filter(
      (entry) => entry.guidedFewerFirstAttemptBlockingFindings,
    ).length,
    guidedReachedAcceptableNoLater: entries.filter((entry) => entry.guidedReachedAcceptableNoLater).length,
  };
}

export async function runReplayGenerationBenchmarkCommand(
  options: ReplayGenerationBenchmarkCommandOptions,
): Promise<number> {
  try {
    if (!options.specPath) {
      throw new SessionInputError("--spec is required.");
    }
    if (!options.outDir) {
      throw new SessionInputError("--out-dir is required.");
    }
    const tool = ensureSessionTool(options.tool);
    const specPath = path.resolve(options.specPath);
    const spec = loadGenerationBenchmarkSpec(specPath);
    const benchmarkDir = path.resolve(options.outDir);
    const cohortId = options.cohortId?.trim() || buildDefaultBenchmarkCohortId();
    const runPath = path.join(benchmarkDir, "run.json");
    const copiedSpecPath = path.join(benchmarkDir, "spec.json");
    const sourceRunPath = options.sourceRunPath ? path.resolve(options.sourceRunPath) : null;

    fs.mkdirSync(benchmarkDir, { recursive: true });
    if (path.resolve(specPath) !== path.resolve(copiedSpecPath)) {
      fs.copyFileSync(specPath, copiedSpecPath);
    }

    const run: GenerationBenchmarkRun = {
      schemaVersion: 1,
      cohortId,
      generatedAt: new Date().toISOString(),
      evaluationMode: spec.evaluationMode,
      tool,
      sourceSpecPath: specPath,
      sourceRunPath,
      attemptBudget: spec.attemptBudget,
      guidanceStrategies: [...spec.guidanceStrategies],
      comparisonPairs: spec.comparisonPairs.map((pair) => ({ ...pair })),
      model: {
        requestedModelLabel: options.requestedModelLabel?.trim() || null,
        resolvedModelId: options.resolvedModelId?.trim() || null,
        baseUrl: options.baseUrl?.trim() || null,
        fingerprint: options.fingerprint?.trim() || null,
      },
      ...(spec.suiteId ? { suiteId: spec.suiteId } : {}),
      ...(spec.suiteName ? { suiteName: spec.suiteName } : {}),
      paths: {
        benchmarkDir,
        specPath: copiedSpecPath,
        runPath,
        reportJsonPath: null,
        reportMarkdownPath: null,
      },
      fixtures: spec.fixtures.map((fixture) => ({
        ...fixture,
        sessions: [],
        comparisons: [],
      })),
    };

    writeDeterministicJsonSync(runPath, run);
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          run,
          paths: {
            specPath: copiedSpecPath,
            runPath,
            benchmarkDir,
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
    let preparedInputPath: string | null = null;
    if (guidanceStrategy !== "unguided") {
      const preparedPayload = buildPreparedGenerationPayload(sessionBundle);
      writeDeterministicJsonSync(paths.preparedInputPath, preparedPayload);
      preparedInputPath = paths.preparedInputPath;
    }

    const session: GenerationSession = {
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

    process.stdout.write(
      `${JSON.stringify({ ok: true, session, handoff, paths }, null, 2)}\n`,
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

export async function runPrepareGenerationHandoffCommand(
  options: PrepareGenerationHandoffCommandOptions,
): Promise<number> {
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

    const sessionForHandoff: GenerationSession = {
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

    const updatedSession: GenerationSession = {
      ...sessionForHandoff,
    };
    writeDeterministicJsonSync(paths.sessionPath, updatedSession);

    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          handoff,
          session: updatedSession,
          paths: {
            handoffPath,
            sessionPath: paths.sessionPath,
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
    const attemptPaths = getAttemptPaths(paths.attemptsDir, attemptNumber);
    fs.mkdirSync(paths.attemptsDir, { recursive: true });

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

    writeDeterministicJsonSync(attemptPaths.validatePath, response);
    writeDeterministicJsonSync(attemptPaths.assessmentPath, assessment);

    const findingCodes = parseFindingCodes(response as unknown as JsonRecord);
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

    const metadata: GenerationSessionAttemptMetadata = {
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

    process.stdout.write(
      `${JSON.stringify(
        {
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

export async function runCaptureGenerationPreviewCommand(
  options: CaptureGenerationPreviewCommandOptions,
): Promise<number> {
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

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(options.url);
    } catch {
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
      headless:
        process.env.INTERFACECTL_PLAYWRIGHT_HEADLESS !== "0" &&
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
      const preview: GenerationAttemptPreview = {
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

      process.stdout.write(
        `${JSON.stringify(
          {
            ok: true,
            preview,
            paths: {
              metadataPath: attemptPaths.previewMetadataPath,
              imagePath: attemptPaths.previewImagePath,
            },
          },
          null,
          2,
        )}\n`,
      );
      return 0;
    } catch (error) {
      if (error instanceof SessionInputError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new SessionInputError(`Failed to capture preview for attempt ${attemptNumber}: ${message}.`);
    } finally {
      await context.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
    }
  } catch (error) {
    if (error instanceof SessionInputError || error instanceof AdapterInputError) {
      writeError(error, error.code);
      return 10;
    }
    writeError(error instanceof Error ? error : new Error(String(error)), "generation-session.internal");
    return 1;
  }
}

export async function runReviewGenerationAttemptCommand(
  options: ReviewGenerationAttemptCommandOptions,
): Promise<number> {
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
    const validatePayload = readJsonFile<JsonRecord>(attemptPaths.validatePath, `attempt ${attemptNumber} validate payload`);
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
    const reviewInput = normalizeReviewInput(
      readJsonFile<JsonRecord>(reviewInputPath, "generation attempt review input"),
      reviewInputPath,
      findingCodes,
    );

    const review: GenerationAttemptReview = {
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

    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          review,
          reviewPath: attemptPaths.reviewPath,
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

    const { paths, summary } = buildGenerationSessionSummary(options.sessionDir);
    writeDeterministicJsonSync(paths.summaryJsonPath, summary);
    fs.writeFileSync(paths.summaryMarkdownPath, renderSummaryMarkdown(summary), "utf8");
    process.stdout.write(`${JSON.stringify({ ok: true, summary, paths }, null, 2)}\n`);
    return summary.latestOutcome === "pass" || summary.latestOutcome === "accepted-warn" ? 0 : 30;
  } catch (error) {
    if (error instanceof SessionInputError || error instanceof AdapterInputError) {
      writeError(error, error.code);
      return 10;
    }
    writeError(error instanceof Error ? error : new Error(String(error)), "generation-session.internal");
    return 1;
  }
}

export async function runCompareGenerationSessionsCommand(
  options: CompareGenerationSessionsCommandOptions,
): Promise<number> {
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

    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          comparison,
          paths: {
            jsonPath,
            markdownPath,
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

export async function runSuggestContractDeltasCommand(
  options: SuggestContractDeltasCommandOptions,
): Promise<number> {
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
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          artifact,
          paths: {
            jsonPath: outPath,
            markdownPath,
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

export async function runReviewContractDeltaSuggestionsCommand(
  options: ReviewContractDeltaSuggestionsCommandOptions,
): Promise<number> {
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
    const artifact = readJsonFile<JsonRecord>(
      suggestionsPath,
      "contract delta suggestions artifact",
    ) as unknown as ContractDeltaSuggestionsArtifact;
    const reviewFile = path.resolve(options.reviewFile);
    if (!fs.existsSync(reviewFile)) {
      throw new SessionInputError(`Review file not found at ${reviewFile}.`);
    }
    const decisions = normalizeSuggestionReviewFile(reviewFile);
    const decisionMap = new Map(decisions.map((entry) => [entry.suggestionId, entry] as const));
    const knownIds = new Set(artifact.suggestions.map((suggestion) => suggestion.suggestionId));
    for (const suggestionId of decisionMap.keys()) {
      if (!knownIds.has(suggestionId)) {
        throw new SessionInputError(`Unknown suggestionId "${suggestionId}" in ${reviewFile}.`);
      }
    }

    const updatedArtifact: ContractDeltaSuggestionsArtifact = {
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

    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          artifact: updatedArtifact,
          paths: {
            jsonPath: outPath,
            markdownPath,
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

export async function runSummarizeGenerationBenchmarkCommand(
  options: SummarizeGenerationBenchmarkCommandOptions,
): Promise<number> {
  try {
    const run = options.runPath ? loadGenerationBenchmarkRun(options.runPath) : null;
    const comparisonPaths = parseCsvPaths(options.comparisonPaths);
    if (comparisonPaths.length === 0 && run) {
      comparisonPaths.push(
        ...run.fixtures.flatMap((fixture) => fixture.comparisons.map((comparison) => path.resolve(comparison.comparisonPath))),
      );
    }
    if (comparisonPaths.length === 0 && !run) {
      throw new SessionInputError("--comparisons must include at least one comparison artifact path.");
    }
    const suggestionPaths = parseCsvPaths(options.suggestionPaths);
    const comparisons = comparisonPaths.map((comparisonPath) => ({
      path: comparisonPath,
      value: readJsonFile<JsonRecord>(comparisonPath, "generation session comparison") as unknown as GenerationSessionComparison,
    }));
    const suggestions = suggestionPaths.map((suggestionPath) => ({
      path: suggestionPath,
      value: readJsonFile<JsonRecord>(suggestionPath, "contract delta suggestions artifact") as unknown as ContractDeltaSuggestionsArtifact,
    }));
    const fixtureMetadataByComparisonPath = new Map<string, {
      platformTarget: PlatformTarget;
      consumerType: ConsumerType;
    }>();
    if (run) {
      for (const fixture of run.fixtures) {
        for (const comparison of fixture.comparisons) {
          fixtureMetadataByComparisonPath.set(path.resolve(comparison.comparisonPath), {
            platformTarget: fixture.platformTarget,
            consumerType: fixture.consumerType,
          });
        }
      }
    }

    const report: GenerationBenchmarkReport = {
      schemaVersion: 3,
      generatedAt: new Date().toISOString(),
      ...(run
        ? {
            run: {
              cohortId: run.cohortId,
              evaluationMode: run.evaluationMode,
              tool: run.tool,
              sourceSpecPath: run.sourceSpecPath,
              sourceRunPath: run.sourceRunPath,
              guidanceStrategies: [...run.guidanceStrategies],
              attemptBudget: run.attemptBudget,
              model: {
                requestedModelLabel: run.model.requestedModelLabel,
                resolvedModelId: run.model.resolvedModelId,
                baseUrl: run.model.baseUrl,
                fingerprint: run.model.fingerprint,
              },
            },
          }
        : {}),
      comparisons: comparisons.map(({ path: comparisonPath, value }) => {
        const comparisonMetadata = fixtureMetadataByComparisonPath.get(path.resolve(comparisonPath));
        return {
          surfaceId: value.surfaceId,
          tool: value.tool,
          comparisonPath,
          meetsGoal: value.checks.meetsGoal,
          baselineGuidanceStrategy: value.baseline.guidanceStrategy,
          guidedGuidanceStrategy: value.guided.guidanceStrategy,
          ...(comparisonMetadata ? { platformTarget: comparisonMetadata.platformTarget } : {}),
          ...(comparisonMetadata ? { consumerType: comparisonMetadata.consumerType } : {}),
          ...(run ? { modelLabel: run.model.requestedModelLabel ?? run.model.resolvedModelId ?? "unknown" } : {}),
          guidedFewerFirstAttemptBlockingFindings: value.checks.guidedFewerFirstAttemptBlockingFindings,
          guidedReachedAcceptableNoLater: value.checks.guidedReachedAcceptableNoLater,
          guidedRubricBetterDimensions: value.checks.guidedRubricBetterDimensions,
          heuristics: value.heuristics.delta,
        };
      }),
      suggestions: suggestions.map(({ path: suggestionsPath, value }) => ({
        surfaceId: value.surfaceId,
        sessionId: value.sessionId,
        suggestionsPath,
        proposedCount: value.suggestions.filter((entry) => entry.status === "proposed").length,
        acceptedCount: value.suggestions.filter((entry) => entry.status === "accepted").length,
        rejectedCount: value.suggestions.filter((entry) => entry.status === "rejected").length,
      })),
      overall: {
        surfaceCount: comparisons.length > 0 ? comparisons.length : (run?.fixtures.length ?? 0),
        surfacesMeetingGoal: comparisons.filter(({ value }) => value.checks.meetsGoal).length,
        guidedFewerFirstAttemptBlockingFindings: comparisons.filter(
          ({ value }) => value.checks.guidedFewerFirstAttemptBlockingFindings,
        ).length,
        guidedReachedAcceptableNoLater: comparisons.filter(
          ({ value }) => value.checks.guidedReachedAcceptableNoLater,
        ).length,
        acceptedSuggestionCount: suggestions.reduce(
          (total, entry) => total + entry.value.suggestions.filter((suggestion) => suggestion.status === "accepted").length,
          0,
        ),
        rejectedSuggestionCount: suggestions.reduce(
          (total, entry) => total + entry.value.suggestions.filter((suggestion) => suggestion.status === "rejected").length,
          0,
        ),
        proposedSuggestionCount: suggestions.reduce(
          (total, entry) => total + entry.value.suggestions.filter((suggestion) => suggestion.status === "proposed").length,
          0,
        ),
        heuristics: {
          lowerUnresolvedAcceptedSuggestionRate: countHeuristicImprovement(
            comparisons.map(({ value }) => value.heuristics.delta.unresolvedAcceptedSuggestionRate),
          ),
          lowerNoChangesAfterEditFailureCount: comparisons.filter(
            ({ value }) => value.heuristics.delta.noChangesAfterEditFailureCount < 0,
          ).length,
          lowerRecoverableToolErrorCount: comparisons.filter(
            ({ value }) => value.heuristics.delta.recoverableToolErrorCount < 0,
          ).length,
          lowerTouchedFilesPerResolvedFinding: countHeuristicImprovement(
            comparisons.map(({ value }) => value.heuristics.delta.touchedFilesPerResolvedFinding),
          ),
          lowerRepeatedFindingCarryoverCount: comparisons.filter(
            ({ value }) => value.heuristics.delta.repeatedFindingCarryoverCount < 0,
          ).length,
          lowerRerunsToAcceptableOutcome: countHeuristicImprovement(
            comparisons.map(({ value }) => value.heuristics.delta.rerunsToAcceptableOutcome),
          ),
          averageDelta: {
            unresolvedAcceptedSuggestionRate: averageNullable(
              comparisons.map(({ value }) => value.heuristics.delta.unresolvedAcceptedSuggestionRate),
            ),
            noChangesAfterEditFailureCount: averageNullable(
              comparisons.map(({ value }) => value.heuristics.delta.noChangesAfterEditFailureCount),
            ),
            recoverableToolErrorCount: averageNullable(
              comparisons.map(({ value }) => value.heuristics.delta.recoverableToolErrorCount),
            ),
            touchedFilesPerResolvedFinding: averageNullable(
              comparisons.map(({ value }) => value.heuristics.delta.touchedFilesPerResolvedFinding),
            ),
            repeatedFindingCarryoverCount: averageNullable(
              comparisons.map(({ value }) => value.heuristics.delta.repeatedFindingCarryoverCount),
            ),
            rerunsToAcceptableOutcome: averageNullable(
              comparisons.map(({ value }) => value.heuristics.delta.rerunsToAcceptableOutcome),
            ),
          },
        },
      },
      ...(run
        ? {
            breakdowns: {
              byPlatformTarget: Object.fromEntries(
                [...new Set(run.fixtures.map((fixture) => fixture.platformTarget))]
                  .sort((left, right) => left.localeCompare(right))
                  .map((platformTarget) => [
                    platformTarget,
                    buildBreakdownSummary(
                      comparisons
                        .map(({ path: comparisonPath, value }) => ({
                          ...value,
                          __comparisonPath: comparisonPath,
                        }))
                        .filter((entry) =>
                          fixtureMetadataByComparisonPath.get(path.resolve(entry.__comparisonPath))?.platformTarget === platformTarget
                        )
                        .map((entry) => ({
                          surfaceId: entry.surfaceId,
                          tool: entry.tool,
                          comparisonPath: entry.__comparisonPath,
                          meetsGoal: entry.checks.meetsGoal,
                          baselineGuidanceStrategy: entry.baseline.guidanceStrategy,
                          guidedGuidanceStrategy: entry.guided.guidanceStrategy,
                          guidedFewerFirstAttemptBlockingFindings: entry.checks.guidedFewerFirstAttemptBlockingFindings,
                          guidedReachedAcceptableNoLater: entry.checks.guidedReachedAcceptableNoLater,
                          guidedRubricBetterDimensions: entry.checks.guidedRubricBetterDimensions,
                          heuristics: entry.heuristics.delta,
                        })),
                    ),
                  ]),
              ),
              byConsumerType: Object.fromEntries(
                [...new Set(run.fixtures.map((fixture) => fixture.consumerType))]
                  .sort((left, right) => left.localeCompare(right))
                  .map((consumerType) => [
                    consumerType,
                    buildBreakdownSummary(
                      comparisons
                        .map(({ path: comparisonPath, value }) => ({
                          ...value,
                          __comparisonPath: comparisonPath,
                        }))
                        .filter((entry) =>
                          fixtureMetadataByComparisonPath.get(path.resolve(entry.__comparisonPath))?.consumerType === consumerType
                        )
                        .map((entry) => ({
                          surfaceId: entry.surfaceId,
                          tool: entry.tool,
                          comparisonPath: entry.__comparisonPath,
                          meetsGoal: entry.checks.meetsGoal,
                          baselineGuidanceStrategy: entry.baseline.guidanceStrategy,
                          guidedGuidanceStrategy: entry.guided.guidanceStrategy,
                          guidedFewerFirstAttemptBlockingFindings: entry.checks.guidedFewerFirstAttemptBlockingFindings,
                          guidedReachedAcceptableNoLater: entry.checks.guidedReachedAcceptableNoLater,
                          guidedRubricBetterDimensions: entry.checks.guidedRubricBetterDimensions,
                          heuristics: entry.heuristics.delta,
                        })),
                    ),
                  ]),
              ),
              byModelLabel: {
                [run.model.requestedModelLabel ?? run.model.resolvedModelId ?? "unknown"]: buildBreakdownSummary(
                  comparisons.map(({ path: comparisonPath, value }) => ({
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
                ),
              },
            },
          }
        : {}),
    };

    const outDir = options.outDir
      ? path.resolve(options.outDir)
      : defaultBenchmarkReportDir(comparisonPaths);
    const jsonPath = path.join(outDir, "benchmark-report.json");
    const markdownPath = path.join(outDir, "benchmark-report.md");
    writeDeterministicJsonSync(jsonPath, report);
    fs.mkdirSync(path.dirname(markdownPath), { recursive: true });
    fs.writeFileSync(markdownPath, renderBenchmarkReportMarkdown(report, run), "utf8");
    if (run && options.runPath) {
      writeDeterministicJsonSync(path.resolve(options.runPath), {
        ...run,
        paths: {
          ...run.paths,
          reportJsonPath: jsonPath,
          reportMarkdownPath: markdownPath,
        },
      });
    }

    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          report,
          paths: {
            jsonPath,
            markdownPath,
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
