import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getBundledContractSchema, validateContractStructure, type InterfaceContract } from "@surfaces/interfacectl-validator";
import { inspectAuthProfile } from "./utils/auth-profiles.js";
import { observeRemotePage, type RemoteBrowserObservation, type SourceHealthStatus } from "./utils/browser-session.js";
import {
  analyzeSurface,
  stringifyStableArtifact,
  type AnalyzeSurfaceResult,
  type AnalysisSourceMode,
  type SurfaceAnalysisArtifact,
  type WebSurfaceKind,
} from "./utils/first-run-analysis.js";
import {
  emitOnboardingRunArtifact,
  suggestSurfaceIdFromPath,
  suggestSurfaceIdFromUrl,
  suggestSurfaceName,
} from "./utils/onboarding.js";

export interface OnboardingRequest {
  rootDir?: string;
  sourceMode?: AnalysisSourceMode;
  url?: string;
  appRoot?: string;
  surfaceId?: string;
  surfaceName?: string;
  surfaceKind?: WebSurfaceKind;
  authProfileName?: string;
  continueOnGate?: boolean;
  outDir?: string;
  analysisOut?: string;
  draftOut?: string;
  contractOut?: string;
  reportOut?: string;
  remoteObservation?: RemoteBrowserObservation;
}

export interface OnboardingValidationResult {
  ok: boolean;
  errors: string[];
}

export interface OnboardingArtifactPaths {
  outDir: string;
  analysisPath: string;
  draftPath: string;
  contractPath: string;
  reportPath: string;
}

export interface CompletedOnboardingResult {
  state: "completed";
  surfaceId: string;
  surfaceName: string;
  sourceMode: AnalysisSourceMode;
  status: "pass" | "warn";
  gateStatus: SourceHealthStatus;
  authProfileName?: string;
  findingCodes: string[];
  runId: string;
  artifacts: OnboardingArtifactPaths;
  analysis: SurfaceAnalysisArtifact;
  draft: AnalyzeSurfaceResult["draft"];
  contract: AnalyzeSurfaceResult["contract"];
  extractionReport: AnalyzeSurfaceResult["extractionReport"];
}

export interface AuthRequiredOnboardingResult {
  state: "auth_required";
  surfaceId: string;
  surfaceName: string;
  sourceMode: AnalysisSourceMode;
  gateStatus: Exclude<SourceHealthStatus, "ok">;
  message: string;
  analysis: SurfaceAnalysisArtifact;
}

export interface FailedOnboardingResult {
  state: "failed";
  message: string;
}

export type OnboardingResult =
  | CompletedOnboardingResult
  | AuthRequiredOnboardingResult
  | FailedOnboardingResult;

const DEFAULT_OUT_DIR = "contracts/generated";

function inferSourceMode(options: Pick<OnboardingRequest, "sourceMode" | "appRoot" | "url">): AnalysisSourceMode {
  if (options.sourceMode === "local-root" || options.sourceMode === "remote-url") {
    return options.sourceMode;
  }
  if (options.appRoot && !options.url) {
    return "local-root";
  }
  if (options.appRoot) {
    return "local-root";
  }
  return "remote-url";
}

export function normalizeSurfaceId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function validateOnboardingRequest(request: OnboardingRequest): OnboardingValidationResult {
  const errors: string[] = [];
  const sourceMode = inferSourceMode(request);

  if (sourceMode === "remote-url") {
    if (!request.url || request.url.trim().length === 0) {
      errors.push("URL is required.");
    } else {
      try {
        void new URL(request.url);
      } catch {
        errors.push("URL must be valid.");
      }
    }
  }

  if (sourceMode === "local-root" && (!request.appRoot || request.appRoot.trim().length === 0)) {
    errors.push("appRoot is required for local-root onboarding.");
  }

  if (request.surfaceId !== undefined && normalizeSurfaceId(request.surfaceId).length === 0) {
    errors.push("Surface id override resolves to an empty value.");
  }

  return { ok: errors.length === 0, errors };
}

