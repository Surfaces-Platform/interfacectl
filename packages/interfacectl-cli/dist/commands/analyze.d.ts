import { type AnalysisSourceMode, type WebSurfaceKind } from "../utils/first-run-analysis.js";
type ExtractMode = AnalysisSourceMode;
export interface AnalyzeCommandOptions {
    url?: string;
    appRoot?: string;
    extractMode?: ExtractMode;
    surface?: string;
    surfaceName?: string;
    surfaceKind?: WebSurfaceKind;
    authProfile?: string;
    out?: string;
    outDir?: string;
}
export declare function runAnalyzeCommand(options: AnalyzeCommandOptions): Promise<number>;
export {};
//# sourceMappingURL=analyze.d.ts.map