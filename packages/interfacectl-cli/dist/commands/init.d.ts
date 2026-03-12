import { type InteractiveInitOptions } from "../utils/init-interactive.js";
export interface InitOptions extends InteractiveInitOptions {
    nonInteractive?: boolean;
    verbose?: boolean;
    continueOnGate?: boolean;
    outDir?: string;
    analysisOut?: string;
    draftOut?: string;
    contractOut?: string;
    reportOut?: string;
}
export declare function runInitCommand(options: InitOptions): Promise<number>;
//# sourceMappingURL=init.d.ts.map