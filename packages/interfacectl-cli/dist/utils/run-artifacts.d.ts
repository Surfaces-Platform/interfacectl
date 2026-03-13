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
export declare function emitContractRunArtifact(input: EmitContractRunArtifactInput): EmitContractRunArtifactResult;
//# sourceMappingURL=run-artifacts.d.ts.map