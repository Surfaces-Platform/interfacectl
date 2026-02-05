/**
 * Phase 0 extraction: machine-readable fields derived from Next.js app code.
 * Validator does not use these; they are for tooling and debugging.
 */
export interface ExtractedContractFields {
    routes: string[];
    hasShell: boolean;
    designSystemComponents: string[];
    authAware: boolean;
}
export interface ExtractionWarning {
    code: string;
    message: string;
}
export interface ExtractionReport {
    surfaceId: string;
    appRoot: string;
    warnings: ExtractionWarning[];
    extracted: ExtractedContractFields;
}
export interface ExtractContractFromNextAppOptions {
    /** Path to the Next.js app root (directory containing app/) */
    appRoot: string;
    /** Surface identifier (e.g. surfaces-web) */
    surfaceId: string;
    /** Optional base URL; not used in v0 (no network) */
    baseUrl?: string;
    /** Optional config overlay; not used in v0 */
    config?: Record<string, unknown>;
}
export interface ExtractContractResult {
    /** Contract JSON-serializable object (deterministic key order) */
    contract: Record<string, unknown>;
    /** Extraction report for debugging */
    report: ExtractionReport;
}
//# sourceMappingURL=types.d.ts.map