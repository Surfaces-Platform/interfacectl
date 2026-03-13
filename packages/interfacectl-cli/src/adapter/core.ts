import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  AdapterInputError,
  ensureReadableFile,
  isRecord,
  loadCompiledSurfaceBundle,
  readJsonFile,
  type JsonRecord,
} from "./bundle.js";
import { runDescribeCommand } from "../commands/describe.js";
import { runValidateCommand } from "../commands/validate.js";

export { AdapterInputError, isAdapterInputError } from "./bundle.js";

const VALID_TOOLS = new Set(["codex", "cursor", "lovable", "figma-make"]);
const VALID_MODES = new Set(["workspace", "descriptor"]);
const DEFAULT_DESCRIPTOR_PARITY_CONFIG =
  "contracts/generation-descriptor-parity.json";

const PARITY_FINDING_CODES = new Set([
  "color.disallowed",
  "icon.source-disallowed",
  "descriptor.icons.missing",
]);

const VALIDATE_CODE_MAP: Record<string, string> = {
  "color.raw-value.used": "color.rawValues",
  "color.token.namespace.violation": "color.token.namespace",
  "shell.primitive.disallowed": "shell-owned-primitive-emitted",
};

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_GUARD_PATH = path.resolve(
  MODULE_DIR,
  "../../../../tools/check-generation-boundaries.mjs",
);

type FindingSeverity = "error" | "warning";
type FindingPolicy = "strict" | "warn" | "off";
type AdapterMode = "workspace" | "descriptor";

export interface AdapterFinding {
  code: string;
  severity: FindingSeverity;
  policy: FindingPolicy;
  message: string;
  location: {
    file: string;
    line: number;
  };
  evidence: Record<string, unknown>;
}

export interface GenerationAdapterRequest {
  requestId?: string;
  tool?: string;
  surfaceId?: string;
  mode?: string;
  bundleRoot?: string;
  workspaceRoot?: string;
  descriptor?: JsonRecord[];
  provenance?: {
    sessionId?: string;
    userId?: string;
    timestamp?: string;
  };
  contractPath?: string;
}

interface NormalizedGenerationAdapterRequest {
  requestId: string;
  tool: string;
  surfaceId: string;
  mode: AdapterMode;
  bundleRoot: string;
  workspaceRoot?: string;
  descriptor?: JsonRecord[];
  provenance: {
    sessionId?: string;
    userId?: string;
    timestamp: string;
  };
}

interface BundleSurfaceRefs {
  contractPath: string;
  generationPath: string;
  sectionsPath: string;
  componentsPath: string;
  constraintsPath: string;
  repairMapPath: string;
  authoringPath?: string;
  manifestPath: string;
}

interface BundleInfo extends BundleSurfaceRefs {
  root: string;
  version: string;
  contractId: string;
  contractVersion: string;
}

interface RuntimeContext {
  cwd: string;
  bundle: BundleInfo;
  guardPath: string;
  nodeBin: string;
  env: NodeJS.ProcessEnv;
  descriptorParityConfigPath?: string;
}

interface GuardEvaluation {
  shellBoundaryEvaluated: boolean;
  colorPolicyEvaluated: boolean;
  iconPolicyEvaluated: boolean;
}

export interface GenerationAdapterResponse {
  requestId: string;
  status: "pass" | "warn" | "block";
  surfaceId: string;
  bundle: {
    root: string;
    version: string;
    manifestPath: string;
    surfacePath: string;
  };
  contract: {
    id: string;
    version: string;
  };
  coverage: {
    generationGuard: boolean;
    fullValidate: boolean;
    shellBoundaryEvaluated: boolean;
    colorPolicyEvaluated: boolean;
    iconPolicyEvaluated: boolean;
  };
  findings: AdapterFinding[];
  timings: {
    totalMs: number;
  };
  provenance: {
    sessionId?: string;
    userId?: string;
    timestamp: string;
    evaluatedAt: string;
  };
}

