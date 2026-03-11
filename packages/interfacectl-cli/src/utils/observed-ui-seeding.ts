import type {
  InterfaceContract,
  SurfaceTokenDescriptor,
  TokenCategory,
  TokenMetadata,
  TokenPolicy,
} from "@surfaces/interfacectl-validator";
import { collectSurfaceDescriptors } from "../descriptors/static-analysis.js";

export interface ObservedUiSeedingInput {
  workspaceRoot: string;
  appRoot: string;
  surfaceId: string;
  contract: InterfaceContract;
}

export interface ObservedUiSeedingResult {
  contract: InterfaceContract;
  warnings: Array<{ code: string; message: string }>;
  resolvedPlaceholderWarnings: string[];
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b),
  );
}

function uniqueSortedNumbers(values: number[]): number[] {
  return [...new Set(values.filter((value) => Number.isFinite(value)))].sort(
    (a, b) => a - b,
  );
}

function buildTokenPolicy(
  existingPolicy: TokenPolicy | undefined,
  tokens: SurfaceTokenDescriptor[],
  category: TokenCategory,
  warnings: Array<{ code: string; message: string }>,
): TokenPolicy {
  if (tokens.length === 0) {
    return {
      policy: existingPolicy?.policy ?? "warn",
      allowedTokens: existingPolicy?.allowedTokens ?? [],
      tokenMetadata: existingPolicy?.tokenMetadata,
    };
  }

  const metadata = new Map<string, { normalizedValue: string; attributes: Set<string>; aliases: Set<string> }>();
  let unresolvedCount = 0;

  for (const token of tokens) {
    const canonicalToken = token.value.trim();
    const observedToken = (token.observedValue ?? token.value).trim();
    if (!canonicalToken) {
      continue;
    }
    if (!token.normalizedValue) {
      unresolvedCount += 1;
    }

    if (!metadata.has(canonicalToken)) {
      metadata.set(canonicalToken, {
        normalizedValue: token.normalizedValue ?? observedToken,
        attributes: new Set(token.attributes ?? []),
        aliases: new Set(),
      });
    }

    const entry = metadata.get(canonicalToken);
    if (!entry) continue;
    for (const attribute of token.attributes ?? []) {
      entry.attributes.add(attribute);
    }
    if (observedToken && observedToken !== canonicalToken) {
      entry.aliases.add(observedToken);
    }
    if (!entry.normalizedValue && token.normalizedValue) {
      entry.normalizedValue = token.normalizedValue;
    }
  }

  if (unresolvedCount > 0) {
    warnings.push({
      code: `ui-seed.${category}.normalization-skipped`,
      message:
        `${category} token normalization was skipped for ${unresolvedCount} observed token` +
        `${unresolvedCount === 1 ? "" : "s"} because deterministic token definitions were unavailable.`,
    });
  }

  const tokenMetadata: TokenMetadata[] = [...metadata.entries()]
    .map(([token, entry]) => ({
      token,
      normalizedValue: entry.normalizedValue,
      attributes: [...entry.attributes].sort((a, b) => a.localeCompare(b)),
      aliases: [...entry.aliases].sort((a, b) => a.localeCompare(b)),
    }))
    .sort((a, b) => a.token.localeCompare(b.token));

  return {
    policy: existingPolicy?.policy ?? "warn",
    allowedTokens: tokenMetadata.map((entry) => entry.token),
    tokenMetadata,
  };
}

