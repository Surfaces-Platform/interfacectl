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
export type { InterfaceContract, ContractSurface, ContractSection, ContractConstraints, SurfaceDescriptor, SurfaceSectionDescriptor, SurfaceFontDescriptor, SurfaceColorDescriptor, SurfaceIconDescriptor, SurfaceMotionDescriptor, SurfaceLayoutDescriptor, PageFrameLayoutDescriptor, SurfacePrimitiveDescriptor, SurfaceReport, DriftViolation, ValidationSummary, DriftViolationType, ContractRef, RuleRef, DiffOutput, DiffEntry, DiffChangeType, DriftRisk, Severity, SafetyLevel, EnforcementPolicy, EnforcementMode, IconPolicy, FlowPolicy, FlowRequirement, FlowTransitionRequirement, SurfaceFlowDescriptor, SurfaceFlowStepDescriptor, SurfaceFlowTransitionDescriptor, AutofixRule, FixSummary, FixEntry, FixError, } from "./types.js";
export { getBundledDiffSchema, getBundledPolicySchema, getBundledFixSummarySchema, validateDiffOutput, validatePolicy, validateFixSummary, type ValidationResult, } from "./schema-validate.js";
export { normalizeColorValue, normalizeColorValues, } from "./color-policy.js";
//# sourceMappingURL=index.d.ts.map