export interface RunGenerationAdapterOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  nodeBin?: string;
  generationGuardPath?: string;
  descriptorParityConfigPath?: string;
  descriptorParitySurfaces?: string[];
  defaultBundleRoot?: string;
}

function resolvePathOrDefault(value: string | undefined, fallback: string | undefined, cwd: string) {
  const candidate = value ?? fallback;
  if (!candidate) return undefined;
  return path.isAbsolute(candidate) ? candidate : path.resolve(cwd, candidate);
}


function resolveGuardPath(options: RunGenerationAdapterOptions, cwd: string): string {
  const env = options.env ?? process.env;
  const explicit = resolvePathOrDefault(
    options.generationGuardPath ??
      env.SURFACES_INTERFACECTL_GENERATION_GUARD ??
      env.SURFACES_ADAPTER_GENERATION_GUARD,
    undefined,
    cwd,
  );
  if (explicit) {
    ensureReadableFile(explicit, "Generation guard");
    return explicit;
  }

  ensureReadableFile(DEFAULT_GUARD_PATH, "Generation guard");
  return DEFAULT_GUARD_PATH;
}

function normalizeAdapterRequest(
  input: GenerationAdapterRequest,
  options: RunGenerationAdapterOptions = {},
): NormalizedGenerationAdapterRequest {
  if (!isRecord(input)) {
    throw new AdapterInputError("Adapter request must be an object.");
  }

  if (typeof input.contractPath === "string" && input.contractPath.trim().length > 0) {
    throw new AdapterInputError(
      "contractPath is no longer supported. Use bundleRoot instead.",
      { code: "adapter.input.legacy-contract-path" },
    );
  }

  const cwd = options.cwd ?? process.cwd();
  const requestId =
    typeof input.requestId === "string" && input.requestId.trim().length > 0
      ? input.requestId.trim()
      : crypto.randomUUID();

  const tool =
    typeof input.tool === "string" ? input.tool.trim().toLowerCase() : "";
  if (!VALID_TOOLS.has(tool)) {
    throw new AdapterInputError(
      `Invalid tool "${input.tool ?? ""}". Expected one of: ${[...VALID_TOOLS].join(", ")}.`,
    );
  }

  const surfaceId =
    typeof input.surfaceId === "string" ? input.surfaceId.trim() : "";
  if (!surfaceId) {
    throw new AdapterInputError("surfaceId is required.");
  }

  const mode =
    typeof input.mode === "string" ? input.mode.trim() : "";
  if (!VALID_MODES.has(mode)) {
    throw new AdapterInputError(
      `Invalid mode "${input.mode ?? ""}". Expected workspace|descriptor.`,
    );
  }

  const bundleRootInput =
    typeof input.bundleRoot === "string" && input.bundleRoot.trim().length > 0
      ? input.bundleRoot.trim()
      : options.defaultBundleRoot;
  if (!bundleRootInput) {
    throw new AdapterInputError("bundleRoot is required.");
  }
  const bundleRoot = path.resolve(cwd, bundleRootInput);

  let workspaceRoot: string | undefined;
  if (mode === "workspace") {
    const rawWorkspaceRoot =
      typeof input.workspaceRoot === "string" && input.workspaceRoot.trim().length > 0
        ? input.workspaceRoot.trim()
        : undefined;
    if (!rawWorkspaceRoot) {
      throw new AdapterInputError(
        "workspaceRoot is required when mode=workspace.",
      );
    }
    workspaceRoot = path.resolve(cwd, rawWorkspaceRoot);
  }

  let descriptor: JsonRecord[] | undefined;
  if (mode === "descriptor") {
    if (!Array.isArray(input.descriptor)) {
      throw new AdapterInputError(
        "descriptor must be an array when mode=descriptor.",
      );
    }
    descriptor = input.descriptor.map((entry) => {
      if (!isRecord(entry)) {
        throw new AdapterInputError("descriptor entries must be JSON objects.");
      }
      return entry;
    });
  }

  const provenanceInput = isRecord(input.provenance) ? input.provenance : {};
  const provenance = {
    sessionId:
      typeof provenanceInput.sessionId === "string"
        ? provenanceInput.sessionId
        : undefined,
    userId:
      typeof provenanceInput.userId === "string"
        ? provenanceInput.userId
        : undefined,
    timestamp:
      typeof provenanceInput.timestamp === "string"
        ? provenanceInput.timestamp
        : new Date().toISOString(),
  };

  return {
    requestId,
    tool,
    surfaceId,
    mode: mode as AdapterMode,
    bundleRoot,
    workspaceRoot,
    descriptor,
    provenance,
  };
}

