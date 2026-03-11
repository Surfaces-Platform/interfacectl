import { type SurfaceTokenDescriptor, type TokenCategory } from "@surfaces/interfacectl-validator";
export interface TokenDefinition {
    name: string;
    rawValue: string;
    source: string;
}
export interface RawObservedToken {
    observedValue: string;
    source: string;
    attributes: Set<string>;
}
export interface TokenNormalizationWarning {
    code: string;
    message: string;
    location?: string;
}
export interface TokenNormalizationResult {
    tokens: SurfaceTokenDescriptor[];
    warnings: TokenNormalizationWarning[];
}
export declare function collectTokenDefinitionsFromContent(content: string, source: string, definitions: Map<string, TokenDefinition>): void;
export declare function normalizeObservedTokens(category: TokenCategory, observedTokens: Map<string, RawObservedToken>, definitions: Map<string, TokenDefinition>): TokenNormalizationResult;
//# sourceMappingURL=token-normalization.d.ts.map