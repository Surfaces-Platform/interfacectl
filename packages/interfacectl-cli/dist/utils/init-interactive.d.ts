import type { AnalysisSourceMode, SurfaceAnalysisArtifact, WebSurfaceKind } from "./first-run-analysis.js";
export type ExtractMode = AnalysisSourceMode;
export interface InteractiveInitOptions {
    url?: string;
    surface?: string;
    surfaceName?: string;
    surfaceKind?: WebSurfaceKind;
    authProfile?: string;
    extractMode?: ExtractMode;
    appRoot?: string;
}
export interface ResolvedInitInputs {
    sourceMode: ExtractMode;
    url?: string;
    appRoot?: string;
    surfaceId: string;
    surfaceName: string;
    surfaceKind?: WebSurfaceKind;
    requiresAuth: boolean;
    authProfileName: string | null;
}
export type GateResolutionAction = "capture-auth" | "continue-anyway" | "switch-local-root" | "quit";
export declare function normalizeSurfaceId(raw: string): string;
export declare function inferSourceMode(options: Pick<InteractiveInitOptions, "extractMode" | "appRoot" | "url">): ExtractMode;
export declare function promptInteractiveInitInputs(options: InteractiveInitOptions): Promise<ResolvedInitInputs>;
export declare function promptSurfaceKindConfirmation(analysis: SurfaceAnalysisArtifact): Promise<WebSurfaceKind>;
export declare function promptGateResolution(analysis: SurfaceAnalysisArtifact): Promise<GateResolutionAction>;
export declare function promptWriteConfirmation(): Promise<boolean>;
//# sourceMappingURL=init-interactive.d.ts.map