import type { SurfaceTokenDescriptor, TokenCategory, TokenPolicy } from "./types.js";
export declare function normalizeTokenLiteralValue(category: TokenCategory, input: string): string | null;
export interface TokenPolicyMatch {
    canonicalToken?: string;
    normalizedValue?: string;
    observedToken: string;
    matched: boolean;
}
export declare function matchTokenPolicy(policy: TokenPolicy | undefined, token: SurfaceTokenDescriptor): TokenPolicyMatch;
//# sourceMappingURL=token-policy.d.ts.map