function resolveBundleSurface(
  request: NormalizedGenerationAdapterRequest,
  cwd: string,
): BundleInfo {
  const bundle = loadCompiledSurfaceBundle(request.bundleRoot, request.surfaceId, cwd);

  return {
    root: bundle.root,
    version: bundle.version,
    contractId: bundle.contractId,
    contractVersion: bundle.contractVersion,
    manifestPath: bundle.manifest.path,
    contractPath: bundle.contract.path,
    generationPath: bundle.surface.generation.path,
    sectionsPath: bundle.surface.sections.path,
    componentsPath: bundle.surface.components.path,
    constraintsPath: bundle.surface.constraints.path,
    repairMapPath: bundle.surface.repairMap.path,
    ...(bundle.surface.authoring ? { authoringPath: bundle.surface.authoring.path } : {}),
  };
}

function resolveRuntime(
  request: NormalizedGenerationAdapterRequest,
  options: RunGenerationAdapterOptions = {},
): RuntimeContext {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const descriptorParityConfigPath = resolvePathOrDefault(
    options.descriptorParityConfigPath ??
      env.SURFACES_ADAPTER_DESCRIPTOR_PARITY_CONFIG ??
      DEFAULT_DESCRIPTOR_PARITY_CONFIG,
    undefined,
    cwd,
  );

  return {
    cwd,
    bundle: resolveBundleSurface(request, cwd),
    guardPath: resolveGuardPath(options, cwd),
    nodeBin: options.nodeBin ?? process.execPath,
    env,
    descriptorParityConfigPath,
  };
}

function runNodeScript(runtime: RuntimeContext, scriptPath: string, args: string[]) {
  const result = spawnSync(runtime.nodeBin, [scriptPath, ...args], {
    cwd: runtime.cwd,
    env: runtime.env,
    encoding: "utf8",
  });

  if (result.error) {
    throw new Error(`Failed to run ${scriptPath}: ${result.error.message}`);
  }

  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function makeTempJsonFile(prefix: string, fileName: string, payload: unknown) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  const filePath = path.join(tempDir, fileName);
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return { tempDir, filePath };
}

function makeTempEmptyFile(prefix: string, fileName: string) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  return { tempDir, filePath: path.join(tempDir, fileName) };
}

function cleanupTempPath(tempDir?: string) {
  if (!tempDir) return;
  fs.rmSync(tempDir, { recursive: true, force: true });
}

