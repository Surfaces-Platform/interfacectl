import { type AnalysisSourceMode, type WebSurfaceKind } from "../utils/first-run-analysis.js";
type ExtractMode = AnalysisSourceMode;
export interface InitOptions {
    url?: string;
    surface?: string;
    surfaceName?: string;
    surfaceKind?: WebSurfaceKind;
    authProfile?: string;
    extractMode?: ExtractMode;
    appRoot?: string;
    nonInteractive?: boolean;
    outDir?: string;
    analysisOut?: string;
    draftOut?: string;
    contractOut?: string;
    reportOut?: string;
}
export declare function runInitCommand(options: InitOptions): Promise<number>;
export {};
//# sourceMappingURL=init.d.ts.map