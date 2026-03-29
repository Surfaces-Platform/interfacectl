import type { InterfaceContract } from "./types.js";
import type { UiAstActionIntent, UiAstPlatform, UiSurfaceAst } from "./ui-ast.js";
export type UiAstChangeAction = "set" | "add";
export type UiAstDiffKind = "added" | "removed" | "modified";
export interface UiAstChange {
    path: string;
    action: UiAstChangeAction;
    value: string | number;
    summary: string;
}
export interface UiAstDiffEntry {
    path: string;
    kind: UiAstDiffKind;
    before?: unknown;
    after?: unknown;
}
export interface UiAstSurfaceSummary {
    surfaceId: string;
    displayName: string;
    platforms: UiAstPlatform[];
    nodeCount: number;
    nodeKinds: Record<string, number>;
    sectionIds: string[];
    actionIntents: UiAstActionIntent[];
    stateIds: string[];
    owner: string | null;
    governanceStatus: string | null;
    runtimePolicy: string | null;
    maxContentWidthByPlatform: Partial<Record<UiAstPlatform, number>>;
}
export interface UiAstSummary {
    astId: string;
    version: string;
    surfaceCount: number;
    platformCount: number;
    nodeCount: number;
    migrationEscalationCount: number;
    surfaces: UiAstSurfaceSummary[];
}
export declare function migrateLegacyContractToUiAst(contract: InterfaceContract): UiSurfaceAst;
export declare function deriveLegacyContractFromUiAst(ast: UiSurfaceAst): InterfaceContract;
export declare function normalizeUiAst(ast: UiSurfaceAst): UiSurfaceAst;
export declare function summarizeUiAst(ast: UiSurfaceAst): UiAstSummary;
export declare function diffUiAst(before: UiSurfaceAst, after: UiSurfaceAst): UiAstDiffEntry[];
export declare function applyUiAstChange(ast: UiSurfaceAst, change: UiAstChange): UiSurfaceAst;
//# sourceMappingURL=ui-ast-authoring.d.ts.map