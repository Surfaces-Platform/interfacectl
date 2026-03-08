import type { InterfaceContract } from "@surfaces/interfacectl-validator";
export interface ChromePolicySeedResult {
    contract: InterfaceContract;
    warnings: Array<{
        code: string;
        message: string;
    }>;
}
export declare function seedChromePolicyDefaults({ contract, }: {
    contract: InterfaceContract;
}): Promise<ChromePolicySeedResult>;
//# sourceMappingURL=chrome-policy-seeding.d.ts.map