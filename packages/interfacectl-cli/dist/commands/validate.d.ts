import { type SurfaceDescriptor } from "@surfaces/interfacectl-validator";
import { type ExitCodeVersion } from "../utils/exit-codes.js";
type OutputFormat = "text" | "json";
export interface ValidateCommandOptions {
    contractPath?: string;
    schemaPath?: string;
    workspaceRoot?: string;
    surfaceFilters?: string[];
    descriptorOverrides?: SurfaceDescriptor[];
    outputFormat?: OutputFormat;
    outputPath?: string;
    configPath?: string;
    configProvided?: boolean;
    exitCodes?: ExitCodeVersion;
}
export declare function runValidateCommand(options: ValidateCommandOptions): Promise<number>;
export {};
//# sourceMappingURL=validate.d.ts.map