function resolveArtifactPaths(
  rootDir: string,
  surfaceId: string,
  options: Pick<OnboardingRequest, "outDir" | "analysisOut" | "draftOut" | "contractOut" | "reportOut">,
): OnboardingArtifactPaths {
  const outDir = options.outDir
    ? path.resolve(rootDir, options.outDir)
    : path.resolve(rootDir, DEFAULT_OUT_DIR);
  const resolvePath = (explicit: string | undefined, fileName: string) =>
    explicit ? path.resolve(rootDir, explicit) : path.join(outDir, fileName);

  return {
    outDir,
    analysisPath: resolvePath(options.analysisOut, `${surfaceId}.analysis.json`),
    draftPath: resolvePath(options.draftOut, `${surfaceId}.design-system.draft.json`),
    contractPath: resolvePath(options.contractOut, `${surfaceId}.contract.json`),
    reportPath: resolvePath(options.reportOut, `${surfaceId}.extraction.json`),
  };
}

async function writeArtifact(filePath: string, payload: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, stringifyStableArtifact(payload), "utf-8");
}

function collectFindingCodes(analysis: SurfaceAnalysisArtifact): string[] {
  return [
    ...analysis.warnings.map((warning) => `analysis.${warning.code}`),
    ...analysis.inconsistencies.findings.map((finding) => `analysis.${finding.code}`),
  ].sort((a, b) => a.localeCompare(b));
}

function gateFailureMessage(analysis: SurfaceAnalysisArtifact): string {
  if (analysis.sourceHealth.status === "access-denied") {
    return "Remote onboarding stopped because we reached an access-denied page instead of the target surface. Provide a saved auth profile or allow provisional output.";
  }
  return "Remote onboarding stopped because we reached a login page instead of the target surface. Provide a saved auth profile or allow provisional output.";
}

function buildProvisionalWarning(analysis: SurfaceAnalysisArtifact): { code: string; message: string } {
  const detail =
    analysis.sourceHealth.status === "access-denied"
      ? "the remote URL resolved to an access-denied page"
      : analysis.sourceHealth.status === "login"
        ? "the remote URL resolved to a login page"
        : "remote source access is limited";
  return {
    code: "remote.source.provisional",
    message: `Writing provisional onboarding artifacts because ${detail}.`,
  };
}

