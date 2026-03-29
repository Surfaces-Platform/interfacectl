export interface MigrateUiAstCommandOptions {
    contractPath?: string;
    outPath?: string;
    schemaPath?: string;
    format?: "text" | "json";
}
export declare function runMigrateUiAstCommand(options: MigrateUiAstCommandOptions): Promise<number>;
//# sourceMappingURL=migrate-ui-ast.d.ts.map