export async function seedObservedUiContract(
  input: ObservedUiSeedingInput,
): Promise<ObservedUiSeedingResult> {
  const warnings: Array<{ code: string; message: string }> = [];
  const resolvedPlaceholderWarnings: string[] = [];
  const surfaceRootMap = new Map<string, string>([[input.surfaceId, input.appRoot]]);

  const descriptorResult = await collectSurfaceDescriptors({
    workspaceRoot: input.workspaceRoot,
    contract: input.contract,
    surfaceFilters: new Set([input.surfaceId]),
    surfaceRootMap,
  });

  for (const warning of descriptorResult.warnings) {
    warnings.push({
      code: `ui-seed.${warning.code}`,
      message: `Descriptor warning during UI seed: ${warning.message}`,
    });
  }
  for (const error of descriptorResult.errors) {
    warnings.push({
      code: `ui-seed.${error.code}`,
      message: `Descriptor error during UI seed: ${error.message}`,
    });
  }

  const descriptor = descriptorResult.descriptors.find(
    (entry) => entry.surfaceId === input.surfaceId,
  );
  const currentSurface = input.contract.surfaces.find(
    (surface) => surface.id === input.surfaceId,
  );

  if (!descriptor || !currentSurface) {
    return {
      contract: input.contract,
      warnings,
      resolvedPlaceholderWarnings,
    };
  }

  const discoveredFonts = uniqueSorted(descriptor.fonts.map((font) => font.value));
  const discoveredDurations = uniqueSortedNumbers(
    descriptor.motion.map((motion) => motion.durationMs),
  );
  const discoveredTimingFunctions = uniqueSorted(
    descriptor.motion.map((motion) => motion.timingFunction),
  );
  const discoveredTypographyTokens = descriptor.tokenUsage?.typography ?? [];
  const discoveredLayoutTokens = descriptor.tokenUsage?.layout ?? [];
  const discoveredMotionTokens = descriptor.tokenUsage?.motion ?? [];

  if (discoveredFonts.length > 0) {
    resolvedPlaceholderWarnings.push("allowedFonts.default");
  } else {
    warnings.push({
      code: "ui-seed.fonts.none-detected",
      message:
        "allowedFonts was not seeded from descriptors because no fonts were detected.",
    });
  }

  if (descriptor.layout.maxContentWidth !== undefined && descriptor.layout.maxContentWidth !== null) {
    resolvedPlaceholderWarnings.push("layout.default");
  } else {
    warnings.push({
      code: "ui-seed.layout.none-detected",
      message:
        "layout.maxContentWidth was not seeded from descriptors because no deterministic width was detected.",
    });
  }

  if (discoveredDurations.length === 0 || discoveredTimingFunctions.length === 0) {
    warnings.push({
      code: "ui-seed.motion.none-detected",
      message:
        "Motion constraints were not fully seeded from descriptors because no motion declarations were detected.",
    });
  }

  const discoveredMarketingLayoutProfile =
    descriptor.layout.landingPattern?.marketingLayoutProfile;
  const discoveredMarketingTypographyProfile =
    descriptor.marketingTypography?.profileId;

  const contract: InterfaceContract = {
    ...input.contract,
    surfaces: input.contract.surfaces.map((surface) => {
      if (surface.id !== input.surfaceId) {
        return surface;
      }
      const seededLandingPattern =
        surface.layout.landingPattern ?? discoveredMarketingLayoutProfile
          ? {
              policy: surface.layout.landingPattern?.policy ?? "warn",
              ...surface.layout.landingPattern,
              marketingLayoutProfile:
                discoveredMarketingLayoutProfile ??
                surface.layout.landingPattern?.marketingLayoutProfile,
            }
          : undefined;
      return {
        ...surface,
        marketingTypographyProfile:
          discoveredMarketingTypographyProfile ??
          surface.marketingTypographyProfile,
        allowedFonts:
          discoveredFonts.length > 0 ? discoveredFonts : surface.allowedFonts,
        layout: {
          ...surface.layout,
          maxContentWidth:
            descriptor.layout.maxContentWidth ?? surface.layout.maxContentWidth,
          landingPattern: seededLandingPattern,
        },
      };
    }),
    constraints: {
      ...input.contract.constraints,
      motion: {
        ...input.contract.constraints.motion,
        allowedDurationsMs:
          discoveredDurations.length > 0
            ? discoveredDurations
            : input.contract.constraints.motion.allowedDurationsMs,
        allowedTimingFunctions:
          discoveredTimingFunctions.length > 0
            ? discoveredTimingFunctions
            : input.contract.constraints.motion.allowedTimingFunctions,
      },
    },
    tokens: {
      typography: {
        ...buildTokenPolicy(
          input.contract.tokens?.typography,
          discoveredTypographyTokens,
          "typography",
          warnings,
        ),
      },
      layout: {
        ...buildTokenPolicy(
          input.contract.tokens?.layout,
          discoveredLayoutTokens,
          "layout",
          warnings,
        ),
      },
      motion: {
        ...buildTokenPolicy(
          input.contract.tokens?.motion,
          discoveredMotionTokens,
          "motion",
          warnings,
        ),
      },
    },
  };

  return {
    contract,
    warnings,
    resolvedPlaceholderWarnings,
  };
}
