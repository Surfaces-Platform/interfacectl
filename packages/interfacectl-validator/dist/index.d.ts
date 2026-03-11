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
export type { InterfaceContract, ContractSurface, ContractSection, ContractConstraints, ContractTokenPolicies, SurfaceDescriptor, SurfaceSectionDescriptor, SurfaceFontDescriptor, SurfaceColorDescriptor, SurfaceIconDescriptor, SurfaceTokenDescriptor, SurfaceTokenUsage, SurfaceMotionDescriptor, SurfaceLayoutDescriptor, PageFrameLayoutDescriptor, ChromeLayoutDescriptor, ChromePolicyTarget, ChromeShadowKind, LandingPatternDescriptor, SurfacePrimitiveDescriptor, SurfaceReport, DriftViolation, ValidationSummary, DriftViolationType, ContractRef, RuleRef, DiffOutput, DiffEntry, DiffChangeType, DriftRisk, Severity, SafetyLevel, EnforcementPolicy, EnforcementMode, IconPolicy, TokenCategory, TokenMetadata, TokenPolicy, ContractMarketingProfiles, MarketingLayoutProfile, MarketingTypographyProfile, MarketingTypographyRoleProfile, MarketingHeroContainerMode, MarketingHeroVisualPlacement, MarketingSectionDividerMode, MarketingSectionSpacingProfile, MarketingTypographyRole, FlowPolicy, FlowRequirement, FlowTransitionRequirement, LandingPatternPolicy, SurfaceMarketingTypographyDescriptor, SurfaceMarketingTypographyRoleDescriptor, SurfaceFlowDescriptor, SurfaceFlowStepDescriptor, SurfaceFlowTransitionDescriptor, AutofixRule, FixSummary, FixEntry, FixError, } from "./types.js";
export { getBundledDiffSchema, getBundledPolicySchema, getBundledFixSummarySchema, validateDiffOutput, validatePolicy, validateFixSummary, type ValidationResult, } from "./schema-validate.js";
export { normalizeColorValue, normalizeColorValues, } from "./color-policy.js";
export { matchTokenPolicy, normalizeTokenLiteralValue, type TokenPolicyMatch, } from "./token-policy.js";
//# sourceMappingURL=index.d.ts.map