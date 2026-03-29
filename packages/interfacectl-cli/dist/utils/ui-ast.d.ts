import { type InterfaceContract, type UiSurfaceAst } from "@surfaces/interfacectl-validator";
export declare const DEFAULT_AST_PATH = "contracts/ui.surface.ast.json";
export declare const DEFAULT_LEGACY_CONTRACT_PATH = "contracts/surfaces.web.contract.json";
export interface ResolvedUiAstInput {
    ast: UiSurfaceAst;
    derivedContract: InterfaceContract;
    sourceKind: "ast" | "legacy-contract";
    sourcePath: string;
    warnings: string[];
}
export interface ResolvedUiAstInputError {
    error: string;
    code: string;
}
interface ResolveUiAstInputOptions {
    workspaceRoot: string;
    astPath?: string;
    contractPath?: string;
    schemaPath?: string;
}
export declare function resolveUiAstInput(options: ResolveUiAstInputOptions): Promise<ResolvedUiAstInput | ResolvedUiAstInputError>;
export {};
//# sourceMappingURL=ui-ast.d.ts.map