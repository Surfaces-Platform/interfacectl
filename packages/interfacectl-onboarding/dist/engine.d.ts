import { type RemoteBrowserObservation, type SourceHealthStatus } from "./utils/browser-session.js";
import { type AnalyzeSurfaceResult, type AnalysisSourceMode, type SurfaceAnalysisArtifact, type WebSurfaceKind } from "./utils/first-run-analysis.js";
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
export type OnboardingResult = CompletedOnboardingResult | AuthRequiredOnboardingResult | FailedOnboardingResult;
export declare function normalizeSurfaceId(raw: string): string;
export declare function validateOnboardingRequest(request: OnboardingRequest): OnboardingValidationResult;
export declare function runOnboardingRequest(request: OnboardingRequest): Promise<OnboardingResult>;
//# sourceMappingURL=engine.d.ts.map