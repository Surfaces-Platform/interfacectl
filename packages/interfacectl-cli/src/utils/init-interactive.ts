import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type {
  AnalysisSourceMode,
  SurfaceAnalysisArtifact,
  WebSurfaceKind,
} from "./first-run-analysis.js";
import {
  normalizeRemoteUrlInput,
  suggestSurfaceIdFromPath,
  suggestSurfaceIdFromUrl,
  suggestSurfaceName,
} from "./onboarding.js";

export type ExtractMode = AnalysisSourceMode;

export interface InteractiveInitOptions {
  url?: string;
  surface?: string;
  surfaceName?: string;
  surfaceKind?: WebSurfaceKind;
  authProfile?: string;
  extractMode?: ExtractMode;
  appRoot?: string;
}

export interface ResolvedInitInputs {
  sourceMode: ExtractMode;
  url?: string;
  appRoot?: string;
  surfaceId: string;
  surfaceName: string;
  surfaceKind?: WebSurfaceKind;
  requiresAuth: boolean;
  authProfileName: string | null;
}

export type GateResolutionAction =
  | "capture-auth"
  | "continue-anyway"
  | "switch-local-root"
  | "quit";

const VALID_SURFACE_KINDS = new Set<WebSurfaceKind>(["marketing", "application", "unknown"]);

export function normalizeSurfaceId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function inferSourceMode(
  options: Pick<InteractiveInitOptions, "extractMode" | "appRoot" | "url">,
): ExtractMode {
  if (options.extractMode === "local-root" || options.extractMode === "remote-url") {
    return options.extractMode;
  }
  if (options.appRoot && !options.url) {
    return "local-root";
  }
  if (options.appRoot) {
    return "local-root";
  }
  return "remote-url";
}

export async function promptInteractiveInitInputs(
  options: InteractiveInitOptions,
): Promise<ResolvedInitInputs> {
  const rl = readline.createInterface({ input, output });
  try {
    const inferredMode = inferSourceMode(options);
    const rawMode = (
      (
        options.extractMode ??
        (
          await rl.question(
            `Source mode (local-root/remote-url) [${inferredMode}]: `,
          )
        ).trim()
      ) ||
      inferredMode
    ).toLowerCase();
    const sourceMode: ExtractMode = rawMode === "remote-url" ? "remote-url" : "local-root";

    const url = sourceMode === "remote-url"
      ? normalizeRemoteUrlInput(options.url ?? (await rl.question("Surface URL: ")).trim())
      : options.url?.trim() || undefined;
    const appRoot = sourceMode === "local-root"
      ? (options.appRoot ?? (await rl.question("Local app root: "))).trim()
      : undefined;

    const suggestedSurfaceId = options.surface ?? (
      sourceMode === "remote-url" && url
        ? suggestSurfaceIdFromUrl(url)
        : suggestSurfaceIdFromPath(appRoot ?? "surface")
    );
    const rawSurfaceId = (await rl.question(`Surface id [${suggestedSurfaceId}]: `)).trim();
    const surfaceId = normalizeSurfaceId(rawSurfaceId || suggestedSurfaceId);
    const suggestedSurfaceName = options.surfaceName ?? suggestSurfaceName(surfaceId);
    const rawSurfaceName = (await rl.question(`Surface name [${suggestedSurfaceName}]: `)).trim();
    const surfaceName = rawSurfaceName || suggestedSurfaceName;
    const requiresAuth = sourceMode === "remote-url"
      ? ["y", "yes"].includes(
          (
            await rl.question(
              "Do you need to sign in to see the real page? (y/N) ",
            )
          ).trim().toLowerCase(),
        )
      : false;
    const authProfileName = requiresAuth
      ? (
          await rl.question(
            `Auth profile name [${options.authProfile ?? `${new URL(url!).hostname}-default`}]: `,
          )
        ).trim() || options.authProfile || `${new URL(url!).hostname}-default`
      : null;

    return {
      sourceMode,
      url,
      appRoot: appRoot && appRoot.length > 0 ? appRoot : undefined,
      surfaceId,
      surfaceName,
      surfaceKind: options.surfaceKind,
      requiresAuth,
      authProfileName,
    };
  } finally {
    rl.close();
  }
}

export async function promptSurfaceKindConfirmation(
  analysis: SurfaceAnalysisArtifact,
): Promise<WebSurfaceKind> {
  const rl = readline.createInterface({ input, output });
  try {
    console.log(
      `Surface kind needs confirmation. interfacectl inferred "${analysis.classification.inferredKind}" (${analysis.classification.confidence.toFixed(2)} confidence).`,
    );
    for (const evidence of analysis.classification.supporting.slice(0, 3)) {
      console.log(`  support: ${evidence.message}`);
    }
    for (const evidence of analysis.classification.opposing.slice(0, 2)) {
      console.log(`  counter: ${evidence.message}`);
    }
    while (true) {
      const answer = (
        await rl.question(
          `Confirm surface kind [${analysis.classification.inferredKind}]: `,
        )
      ).trim().toLowerCase();
      const value = (answer || analysis.classification.inferredKind) as WebSurfaceKind;
      if (VALID_SURFACE_KINDS.has(value)) {
        return value;
      }
      console.log("Expected one of: marketing, application, unknown.");
    }
  } finally {
    rl.close();
  }
}

export async function promptGateResolution(
  analysis: SurfaceAnalysisArtifact,
): Promise<GateResolutionAction> {
  const rl = readline.createInterface({ input, output });
  try {
    const statusMessage =
      analysis.sourceHealth.status === "access-denied"
        ? "We reached an access-denied page instead of the target surface."
        : analysis.sourceHealth.status === "login"
          ? "We reached a login page instead of the target surface."
          : "We reached a limited source instead of the target surface.";
    console.log(statusMessage);
    if (analysis.sourceHealth.finalUrl) {
      console.log(`Current URL: ${analysis.sourceHealth.finalUrl}`);
    }
    console.log("Choose how to continue:");
    console.log("  [1] Capture auth and retry");
    console.log("  [2] Continue anyway with provisional results");
    console.log("  [3] Switch to local app root");
    console.log("  [q] Quit");
    while (true) {
      const answer = (await rl.question("> ")).trim().toLowerCase();
      if (answer === "1") {
        return "capture-auth";
      }
      if (answer === "2") {
        return "continue-anyway";
      }
      if (answer === "3") {
        return "switch-local-root";
      }
      if (answer === "q") {
        return "quit";
      }
      console.log("Expected 1, 2, 3, or q.");
    }
  } finally {
    rl.close();
  }
}

export async function promptWriteConfirmation(): Promise<boolean> {
  const rl = readline.createInterface({ input, output });
  try {
    while (true) {
      const answer = (await rl.question("Create these draft artifacts now? ([Y]es/[q]uit) ")).trim().toLowerCase();
      if (!answer || answer === "y" || answer === "yes") {
        return true;
      }
      if (answer === "q" || answer === "n" || answer === "no") {
        return false;
      }
      console.log("Expected yes, no, or q.");
    }
  } finally {
    rl.close();
  }
}
