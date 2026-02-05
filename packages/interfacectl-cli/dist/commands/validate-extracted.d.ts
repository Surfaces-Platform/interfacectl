/** Phase 0 extracted fields (extractor shape). */
export interface ExtractedFields {
    routes: string[];
    hasShell: boolean;
    designSystemComponents: string[];
    authAware: boolean;
}
/** Optional per-surface Phase 0 expectations (policy contract). */
export interface Phase0Expectations {
    authPosture?: "public" | "auth-aware" | "auth-first";
    requiresShell?: boolean;
    expectsAuthRoutes?: boolean;
    expectsDesignSystem?: boolean;
}
export interface ValidateExtractedOptions {
    contractPath: string;
    extractedPath: string;
    surfaceId?: string;
    format?: "text" | "json";
    exitCodes?: "v1" | "v2";
}
export interface Finding {
    surfaceId: string;
    code: string;
    category: "E0" | "E2";
    message: string;
    expected?: unknown;
    found?: unknown;
}
export interface ValidateExtractedResult {
    ok: boolean;
    findings: Finding[];
}
export declare function runValidateExtractedCommand(options: ValidateExtractedOptions): Promise<number>;
//# sourceMappingURL=validate-extracted.d.ts.map