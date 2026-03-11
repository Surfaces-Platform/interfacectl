import {
  normalizeTokenLiteralValue,
  type SurfaceTokenDescriptor,
  type TokenCategory,
} from "@surfaces/interfacectl-validator";

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

const TOKEN_DEFINITION_REGEX = /(^|[;{\s])(--[a-z0-9-]+)\s*:\s*([^;{}]+);/gim;
const TOKEN_REFERENCE_REGEX = /^var\((--[a-z0-9-]+)\)$/i;

interface TokenResolution {
  canonicalToken?: string;
  normalizedValue?: string;
  aliasChainDepth: number;
  unresolvedReason?: string;
  location?: string;
}

function normalizeExpression(input: string): string {
  return input.trim().replace(/\s+/g, " ");
}

function parseTokenReference(input: string): string | null {
  const match = normalizeExpression(input).match(TOKEN_REFERENCE_REGEX);
  return match?.[1] ?? null;
}

export function collectTokenDefinitionsFromContent(
  content: string,
  source: string,
  definitions: Map<string, TokenDefinition>,
): void {
  TOKEN_DEFINITION_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN_DEFINITION_REGEX.exec(content)) !== null) {
    const name = match[2]?.trim();
    const rawValue = match[3]?.trim();
    if (!name || !rawValue || definitions.has(name)) {
      continue;
    }
    definitions.set(name, { name, rawValue, source });
  }
}

function resolveTokenDefinition(
  tokenName: string,
  category: TokenCategory,
  definitions: Map<string, TokenDefinition>,
  trail: Set<string> = new Set(),
): TokenResolution {
  if (trail.has(tokenName)) {
    return {
      canonicalToken: `var(${tokenName})`,
      aliasChainDepth: trail.size,
      unresolvedReason: "cyclic token alias definition",
    };
  }

  const definition = definitions.get(tokenName);
  if (!definition) {
    return {
      canonicalToken: `var(${tokenName})`,
      aliasChainDepth: trail.size,
      unresolvedReason: "missing custom property definition",
    };
  }

  const aliasTarget = parseTokenReference(definition.rawValue);
  if (aliasTarget) {
    const nextTrail = new Set(trail);
    nextTrail.add(tokenName);
    const resolved = resolveTokenDefinition(
      aliasTarget,
      category,
      definitions,
      nextTrail,
    );
    return {
      canonicalToken: resolved.canonicalToken ?? `var(${aliasTarget})`,
      normalizedValue: resolved.normalizedValue,
      aliasChainDepth: resolved.aliasChainDepth + 1,
      unresolvedReason: resolved.unresolvedReason,
      location: resolved.location ?? definition.source,
    };
  }

  const normalizedValue = normalizeTokenLiteralValue(category, definition.rawValue);
  if (!normalizedValue) {
    return {
      canonicalToken: `var(${tokenName})`,
      aliasChainDepth: trail.size,
      unresolvedReason: "unsupported token literal for deterministic normalization",
      location: definition.source,
    };
  }

  return {
    canonicalToken: `var(${tokenName})`,
    normalizedValue,
    aliasChainDepth: trail.size,
    location: definition.source,
  };
}

export function normalizeObservedTokens(
  category: TokenCategory,
  observedTokens: Map<string, RawObservedToken>,
  definitions: Map<string, TokenDefinition>,
): TokenNormalizationResult {
  const warnings: TokenNormalizationWarning[] = [];
  const resolved = [...observedTokens.values()].map((token) => {
    const tokenName = parseTokenReference(token.observedValue);
    if (!tokenName) {
      return {
        ...token,
        value: token.observedValue,
        normalizedValue: undefined,
        aliasChainDepth: Number.MAX_SAFE_INTEGER,
      };
    }

    const resolution = resolveTokenDefinition(tokenName, category, definitions);
    if (!resolution.normalizedValue) {
      warnings.push({
        code: "token.normalization-skipped",
        message:
          `Could not normalize ${category} token "${token.observedValue}" because ${resolution.unresolvedReason}.`,
        location: resolution.location ?? token.source,
      });
      return {
        ...token,
        value: resolution.canonicalToken ?? token.observedValue,
        normalizedValue: undefined,
        aliasChainDepth: Number.MAX_SAFE_INTEGER,
      };
    }

    return {
      ...token,
      value: resolution.canonicalToken ?? token.observedValue,
      normalizedValue: resolution.normalizedValue,
      aliasChainDepth: resolution.aliasChainDepth,
    };
  });

  const canonicalByGroup = new Map<string, string>();
  for (const token of resolved) {
    if (!token.normalizedValue) {
      continue;
    }
    const current = canonicalByGroup.get(token.normalizedValue);
    if (!current) {
      canonicalByGroup.set(token.normalizedValue, token.value);
      continue;
    }

    const currentResolved = resolved.find((entry) => entry.value === current);
    if (!currentResolved) {
      canonicalByGroup.set(token.normalizedValue, token.value);
      continue;
    }

    const candidateWins =
      token.aliasChainDepth < currentResolved.aliasChainDepth ||
      (
        token.aliasChainDepth === currentResolved.aliasChainDepth &&
        token.value.localeCompare(currentResolved.value) < 0
      );
    if (candidateWins) {
      canonicalByGroup.set(token.normalizedValue, token.value);
    }
  }

  const tokens: SurfaceTokenDescriptor[] = resolved
    .map((token) => {
      const canonicalValue =
        token.normalizedValue
          ? canonicalByGroup.get(token.normalizedValue) ?? token.observedValue
          : token.observedValue;

      return {
        value: canonicalValue,
        observedValue: token.observedValue,
        source: token.source,
        attributes: [...token.attributes].sort((a, b) => a.localeCompare(b)),
        normalizedValue: token.normalizedValue,
      };
    })
    .sort((a, b) => {
      const left = a.observedValue ?? a.value;
      const right = b.observedValue ?? b.value;
      return left.localeCompare(right);
    });

  return { tokens, warnings };
}
