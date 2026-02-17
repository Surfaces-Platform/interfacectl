export interface MigrateColorPolicyCommandOptions {
    contractPath: string;
    outPath?: string;
    includeObserved?: boolean;
    root?: string;
    appRoot?: string;
    surfaceId?: string;
}
export declare function runMigrateColorPolicyCommand(options: MigrateColorPolicyCommandOptions): Promise<number>;
//# sourceMappingURL=migrate-color-policy.d.ts.map