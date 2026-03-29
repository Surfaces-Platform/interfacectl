import { type ExitCodeVersion } from "../utils/exit-codes.js";
type OutputFormat = "text" | "json";
export interface DiffCommandOptions {
    astPath?: string;
    contractPath?: string;
    schemaPath?: string;
    workspaceRoot?: string;
    surfaceFilters?: string[];
    outputFormat?: OutputFormat;
    outputPath?: string;
    configPath?: string;
    configProvided?: boolean;
    normalize?: boolean;
    renameThreshold?: number;
    policyPath?: string;
    exitCodes?: ExitCodeVersion;
}
export declare function runDiffCommand(options: DiffCommandOptions): Promise<number>;
export {};
//# sourceMappingURL=diff.d.ts.map