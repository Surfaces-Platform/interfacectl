import type { InterfaceContract } from "@surfaces/interfacectl-validator";
export interface ObservedUiSeedingInput {
    workspaceRoot: string;
    appRoot: string;
    surfaceId: string;
    contract: InterfaceContract;
}
export interface ObservedUiSeedingResult {
    contract: InterfaceContract;
    warnings: Array<{
        code: string;
        message: string;
    }>;
    resolvedPlaceholderWarnings: string[];
}
export declare function seedObservedUiContract(input: ObservedUiSeedingInput): Promise<ObservedUiSeedingResult>;
//# sourceMappingURL=observed-ui-seeding.d.ts.map