function parseCsvList(value: unknown): string[] {
  if (!value) return [];
  return String(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeGuardFinding(entry: unknown): AdapterFinding | null {
  if (!isRecord(entry)) {
    return null;
  }

  const code = typeof entry.code === "string" ? entry.code.trim() : "";
  if (!code) {
    return null;
  }

  const severity: FindingSeverity =
    entry.severity === "error" ? "error" : "warning";
  const policy: FindingPolicy =
    entry.policy === "strict" || entry.policy === "off" ? entry.policy : "warn";
  const message =
    typeof entry.message === "string" && entry.message.trim().length > 0
      ? entry.message
      : code;
  const location = isRecord(entry.location) ? entry.location : {};

  return {
    code,
    severity,
    policy,
    message,
    location: {
      file: typeof location.file === "string" ? location.file : "",
      line: Number.isInteger(location.line) ? (location.line as number) : 0,
    },
    evidence: isRecord(entry.evidence) ? entry.evidence : {},
  };
}

function parseGuardFindingsFromJson(payload: unknown): AdapterFinding[] {
  if (!isRecord(payload) || !Array.isArray(payload.findings)) {
    return [];
  }
  return payload.findings
    .map((entry) => normalizeGuardFinding(entry))
    .filter((entry): entry is AdapterFinding => entry !== null);
}

function parseGuardFindingsFromText(output: string): AdapterFinding[] {
  const findings: AdapterFinding[] = [];
  const lines = output.split(/\r?\n/);
  let section = "";

  const primitivePattern =
    /^-\s+surface=(\S+)\s+role=(\S+)\s+count=(\d+)\s+sources=(.*?)\s+disallowedSources=(.*)$/;
  const colorBlockingPattern =
    /^-\s+surface=(\S+)\s+rule=(\S+)\s+value=(.+?)\s+policy=(\S+)\s+source=(\S*)\s+message=(.*)$/;
  const colorWarningPattern =
    /^-\s+surface=(\S+)\s+rule=(\S+)\s+value=(.+?)\s+source=(\S*)\s+message=(.*)$/;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith("shell-owned-primitive-emitted detected")) {
      section = "primitive";
      continue;
    }
    if (line.startsWith("color-policy-blocking detected")) {
      section = "color-blocking";
      continue;
    }
    if (line.startsWith("color-policy-warning detected")) {
      section = "color-warning";
      continue;
    }
    if (!line.startsWith("- ")) {
      continue;
    }

    if (section === "primitive") {
      const match = line.match(primitivePattern);
      if (!match) continue;
      const [, surfaceId, role, count, sourcesRaw, disallowedRaw] = match;
      const sources = parseCsvList(sourcesRaw);
      const disallowedSources = parseCsvList(disallowedRaw);
      findings.push({
        code: "shell-owned-primitive-emitted",
        severity: "error",
        policy: "strict",
        message: `Shell-owned primitive "${role}" emitted for surface "${surfaceId}".`,
        location: {
          file: disallowedSources[0] ?? sources[0] ?? "",
          line: 0,
        },
        evidence: {
          source: "generationGuard",
          surfaceId,
          role,
          count: Number(count),
          sources,
          disallowedSources,
        },
      });
      continue;
    }

    if (section === "color-blocking") {
      const match = line.match(colorBlockingPattern);
      if (!match) continue;
      const [, surfaceId, rule, value, policy, source, message] = match;
      findings.push({
        code: rule,
        severity: "error",
        policy: policy === "warn" || policy === "off" ? "warn" : "strict",
        message,
        location: {
          file: source ?? "",
          line: 0,
        },
        evidence: {
          source: "generationGuard",
          surfaceId,
          value,
        },
      });
      continue;
    }

    if (section === "color-warning") {
      const match = line.match(colorWarningPattern);
      if (!match) continue;
      const [, surfaceId, rule, value, source, message] = match;
      findings.push({
        code: rule,
        severity: "warning",
        policy: "warn",
        message,
        location: {
          file: source ?? "",
          line: 0,
        },
        evidence: {
          source: "generationGuard",
          surfaceId,
          value,
        },
      });
    }
  }

  return findings;
}

function parseGuardEvaluation(payload: unknown): GuardEvaluation {
  const evaluation =
    isRecord(payload) && isRecord(payload.evaluation) ? payload.evaluation : {};
  return {
    shellBoundaryEvaluated: evaluation.shellBoundaryEvaluated !== false,
    colorPolicyEvaluated: evaluation.colorPolicyEvaluated === true,
    iconPolicyEvaluated: evaluation.iconPolicyEvaluated === true,
  };
}

function loadDescriptorParitySurfaces(
  runtime: RuntimeContext,
  options: RunGenerationAdapterOptions,
): Set<string> {
  if (Array.isArray(options.descriptorParitySurfaces)) {
    return new Set(
      options.descriptorParitySurfaces
        .map((entry) => String(entry).trim())
        .filter(Boolean),
    );
  }

  const envOverride = runtime.env.SURFACES_ADAPTER_DESCRIPTOR_PARITY_SURFACES;
  if (typeof envOverride === "string" && envOverride.trim().length > 0) {
    return new Set(parseCsvList(envOverride));
  }

  const configPath = runtime.descriptorParityConfigPath;
  if (!configPath || !fs.existsSync(configPath)) {
    return new Set();
  }

  const payload = readJsonFile(configPath, "descriptor parity config");
  const enforced = Array.isArray(payload.enforcedSurfaces)
    ? payload.enforcedSurfaces
        .map((entry: unknown) => String(entry).trim())
        .filter(Boolean)
    : [];
  return new Set(enforced);
}

