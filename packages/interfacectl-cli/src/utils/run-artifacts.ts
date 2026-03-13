import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { stringifyDeterministicJson, writeDeterministicJsonSync } from "./deterministic-json.js";

export type RunArtifactStatus = "pass" | "warn" | "fail" | "unknown";
export type RunArtifactSource = "bootstrap" | "generation" | "ci" | "runtime";

export interface ContractRun {
  runId: string;
  workspaceId: string;
  idempotencyKey?: string;
  ingestedAt?: string;
  createdAt: string;
  surfaceId: string;
  source: RunArtifactSource;
  contract: {
    id: string;
    version: string;
    sha256: string;
  };
  artifacts: {
    extractionPath?: string;
    reportPath?: string;
  };
  status: RunArtifactStatus;
  findingCodes: string[];
  summary: {
    errorCount: number;
    warnCount: number;
  };
}

export interface ContractRunsDocument {
  schemaVersion: 2;
  runs: ContractRun[];
}

export interface ContractLineageRecord {
  lastRunId: string;
  lastRunAt: string;
  lastSource: RunArtifactSource;
  lastStatus: RunArtifactStatus;
  contract: {
    id: string;
    version: string;
    sha256: string;
  };
  artifacts: {
    extractionPath?: string;
    reportPath?: string;
  };
  findingCodes: string[];
}

export interface ContractLineageDocument {
  schemaVersion: 1;
  surfaces: Record<string, ContractLineageRecord>;
}

export interface EmitContractRunArtifactInput {
  rootDir: string;
  surfaceId: string;
  source: RunArtifactSource;
  status: RunArtifactStatus;
  findingCodes: string[];
  extractionPath?: string;
  reportPath?: string;
  contractPath?: string;
  workspaceId?: string;
  idempotencyKey?: string;
  createdAt?: string;
  runId?: string;
}

export interface EmitContractRunArtifactResult {
  deduped: boolean;
  runId: string;
  surfaceId: string;
  runsPath: string;
  lineagePath: string;
}

const LOCK_TIMEOUT_MS = 5_000;
const LOCK_POLL_MS = 25;
const DEFAULT_WORKSPACE_ID = "ws-local-default";

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function acquireLock(lockPath: string, timeoutMs = LOCK_TIMEOUT_MS): void {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      fs.mkdirSync(lockPath);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "EEXIST") {
        throw error;
      }
      sleep(LOCK_POLL_MS);
    }
  }
  throw new Error(`Timed out acquiring run-artifact lock: ${lockPath}`);
}

function releaseLock(lockPath: string): void {
  try {
    fs.rmdirSync(lockPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
      throw error;
    }
  }
}

function readJson<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function sha256FromFile(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return createHash("sha256").update(content).digest("hex");
}

function normalizeContractIdentity(rootDir: string, contractPath?: string): {
  id: string;
  version: string;
  sha256: string;
} {
  const resolvedPath = contractPath
    ? path.resolve(rootDir, contractPath)
    : path.resolve(rootDir, "contracts", "surfaces.web.contract.json");

  if (!fs.existsSync(resolvedPath)) {
    return { id: "unknown", version: "unknown", sha256: "0".repeat(64) };
  }

  try {
    const raw = fs.readFileSync(resolvedPath, "utf8");
    const parsed = JSON.parse(raw) as { contractId?: string; version?: string };
    return {
      id: parsed.contractId ?? "unknown",
      version: parsed.version ?? "unknown",
      sha256: sha256FromFile(resolvedPath),
    };
  } catch {
    return { id: "unknown", version: "unknown", sha256: "0".repeat(64) };
  }
}

function toRelative(rootDir: string, candidate?: string): string | undefined {
  if (!candidate) return undefined;
  if (path.isAbsolute(candidate)) {
    return path.relative(rootDir, candidate);
  }
  return candidate;
}

function statusSummary(status: RunArtifactStatus, findingCodes: string[]) {
  return {
    errorCount: status === "fail" ? Math.max(1, findingCodes.length) : 0,
    warnCount: status === "warn" ? Math.max(1, findingCodes.length) : 0,
  };
}

function sortRunsDeterministic(runs: ContractRun[]): ContractRun[] {
  return [...runs].sort((left, right) => {
    const timeDiff = Date.parse(left.createdAt) - Date.parse(right.createdAt);
    if (timeDiff !== 0) return timeDiff;
    return left.runId.localeCompare(right.runId);
  });
}

function latestRunsBySurface(runs: ContractRun[]): Map<string, ContractRun> {
  const latest = new Map<string, ContractRun>();
  for (const run of runs) {
    latest.set(run.surfaceId, run);
  }
  return latest;
}

