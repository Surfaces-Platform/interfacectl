import type { InterfaceContract } from "@surfaces/interfacectl-validator";
export interface ChromePolicySeedingInput {
    workspaceRoot: string;
    appRoot: string;
    surfaceId: string;
    contract: InterfaceContract;
}
export interface ChromePolicySeedResult {
    contract: InterfaceContract;
    warnings: Array<{
        code: string;
        message: string;
    }>;
}
export declare function seedChromePolicyFromObservedDescriptors(input: ChromePolicySeedingInput): Promise<ChromePolicySeedResult>;
//# sourceMappingURL=chrome-policy-seeding.d.ts.map