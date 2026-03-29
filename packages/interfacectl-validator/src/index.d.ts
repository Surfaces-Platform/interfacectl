import { InterfaceContract, SurfaceDescriptor, SurfaceReport, ValidationSummary } from "./types.js";
export declare function getBundledContractSchema(): object;
export interface ContractStructureValidation {
    ok: boolean;
    errors: string[];
    contract?: InterfaceContract;
}
export declare function validateContractStructure(contractData: unknown, schema: object): ContractStructureValidation;
export declare function evaluateSurfaceCompliance(contract: InterfaceContract, descriptor: SurfaceDescriptor): SurfaceReport;
export declare function evaluateContractCompliance(contract: InterfaceContract, descriptors: SurfaceDescriptor[]): ValidationSummary;
export type { InterfaceContract, ContractSurface, ContractSection, ContractConstraints, SurfaceDescriptor, SurfaceSectionDescriptor, SurfaceFontDescriptor, SurfaceMotionDescriptor, SurfaceLayoutDescriptor, SurfaceReport, DriftViolation, ValidationSummary, DriftViolationType, } from "./types.js";
export { getBundledUiAstSchema, validateUiAstStructure, type UiAstStructureValidation, type UiAstActionIntent, type UiAstAlertSeverity, type UiAstFieldType, type UiAstMigrationEscalation, type UiAstMigrationMetadata, type UiAstNode, type UiAstNodeKind, type UiAstPlatform, type UiAstPlatformProjection, type UiAstSelectionMode, type UiAstStateRef, type UiAstSurface, type UiAstSurfaceKind, type UiAstTextRole, type UiSurfaceAst } from "./ui-ast.js";
//# sourceMappingURL=index.d.ts.map