function mapValidateCode(code: string): string {
  return VALIDATE_CODE_MAP[code] ?? code;
}

function inferValidatePolicy(findingCode: string, severity: FindingSeverity): FindingPolicy {
  if (findingCode === "color.token.namespace") {
    return "warn";
  }
  if (severity === "error") {
    return "strict";
  }
  return "warn";
}

function toFindingLocation(location: unknown) {
  if (typeof location !== "string") {
    return { file: "", line: 0 };
  }
  return { file: location, line: 0 };
}

function parseJsonPayload(text: string): unknown {
  if (!text || !text.trim()) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function normalizeValidateFindings(payload: unknown): AdapterFinding[] {
  if (!isRecord(payload) || !Array.isArray(payload.findings)) {
    return [];
  }
  return payload.findings.map((findingRaw) => {
    const finding = isRecord(findingRaw) ? findingRaw : {};
    const severity: FindingSeverity =
      finding.severity === "error" ? "error" : "warning";
    const code = mapValidateCode(
      typeof finding.code === "string" ? finding.code : "validate.finding",
    );
    const policy = inferValidatePolicy(code, severity);
    return {
      code,
      severity,
      policy,
      message:
        typeof finding.message === "string" && finding.message.trim().length > 0
          ? finding.message
          : code,
      location: toFindingLocation(finding.location),
      evidence: {
        source: "validate",
        surfaceId: typeof finding.surface === "string" ? finding.surface : undefined,
        category: finding.category,
        expected: finding.expected,
        found: finding.found,
      },
    };
  });
}

function uniqueFindings(findings: AdapterFinding[]): AdapterFinding[] {
  const seen = new Set<string>();
  const normalized: AdapterFinding[] = [];
  for (const finding of findings) {
    const key = JSON.stringify({
      code: finding.code,
      severity: finding.severity,
      policy: finding.policy,
      message: finding.message,
      file: finding.location.file,
      line: finding.location.line,
      surfaceId: finding.evidence.surfaceId,
    });
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push({
      code: finding.code,
      severity: finding.severity,
      policy: finding.policy,
      message: finding.message,
      location: {
        file: finding.location.file,
        line: finding.location.line,
      },
      evidence: finding.evidence,
    });
  }
  return normalized;
}

async function runGenerationGuard(
  request: NormalizedGenerationAdapterRequest,
  runtime: RuntimeContext,
): Promise<{ findings: AdapterFinding[]; evaluation: GuardEvaluation }> {
  let descriptorTempDir: string | undefined;
  let descriptorPath: string | undefined;
  const findings: AdapterFinding[] = [];
  let evaluation: GuardEvaluation = {
    shellBoundaryEvaluated: true,
    colorPolicyEvaluated: false,
    iconPolicyEvaluated: false,
  };

  try {
    if (request.mode === "descriptor") {
      const temp = makeTempJsonFile(
        "interfacectl-generation-descriptor",
        "descriptor.json",
        request.descriptor ?? [],
      );
      descriptorTempDir = temp.tempDir;
      descriptorPath = temp.filePath;
    } else {
      const temp = makeTempEmptyFile(
        "interfacectl-generation-describe",
        "descriptor.json",
      );
      descriptorTempDir = temp.tempDir;
      descriptorPath = temp.filePath;

      const describeExitCode = await runDescribeCommand({
        contractPath: runtime.bundle.contractPath,
        root: request.workspaceRoot,
        surface: [request.surfaceId],
        out: descriptorPath,
      });

      if (describeExitCode !== 0) {
        findings.push({
          code: "generation.guard.describe.failed",
          severity: "error",
          policy: "strict",
          message: "Failed to collect descriptors for generation guard.",
          location: { file: "", line: 0 },
          evidence: {
            source: "generationGuard",
            surfaceId: request.surfaceId,
            exitCode: describeExitCode,
          },
        });
        return { findings, evaluation };
      }
    }

    const guard = runNodeScript(runtime, runtime.guardPath, [
      "--contract",
      runtime.bundle.contractPath,
      "--descriptor",
      descriptorPath,
      "--format",
      "json",
    ]);

    const payload =
      parseJsonPayload(guard.stdout) ?? parseJsonPayload(guard.stderr);
    const parsedFindings = parseGuardFindingsFromJson(payload);
    const parsedFallback = parsedFindings.length > 0
      ? []
      : parseGuardFindingsFromText(`${guard.stderr}\n${guard.stdout}`);

    if (parsedFindings.length > 0) {
      findings.push(...parsedFindings);
      evaluation = parseGuardEvaluation(payload);
    } else {
      findings.push(...parsedFallback);
    }

    if (guard.status === 1) {
      const errorMessage =
        (isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === "string"
          ? payload.error.message
          : isRecord(payload) && typeof payload.error === "string"
            ? payload.error
            : `${guard.stderr || guard.stdout}`.trim()) || "unknown error";
      throw new AdapterInputError(
        `Generation guard failed due to invalid input: ${errorMessage}`,
      );
    }

    if (guard.status === 2 && parsedFindings.length === 0 && parsedFallback.length === 0) {
      findings.push({
        code: "generation.guard.blocked",
        severity: "error",
        policy: "strict",
        message: "Generation guard reported violations but emitted no structured findings.",
        location: { file: "", line: 0 },
        evidence: {
          source: "generationGuard",
          surfaceId: request.surfaceId,
          exitCode: guard.status,
        },
      });
    }

    if (guard.status !== 0 && guard.status !== 2) {
      findings.push({
        code: "generation.guard.execution.failed",
        severity: "error",
        policy: "strict",
        message:
          `Generation guard failed unexpectedly: ${guard.stderr || guard.stdout || "unknown error"}`.trim(),
        location: { file: "", line: 0 },
        evidence: {
          source: "generationGuard",
          surfaceId: request.surfaceId,
          exitCode: guard.status,
        },
      });
    }

    return { findings, evaluation };
  } finally {
    cleanupTempPath(descriptorTempDir);
  }
}

async function runWorkspaceValidate(
  request: NormalizedGenerationAdapterRequest,
  runtime: RuntimeContext,
): Promise<AdapterFinding[]> {
  const temp = makeTempEmptyFile(
    "interfacectl-generation-validate",
    "validate.json",
  );

  try {
    const exitCode = await runValidateCommand({
      workspaceRoot: request.workspaceRoot,
      contractPath: runtime.bundle.contractPath,
      surfaceFilters: [request.surfaceId],
      outputFormat: "json",
      outputPath: temp.filePath,
      exitCodes: "v2",
    });

    if (!fs.existsSync(temp.filePath)) {
      return [
        {
          code: "validate.execution.failed",
          severity: "error",
          policy: "strict",
          message: "validate command did not emit JSON output.",
          location: { file: "", line: 0 },
          evidence: {
            source: "validate",
            surfaceId: request.surfaceId,
            exitCode,
          },
        },
      ];
    }

    const payload = parseJsonPayload(fs.readFileSync(temp.filePath, "utf8"));
    if (!payload) {
      return [
        {
          code: "validate.execution.failed",
          severity: "error",
          policy: "strict",
          message: "validate command did not return JSON output.",
          location: { file: "", line: 0 },
          evidence: {
            source: "validate",
            surfaceId: request.surfaceId,
            exitCode,
          },
        },
      ];
    }

    const allFindings = normalizeValidateFindings(payload);
    const findings = allFindings.filter((finding) => {
      const surfaceId = finding.evidence.surfaceId;
      return !surfaceId || surfaceId === request.surfaceId;
    });

    if (exitCode !== 0 && findings.length === 0 && allFindings.length > 0) {
      return [];
    }

    if (exitCode !== 0 && findings.length === 0) {
      findings.push({
        code: "validate.blocked",
        severity: "error",
        policy: "strict",
        message: "validate command failed without structured findings.",
        location: { file: "", line: 0 },
        evidence: {
          source: "validate",
          surfaceId: request.surfaceId,
          exitCode,
        },
      });
    }

    return findings;
  } finally {
    cleanupTempPath(temp.tempDir);
  }
}

export function buildCoverage(
  mode: AdapterMode,
  detail: Partial<GenerationAdapterResponse["coverage"]> = {},
): GenerationAdapterResponse["coverage"] {
  return {
    generationGuard: true,
    fullValidate: mode === "workspace",
    shellBoundaryEvaluated: detail.shellBoundaryEvaluated ?? false,
    colorPolicyEvaluated: detail.colorPolicyEvaluated ?? false,
    iconPolicyEvaluated: detail.iconPolicyEvaluated ?? false,
  };
}

export function computeStatusFromFindings(findings: AdapterFinding[]): "pass" | "warn" | "block" {
  const hasBlocking = findings.some(
    (finding) => finding.severity === "error" || finding.policy === "strict",
  );
  if (hasBlocking) return "block";
  if (findings.length > 0) return "warn";
  return "pass";
}

export async function runGenerationAdapter(
  requestInput: GenerationAdapterRequest,
  options: RunGenerationAdapterOptions = {},
): Promise<GenerationAdapterResponse> {
  const startedAt = Date.now();
  const request = normalizeAdapterRequest(requestInput, options);
  const runtime = resolveRuntime(request, options);
  const descriptorParitySurfaces = loadDescriptorParitySurfaces(runtime, options);

  ensureReadableFile(runtime.guardPath, "Generation guard");
  if (request.mode === "workspace") {
    if (!request.workspaceRoot || !fs.existsSync(request.workspaceRoot)) {
      throw new AdapterInputError(
        `workspaceRoot does not exist: ${request.workspaceRoot ?? ""}.`,
      );
    }
  }

  const descriptorParityEnabled =
    request.mode === "descriptor" && descriptorParitySurfaces.has(request.surfaceId);
  const guardResult = await runGenerationGuard(request, runtime);
  const findings: AdapterFinding[] = [];
  const guardFindings = descriptorParityEnabled
    ? guardResult.findings
    : guardResult.findings.filter((finding) => !PARITY_FINDING_CODES.has(finding.code));
  findings.push(...guardFindings);

  if (request.mode === "workspace") {
    findings.push(...(await runWorkspaceValidate(request, runtime)));
  }

  const coverage = buildCoverage(request.mode, {
    shellBoundaryEvaluated: guardResult.evaluation.shellBoundaryEvaluated,
    colorPolicyEvaluated:
      descriptorParityEnabled || request.mode === "workspace"
        ? guardResult.evaluation.colorPolicyEvaluated || request.mode === "workspace"
        : false,
    iconPolicyEvaluated:
      descriptorParityEnabled || request.mode === "workspace"
        ? guardResult.evaluation.iconPolicyEvaluated || request.mode === "workspace"
        : false,
  });

  const normalizedFindings = uniqueFindings(findings);
  const status = computeStatusFromFindings(normalizedFindings);

  return {
    requestId: request.requestId,
    status,
    surfaceId: request.surfaceId,
    bundle: {
      root: runtime.bundle.root,
      version: runtime.bundle.version,
      manifestPath: runtime.bundle.manifestPath,
      surfacePath: runtime.bundle.generationPath,
    },
    contract: {
      id: runtime.bundle.contractId,
      version: runtime.bundle.contractVersion,
    },
    coverage,
    findings: normalizedFindings,
    timings: {
      totalMs: Date.now() - startedAt,
    },
    provenance: {
      ...request.provenance,
      evaluatedAt: new Date().toISOString(),
    },
  };
}
