export interface CompileCommandOptions {
    astPath?: string;
    contractPath?: string;
    outDir: string;
    schemaPath?: string;
    format?: "json";
}
export declare function runCompileCommand(options: CompileCommandOptions, toolVersion: string): Promise<number>;
//# sourceMappingURL=compile.d.ts.map