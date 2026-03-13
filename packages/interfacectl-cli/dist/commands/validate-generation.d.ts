export interface ValidateGenerationCommandOptions {
    tool?: string;
    surfaceId?: string;
    mode?: string;
    bundleRoot?: string;
    workspaceRoot?: string;
    descriptorPath?: string;
    outPath?: string;
    requestId?: string;
    descriptorParityConfigPath?: string;
}
export declare function runValidateGenerationCommand(options: ValidateGenerationCommandOptions): Promise<number>;
//# sourceMappingURL=validate-generation.d.ts.map