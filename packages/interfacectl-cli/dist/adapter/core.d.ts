import { type JsonRecord } from "./bundle.js";
export { AdapterInputError, isAdapterInputError } from "./bundle.js";
type FindingSeverity = "error" | "warning";
type FindingPolicy = "strict" | "warn" | "off";
type AdapterMode = "workspace" | "descriptor";
export interface AdapterFinding {
    code: string;
    severity: FindingSeverity;
    policy: FindingPolicy;
    message: string;
    location: {
        file: string;
        line: number;
    };
    evidence: Record<string, unknown>;
}
export interface GenerationAdapterRequest {
    requestId?: string;
    tool?: string;
    surfaceId?: string;
    mode?: string;
    bundleRoot?: string;
    workspaceRoot?: string;
    descriptor?: JsonRecord[];
    provenance?: {
        sessionId?: string;
        userId?: string;
        timestamp?: string;
    };
    contractPath?: string;
}
export interface GenerationAdapterResponse {
    requestId: string;
    status: "pass" | "warn" | "block";
    surfaceId: string;
    bundle: {
        root: string;
        version: string;
        manifestPath: string;
        surfacePath: string;
    };
    contract: {
        id: string;
        version: string;
    };
    coverage: {
        generationGuard: boolean;
        fullValidate: boolean;
        shellBoundaryEvaluated: boolean;
        colorPolicyEvaluated: boolean;
        iconPolicyEvaluated: boolean;
    };
    findings: AdapterFinding[];
    timings: {
        totalMs: number;
    };
    provenance: {
        sessionId?: string;
        userId?: string;
        timestamp: string;
        evaluatedAt: string;
    };
}
export interface RunGenerationAdapterOptions {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    nodeBin?: string;
    generationGuardPath?: string;
    descriptorParityConfigPath?: string;
    descriptorParitySurfaces?: string[];
    defaultBundleRoot?: string;
}
export declare function buildCoverage(mode: AdapterMode, detail?: Partial<GenerationAdapterResponse["coverage"]>): GenerationAdapterResponse["coverage"];
export declare function computeStatusFromFindings(findings: AdapterFinding[]): "pass" | "warn" | "block";
export declare function runGenerationAdapter(requestInput: GenerationAdapterRequest, options?: RunGenerationAdapterOptions): Promise<GenerationAdapterResponse>;
//# sourceMappingURL=core.d.ts.map