function rebuildLineageFromRuns(runs: ContractRun[]): ContractLineageDocument {
  const surfaces: Record<string, ContractLineageRecord> = {};
  for (const [surfaceId, run] of latestRunsBySurface(runs).entries()) {
    surfaces[surfaceId] = {
      lastRunId: run.runId,
      lastRunAt: run.createdAt,
      lastSource: run.source,
      lastStatus: run.status,
      contract: run.contract,
      artifacts: run.artifacts,
      findingCodes: run.findingCodes,
    };
  }
  return {
    schemaVersion: 1,
    surfaces,
  };
}

function ensureArtifacts(rootDir: string): {
  generatedDir: string;
  runsPath: string;
  lineagePath: string;
  lockPath: string;
} {
  const generatedDir = path.join(rootDir, "contracts", "generated");
  fs.mkdirSync(generatedDir, { recursive: true });
  const runsPath = path.join(generatedDir, "contract-runs.json");
  const lineagePath = path.join(generatedDir, "contract-lineage.json");
  const lockPath = path.join(generatedDir, "contract-runs.lock");

  if (!fs.existsSync(runsPath)) {
    writeDeterministicJsonSync(runsPath, { schemaVersion: 2, runs: [] });
  }
  if (!fs.existsSync(lineagePath)) {
    writeDeterministicJsonSync(lineagePath, { schemaVersion: 1, surfaces: {} });
  }

  return {
    generatedDir,
    runsPath,
    lineagePath,
    lockPath,
  };
}

export function emitContractRunArtifact(
  input: EmitContractRunArtifactInput,
): EmitContractRunArtifactResult {
  const rootDir = path.resolve(input.rootDir);
  const { runsPath, lineagePath, lockPath } = ensureArtifacts(rootDir);
  const workspaceId = input.workspaceId?.trim() || DEFAULT_WORKSPACE_ID;
  const idempotencyKey = input.idempotencyKey?.trim() || undefined;
  const createdAt = input.createdAt ?? new Date().toISOString();
  const runId = input.runId ?? randomUUID();

  const runRecord: ContractRun = {
    runId,
    workspaceId,
    ...(idempotencyKey ? { idempotencyKey } : {}),
    ingestedAt: new Date().toISOString(),
    createdAt,
    surfaceId: input.surfaceId,
    source: input.source,
    contract: normalizeContractIdentity(rootDir, input.contractPath),
    artifacts: {
      extractionPath: toRelative(rootDir, input.extractionPath),
      reportPath: toRelative(rootDir, input.reportPath),
    },
    status: input.status,
    findingCodes: [...new Set(input.findingCodes)].sort((left, right) => left.localeCompare(right)),
    summary: statusSummary(input.status, input.findingCodes),
  };

  acquireLock(lockPath);
  try {
    const runsDoc = readJson<ContractRunsDocument>(runsPath, {
      schemaVersion: 2,
      runs: [],
    });
    const currentRuns = Array.isArray(runsDoc.runs) ? runsDoc.runs : [];

    const duplicateByRunId = currentRuns.some(
      (run) => (run.workspaceId || DEFAULT_WORKSPACE_ID) === workspaceId && run.runId === runRecord.runId,
    );
    const duplicateByIdempotencyKey =
      Boolean(idempotencyKey) &&
      currentRuns.some(
        (run) =>
          (run.workspaceId || DEFAULT_WORKSPACE_ID) === workspaceId &&
          typeof run.idempotencyKey === "string" &&
          run.idempotencyKey === idempotencyKey,
      );

    const nextRuns = duplicateByRunId || duplicateByIdempotencyKey
      ? currentRuns
      : sortRunsDeterministic([...currentRuns, runRecord]);

    const effectiveRun = duplicateByRunId || duplicateByIdempotencyKey
      ? nextRuns.find(
        (run) =>
          run.runId === runRecord.runId ||
          (Boolean(idempotencyKey) && run.idempotencyKey === idempotencyKey),
      ) ?? runRecord
      : runRecord;

    fs.writeFileSync(runsPath, stringifyDeterministicJson({
      schemaVersion: 2,
      runs: nextRuns,
    }), "utf8");
    fs.writeFileSync(lineagePath, stringifyDeterministicJson(rebuildLineageFromRuns(nextRuns)), "utf8");

    return {
      deduped: Boolean(duplicateByRunId || duplicateByIdempotencyKey),
      runId: effectiveRun.runId,
      surfaceId: effectiveRun.surfaceId,
      runsPath,
      lineagePath,
    };
  } finally {
    releaseLock(lockPath);
  }
}
