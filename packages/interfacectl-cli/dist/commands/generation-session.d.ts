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
export declare function runInitGenerationSessionCommand(options: InitGenerationSessionCommandOptions): Promise<number>;
export declare function runRecordGenerationAttemptCommand(options: RecordGenerationAttemptCommandOptions): Promise<number>;
export declare function runSummarizeGenerationSessionCommand(options: SummarizeGenerationSessionCommandOptions): Promise<number>;
//# sourceMappingURL=generation-session.d.ts.map