function applyProvisionalWarning<T extends AnalyzeSurfaceResult>(analysisResult: T): T {
  const warning = buildProvisionalWarning(analysisResult.analysis);
  const dedupeWarnings = (items: Array<{ code: string; message: string }>) =>
    [...new Map(items.map((item) => [`${item.code}:${item.message}`, item])).values()]
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

function validateLocalAppRoot(rootDir: string, request: OnboardingRequest, sourceMode: AnalysisSourceMode): string | null {
  if (sourceMode !== "local-root") {
    return null;
  }
  const appRoot = path.resolve(rootDir, request.appRoot ?? ".");
  if (!existsSync(path.join(appRoot, "app"))) {
    return `Local app root is missing app/: ${appRoot}`;
  }
  return null;
}

function extractSurfaceIdentity(input: {
  sourceMode: AnalysisSourceMode;
  url?: string;
  appRoot?: string;
  surfaceId?: string;
  surfaceName?: string;
}): { surfaceId: string; surfaceName: string } {
  const surfaceSuggestion =
    input.surfaceId ??
    (
      input.sourceMode === "remote-url" && input.url
        ? suggestSurfaceIdFromUrl(input.url)
        : suggestSurfaceIdFromPath(input.appRoot ?? "surface")
    );
  const surfaceId = normalizeSurfaceId(surfaceSuggestion);
  return {
    surfaceId,
    surfaceName: input.surfaceName ?? suggestSurfaceName(surfaceId),
  };
}

function ensureValidGeneratedContract(contract: InterfaceContract): string[] {
  const structure = validateContractStructure(contract, getBundledContractSchema() as object);
  return structure.ok ? [] : structure.errors;
}

export async function runOnboardingRequest(request: OnboardingRequest): Promise<OnboardingResult> {
  const validation = validateOnboardingRequest(request);
  if (!validation.ok) {
    return { state: "failed", message: validation.errors.join(" ") };
  }

  const rootDir = path.resolve(request.rootDir ?? process.cwd());
  const sourceMode = inferSourceMode(request);
  const localRootError = validateLocalAppRoot(rootDir, request, sourceMode);
  if (localRootError) {
    return { state: "failed", message: localRootError };
  }

  const identity = extractSurfaceIdentity({
    sourceMode,
    url: request.url,
    appRoot: request.appRoot,
    surfaceId: request.surfaceId,
    surfaceName: request.surfaceName,
  });

  let authMode: "none" | "browser-session" = "none";
  let authProfileName: string | undefined;
  let authStorageState: string | undefined;
  if (sourceMode === "remote-url" && request.authProfileName && request.url) {
    const requestedUrl = new URL(request.url);
    const inspection = await inspectAuthProfile(request.authProfileName, requestedUrl.hostname);
    if (inspection.status !== "ready" || !inspection.profile || !inspection.storageState) {
      const reason = inspection.status === "missing"
        ? "was not found"
        : inspection.status === "expired"
          ? "is expired"
          : inspection.status === "legacy"
            ? "is legacy and must be re-captured"
            : "is not replay-ready and must be re-captured";
      return {
        state: "failed",
        message: `Auth profile "${request.authProfileName}" for ${requestedUrl.hostname} ${reason}.`,
      };
    }
    authMode = "browser-session";
    authProfileName = inspection.profile.name;
    authStorageState = inspection.storageState;
  }

  const remoteObservation =
    sourceMode === "remote-url" && request.url
      ? (request.remoteObservation ?? await observeRemotePage({
          url: request.url,
          storageState: authStorageState,
        }))
      : undefined;

  const remoteSourceBlocked =
    sourceMode === "remote-url" &&
    remoteObservation &&
    remoteObservation.sourceHealth.status !== "ok";

  if (remoteSourceBlocked && authMode === "browser-session") {
    return {
      state: "failed",
      message:
        remoteObservation.sourceHealth.status === "access-denied"
          ? `Authenticated replay reached an access-denied page at ${remoteObservation.sourceHealth.finalUrl}.`
          : `Authenticated replay still resolved to a login page at ${remoteObservation.sourceHealth.finalUrl}. Re-capture the auth profile and retry.`,
    };
  }

  let analysisResult = await analyzeSurface({
    workspaceRoot: rootDir,
    surfaceId: identity.surfaceId,
    surfaceName: identity.surfaceName,
    sourceMode,
    appRoot: request.appRoot,
    url: request.url,
    surfaceKindOverride: request.surfaceKind,
    authMode,
    authProfileName,
    authStorageState,
    remoteObservation,
  });

  if (remoteSourceBlocked && authMode === "none") {
    if (request.continueOnGate !== true) {
      return {
        state: "auth_required",
        surfaceId: identity.surfaceId,
        surfaceName: identity.surfaceName,
        sourceMode,
        gateStatus: analysisResult.analysis.sourceHealth.status as Exclude<SourceHealthStatus, "ok">,
        message: gateFailureMessage(analysisResult.analysis),
        analysis: analysisResult.analysis,
      };
    }
    analysisResult = applyProvisionalWarning(analysisResult);
  }

  const schemaErrors = ensureValidGeneratedContract(analysisResult.contract);
  if (schemaErrors.length > 0) {
    return {
      state: "failed",
      message: `Generated contract failed schema validation: ${schemaErrors.join(" ")}`,
    };
  }

  const artifacts = resolveArtifactPaths(rootDir, identity.surfaceId, request);
  await writeArtifact(artifacts.analysisPath, analysisResult.analysis);
  await writeArtifact(artifacts.draftPath, analysisResult.draft);
  await writeArtifact(artifacts.contractPath, analysisResult.contract);
  await writeArtifact(artifacts.reportPath, analysisResult.extractionReport);

  const findingCodes = collectFindingCodes(analysisResult.analysis);
  const status = findingCodes.length > 0 ? "warn" : "pass";
  const run = await emitOnboardingRunArtifact({
    rootDir,
    surfaceId: identity.surfaceId,
    source: "generation",
    status,
    findingCodes,
    extractionPath: artifacts.contractPath,
    reportPath: artifacts.reportPath,
  });

  return {
    state: "completed",
    surfaceId: identity.surfaceId,
    surfaceName: identity.surfaceName,
    sourceMode,
    status,
    gateStatus: analysisResult.analysis.sourceHealth.status,
    authProfileName,
    findingCodes,
    runId: run.runId,
    artifacts,
    analysis: analysisResult.analysis,
    draft: analysisResult.draft,
    contract: analysisResult.contract,
    extractionReport: analysisResult.extractionReport,
  };
}
