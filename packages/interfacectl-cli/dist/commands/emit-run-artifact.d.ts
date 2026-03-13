export interface EmitRunArtifactCommandOptions {
    workspaceRoot?: string;
    surfaceId?: string;
    source?: string;
    status?: string;
    contractPath?: string;
    extractionPath?: string;
    reportPath?: string;
    findingCodes?: string;
    workspaceId?: string;
    idempotencyKey?: string;
    createdAt?: string;
    runId?: string;
}
export declare function runEmitRunArtifactCommand(options: EmitRunArtifactCommandOptions): Promise<number>;
//# sourceMappingURL=emit-run-artifact.d.ts.map