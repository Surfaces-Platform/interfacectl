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
export declare function runReplayGenerationBenchmarkCommand(options: ReplayGenerationBenchmarkCommandOptions): Promise<number>;
export declare function runInitGenerationSessionCommand(options: InitGenerationSessionCommandOptions): Promise<number>;
export declare function runPrepareGenerationHandoffCommand(options: PrepareGenerationHandoffCommandOptions): Promise<number>;
export declare function runRecordGenerationAttemptCommand(options: RecordGenerationAttemptCommandOptions): Promise<number>;
export declare function runCaptureGenerationPreviewCommand(options: CaptureGenerationPreviewCommandOptions): Promise<number>;
export declare function runReviewGenerationAttemptCommand(options: ReviewGenerationAttemptCommandOptions): Promise<number>;
export declare function runSummarizeGenerationSessionCommand(options: SummarizeGenerationSessionCommandOptions): Promise<number>;
export declare function runCompareGenerationSessionsCommand(options: CompareGenerationSessionsCommandOptions): Promise<number>;
export declare function runSuggestContractDeltasCommand(options: SuggestContractDeltasCommandOptions): Promise<number>;
export declare function runReviewContractDeltaSuggestionsCommand(options: ReviewContractDeltaSuggestionsCommandOptions): Promise<number>;
export declare function runSummarizeGenerationBenchmarkCommand(options: SummarizeGenerationBenchmarkCommandOptions): Promise<number>;
//# sourceMappingURL=generation-session.d.ts.map