import type { InterfaceContract } from "@surfaces/interfacectl-validator";
export interface ColorPolicySeedingInput {
    workspaceRoot: string;
    appRoot: string;
    surfaceId: string;
    contract: InterfaceContract;
}
export interface ColorPolicySeedingResult {
    contract: InterfaceContract;
    warnings: Array<{
        code: string;
        message: string;
    }>;
}
export declare function seedColorPolicyFromObservedDescriptors(input: ColorPolicySeedingInput): Promise<ColorPolicySeedingResult>;
//# sourceMappingURL=color-policy-seeding.d.ts.map