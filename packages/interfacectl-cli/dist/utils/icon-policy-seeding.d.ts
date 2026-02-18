import type { InterfaceContract } from "@surfaces/interfacectl-validator";
export interface IconPolicySeedingInput {
    workspaceRoot: string;
    appRoot: string;
    surfaceId: string;
    contract: InterfaceContract;
}
export interface IconPolicySeedingResult {
    contract: InterfaceContract;
    warnings: Array<{
        code: string;
        message: string;
    }>;
}
export declare function seedIconPolicyFromObservedDescriptors(input: IconPolicySeedingInput): Promise<IconPolicySeedingResult>;
//# sourceMappingURL=icon-policy-seeding.d.ts.map