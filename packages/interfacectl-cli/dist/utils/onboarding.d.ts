type ValidationOutcome = "pass" | "warn" | "fail" | "unknown";
export interface BootstrapExtractionReport {
    surfaceId: string;
    appRoot: string;
    warnings: {
        code: string;
        message: string;
    }[];
    extracted: {
        routes: string[];
        hasShell: boolean;
        designSystemComponents: string[];
        authAware: boolean;
    };
    onboarding: {
        sourceUrl: string;
        authMode: "none" | "browser-session";
        extractMode: "remote-url" | "local-root";
        profileName?: string;
        profileDomain?: string;
        startedAt: string;
        completedAt: string;
        detection: {
            adapter: string;
            framework: string;
            profile: string;
        };
    };
}
export declare function suggestSurfaceIdFromUrl(rawUrl: string): string;
export declare function suggestSurfaceName(surfaceId: string): string;
export declare function buildBootstrapContract(input: {
    surfaceId: string;
    surfaceName: string;
    sourceUrl: string;
    authAware: boolean;
}): Record<string, unknown>;
export declare function writeBootstrapArtifacts(input: {
    rootDir: string;
    outDir?: string;
    surfaceId: string;
    contract: Record<string, unknown>;
    report: BootstrapExtractionReport;
}): Promise<{
    contractPath: string;
    reportPath: string;
}>;
export declare function emitBootstrapRunArtifact(input: {
    rootDir: string;
    surfaceId: string;
    status: ValidationOutcome;
    findingCodes: string[];
    extractionPath: string;
    reportPath: string;
}): Promise<{
    runId: string;
}>;
export {};
//# sourceMappingURL=onboarding.d.ts.map