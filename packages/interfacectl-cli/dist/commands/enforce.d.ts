import { EnforcementMode } from "@surfaces/interfacectl-validator";
import { type ExitCodeVersion } from "../utils/exit-codes.js";
type OutputFormat = "text" | "json";
export interface EnforceCommandOptions {
    mode?: EnforcementMode;
    strict?: boolean;
    policyPath?: string;
    astPath?: string;
    contractPath?: string;
    workspaceRoot?: string;
    surfaceFilters?: string[];
    outputFormat?: OutputFormat;
    outputPath?: string;
    configPath?: string;
    configProvided?: boolean;
    dryRun?: boolean;
    exitCodes?: ExitCodeVersion;
}
export declare function runEnforceCommand(options: EnforceCommandOptions): Promise<number>;
export {};
//# sourceMappingURL=enforce.d.ts.map