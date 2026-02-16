import path from "node:path";
import { extractRoutes } from "./routes.js";
import { detectHasShell } from "./shell.js";
import { extractDesignSystemComponents } from "./design-system.js";
import { detectAuthAware } from "./auth.js";
import type {
  ExtractedContractFields,
  ExtractionReport,
  ExtractionWarning,
  ExtractContractFromNextAppOptions,
  ExtractContractResult,
} from "./types.js";

const PLACEHOLDER_SECTION_ID = "extracted.placeholder";

export async function extractContractFromNextApp(
  options: ExtractContractFromNextAppOptions,
): Promise<ExtractContractResult> {
  const { appRoot, surfaceId } = options;
  const resolvedRoot = path.resolve(appRoot);
  const warnings: ExtractionWarning[] = [];
  const appDir = path.join(resolvedRoot, "app");

  let routes: string[] = [];
  let hasShell = false;
  let designSystemComponents: string[] = [];
  let authAware = false;

  try {
    routes = await extractRoutes(appDir);
  } catch (err) {
    warnings.push({
      code: "routes.extract-failed",
      message: `Could not extract routes: ${(err as Error).message}`,
    });
  }

  try {
    hasShell = await detectHasShell(resolvedRoot);
  } catch (err) {
    warnings.push({
      code: "shell.detect-failed",
      message: `Could not detect layout shell: ${(err as Error).message}`,
    });
  }

  try {
    designSystemComponents = await extractDesignSystemComponents(resolvedRoot);
  } catch (err) {
    warnings.push({
      code: "designSystem.extract-failed",
      message: `Could not extract @surfaces/ui usage: ${(err as Error).message}`,
    });
  }

  try {
    authAware = await detectAuthAware(resolvedRoot);
  } catch {
    // no auth dir is not an error
  }

  const extracted: ExtractedContractFields = {
    routes: [...routes].sort(),
    hasShell,
    designSystemComponents: [...designSystemComponents].sort(),
    authAware,
  };

  warnings.push({
    code: "requiredSections.omitted",
    message:
      "requiredSections cannot be extracted from code in Phase 0; using placeholder.",
  });
  warnings.push({
    code: "allowedFonts.default",
    message: "allowedFonts cannot be extracted from code in Phase 0; using default.",
  });
  warnings.push({
    code: "layout.default",
    message: "layout.maxContentWidth cannot be extracted from code in Phase 0; using default.",
  });

  const report: ExtractionReport = {
    surfaceId,
    appRoot: resolvedRoot,
    warnings,
    extracted,
  };

  const contract = buildContract(surfaceId, extracted);
  return { contract, report };
}

function buildContract(
  surfaceId: string,
  extracted: ExtractedContractFields,
): Record<string, unknown> {
  const displayName =
    surfaceId === "surfaces-web"
      ? "Surfaces Web"
      : surfaceId.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  return {
    $schema:
      "https://contracts.surfaces.local/web.surface.contract.schema.json",
    contractId: `${surfaceId}.generated`,
    version: "0.1.0",
    description: "Extracted from Next.js app (Phase 0).",
    surfaces: [
      {
        id: surfaceId,
        displayName,
        type: "web",
        requiredSections: [PLACEHOLDER_SECTION_ID],
        allowedFonts: ["sans-serif"],
        layout: { maxContentWidth: 1120 },
      },
    ],
    sections: [
      {
        id: PLACEHOLDER_SECTION_ID,
        intent: "extracted",
        description: "Placeholder; sections not extracted in Phase 0.",
      },
    ],
    constraints: {
      motion: {
        allowedDurationsMs: [120],
        allowedTimingFunctions: ["linear"],
      },
    },
    color: {
      sourceOfTruth: {
        type: "none",
      },
      rawValues: {
        policy: "off",
        allowlist: [],
        denylist: [],
      },
    },
    x_extracted: {
      routes: extracted.routes,
      hasShell: extracted.hasShell,
      designSystemComponents: extracted.designSystemComponents,
      authAware: extracted.authAware,
    },
  };
}
