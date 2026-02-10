import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { extractContractFromNextApp, stableStringify } from "@surfaces/interfacectl-extractor";
import { getBundledContractSchema, validateContractStructure } from "@surfaces/interfacectl-validator";
import {
  findAuthProfile,
  getAuthStorageMode,
  isProfileExpired,
  saveBrowserSessionProfile,
} from "../utils/auth-profiles.js";
import { redactSensitiveText, redactSensitiveUrl } from "../utils/redaction.js";
import {
  buildBootstrapContract,
  emitBootstrapRunArtifact,
  suggestSurfaceIdFromUrl,
  suggestSurfaceName,
  type BootstrapExtractionReport,
  writeBootstrapArtifacts,
} from "../utils/onboarding.js";

type ExtractMode = "remote-url" | "local-root";

export interface InitOptions {
  url?: string;
  surface?: string;
  surfaceName?: string;
  authProfile?: string;
  extractMode?: ExtractMode;
  appRoot?: string;
  nonInteractive?: boolean;
  outDir?: string;
}

function normalizeSurfaceId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function browserOpenCommand(url: string): { cmd: string; args: string[] } {
  if (process.platform === "darwin") {
    return { cmd: "open", args: [url] };
  }
  if (process.platform === "win32") {
    return { cmd: "cmd", args: ["/c", "start", "", url] };
  }
  return { cmd: "xdg-open", args: [url] };
}

async function maybeCaptureAuthProfile(inputValue: {
  requiresAuth: boolean;
  profileName: string | null;
  url: string;
}): Promise<{ profileName?: string; authMode: "none" | "browser-session" }> {
  if (!inputValue.requiresAuth) {
    return { authMode: "none" };
  }

  const parsed = new URL(inputValue.url);
  const profileName = inputValue.profileName ?? `${parsed.hostname}-default`;
  const existing = await findAuthProfile(profileName, parsed.hostname);
  if (existing && !isProfileExpired(existing)) {
    return { authMode: "browser-session", profileName: existing.name };
  }

  const openTarget = browserOpenCommand(inputValue.url);
  const child = spawn(openTarget.cmd, openTarget.args, {
    stdio: "ignore",
    detached: true,
  });
  child.unref();

  const rl = readline.createInterface({ input, output });
  try {
    await rl.question(
      `Opened browser for ${parsed.hostname}. Complete login, then press Enter to continue.`,
    );
  } finally {
    rl.close();
  }

  const profile = await saveBrowserSessionProfile({
    name: profileName,
    domain: parsed.hostname,
  });
  return { authMode: "browser-session", profileName: profile.name };
}

async function promptInteractive(options: InitOptions): Promise<{
  url: string;
  extractMode: ExtractMode;
  appRoot?: string;
  surfaceId: string;
  surfaceName: string;
  requiresAuth: boolean;
  authProfileName: string | null;
}> {
  const rl = readline.createInterface({ input, output });
  try {
    const url = options.url ?? (await rl.question("What is the first surface URL? ")).trim();
    const parsed = new URL(url);
    const requiresAuthAnswer = (
      await rl.question("Is this surface behind login? (y/N) ")
    ).trim().toLowerCase();
    const requiresAuth = requiresAuthAnswer === "y" || requiresAuthAnswer === "yes";
    const extractModeInput = (
      options.extractMode ??
      (
        (await rl.question("Extraction mode (remote-url/local-root) [remote-url]: ")).trim() ||
        "remote-url"
      )
    ).toLowerCase();
    const extractMode: ExtractMode =
      extractModeInput === "local-root" ? "local-root" : "remote-url";
    const suggestedSurface = options.surface ?? suggestSurfaceIdFromUrl(parsed.toString());
    const providedSurface = (
      await rl.question(`Surface id [${suggestedSurface}]: `)
    ).trim();
    const surfaceId = normalizeSurfaceId(providedSurface || suggestedSurface);
    const suggestedName = options.surfaceName ?? suggestSurfaceName(surfaceId);
    const providedName = (await rl.question(`Surface name [${suggestedName}]: `)).trim();
    const surfaceName = providedName || suggestedName;
    const authProfileName = requiresAuth
      ? (
          await rl.question(
            `Auth profile name [${options.authProfile ?? `${parsed.hostname}-default`}]: `,
          )
        ).trim() || options.authProfile || `${parsed.hostname}-default`
      : null;
    const appRoot = extractMode === "local-root"
      ? (
          options.appRoot ??
          (await rl.question("Local app root (directory containing app/): "))
        ).trim()
      : undefined;

    return {
      url: parsed.toString(),
      extractMode,
      appRoot: appRoot && appRoot.length > 0 ? appRoot : undefined,
      surfaceId,
      surfaceName,
      requiresAuth,
      authProfileName,
    };
  } finally {
    rl.close();
  }
}

async function resolveInputs(options: InitOptions): Promise<{
  url: string;
  extractMode: ExtractMode;
  appRoot?: string;
  surfaceId: string;
  surfaceName: string;
  requiresAuth: boolean;
  authProfileName: string | null;
}> {
  if (!options.nonInteractive) {
    return promptInteractive(options);
  }
  if (!options.url) {
    throw new Error("Missing required --url in --non-interactive mode.");
  }
  const parsed = new URL(options.url);
  const extractMode = options.extractMode ?? "remote-url";
  const surfaceId = normalizeSurfaceId(options.surface ?? suggestSurfaceIdFromUrl(parsed.toString()));
  const surfaceName = options.surfaceName ?? suggestSurfaceName(surfaceId);
  const requiresAuth = Boolean(options.authProfile);

  if (extractMode === "local-root" && !options.appRoot) {
    throw new Error("Missing required --app-root for --extract-mode local-root.");
  }

  return {
    url: parsed.toString(),
    extractMode,
    appRoot: options.appRoot,
    surfaceId,
    surfaceName,
    requiresAuth,
    authProfileName: options.authProfile ?? null,
  };
}

async function writeJson(pathname: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(pathname), { recursive: true });
  await writeFile(pathname, `${stableStringify(value)}\n`, "utf-8");
}

export async function runInitCommand(options: InitOptions): Promise<number> {
  try {
    const rootDir = process.cwd();
    const resolved = await resolveInputs(options);
    const authCapture = await maybeCaptureAuthProfile({
      requiresAuth: resolved.requiresAuth,
      profileName: resolved.authProfileName,
      url: resolved.url,
    });
    const startTime = new Date().toISOString();

    if (resolved.extractMode === "local-root") {
      const appRoot = path.resolve(rootDir, resolved.appRoot ?? ".");
      if (!existsSync(path.join(appRoot, "app"))) {
        console.error(`Local app root is missing app/: ${appRoot}`);
        return 1;
      }
      const outDir = options.outDir
        ? path.resolve(rootDir, options.outDir)
        : path.resolve(rootDir, "contracts", "generated");
      const contractPath = path.join(outDir, `${resolved.surfaceId}.contract.json`);
      const reportPath = path.join(outDir, `${resolved.surfaceId}.extraction.json`);

      const { contract, report } = await extractContractFromNextApp({
        appRoot,
        surfaceId: resolved.surfaceId,
      });
      const structure = validateContractStructure(contract as unknown, getBundledContractSchema() as object);
      if (!structure.ok) {
        console.error("Generated contract failed schema validation:");
        for (const issue of structure.errors) {
          console.error(`  ${issue}`);
        }
        return 1;
      }

      const reportWithOnboarding = {
        ...report,
        onboarding: {
          sourceUrl: redactSensitiveUrl(resolved.url),
          authMode: authCapture.authMode,
          extractMode: resolved.extractMode,
          profileName: authCapture.profileName,
          profileDomain: new URL(resolved.url).hostname,
          startedAt: startTime,
          completedAt: new Date().toISOString(),
          detection: {
            adapter: "next-app-static-extractor",
            framework: "nextjs",
            profile: "codebase",
          },
        },
      };
      await writeJson(contractPath, contract);
      await writeJson(reportPath, reportWithOnboarding);

      const status = report.warnings.length > 0 ? "warn" : "pass";
      const findingCodes = report.warnings.map((warning) => `extract.${warning.code}`);
      const run = await emitBootstrapRunArtifact({
        rootDir,
        surfaceId: resolved.surfaceId,
        status,
        findingCodes,
        extractionPath: contractPath,
        reportPath,
      });

      console.log(`Onboarding completed for ${resolved.surfaceId}.`);
      console.log(`Wrote contract: ${contractPath}`);
      console.log(`Wrote report:   ${reportPath}`);
      console.log(`Run id: ${run.runId}`);
      console.log(`Auth storage: ${storageMode}`);
      if (storageMode === "file") {
        console.log("Warning: keychain unavailable; using local file storage for opaque session references.");
      }
      console.log(`Next: interfacectl validate --root . --surface ${resolved.surfaceId}`);
      return 0;
    }

    const url = new URL(resolved.url);
    const authAware = authCapture.authMode === "browser-session";
    const bootstrapContract = buildBootstrapContract({
      surfaceId: resolved.surfaceId,
      surfaceName: resolved.surfaceName,
      sourceUrl: redactSensitiveUrl(url.toString()),
      authAware,
    });
    const warnings = [
      {
        code: "remote-url.bootstrap-only",
        message:
          "Remote URL mode creates bootstrap extraction metadata only. Use local-root mode for full static extraction.",
      },
    ];
    const report: BootstrapExtractionReport = {
      surfaceId: resolved.surfaceId,
      appRoot: url.origin,
      warnings,
      extracted: {
        routes: [url.pathname || "/"],
        hasShell: false,
        designSystemComponents: [],
        authAware,
      },
      onboarding: {
        sourceUrl: redactSensitiveUrl(url.toString()),
        authMode: authCapture.authMode,
        extractMode: "remote-url",
        profileName: authCapture.profileName,
        profileDomain: url.hostname,
        startedAt: startTime,
        completedAt: new Date().toISOString(),
        detection: {
          adapter: "remote-url-bootstrap",
          framework: "unknown",
          profile: "bootstrap",
        },
      },
    };
    const written = await writeBootstrapArtifacts({
      rootDir,
      outDir: options.outDir,
      surfaceId: resolved.surfaceId,
      contract: bootstrapContract,
      report,
    });
    const run = await emitBootstrapRunArtifact({
      rootDir,
      surfaceId: resolved.surfaceId,
      status: "warn",
      findingCodes: ["extract.remote-url.bootstrap-only"],
      extractionPath: written.contractPath,
      reportPath: written.reportPath,
    });

    console.log(`Onboarding completed for ${resolved.surfaceId}.`);
    console.log(`Wrote contract: ${written.contractPath}`);
    console.log(`Wrote report:   ${written.reportPath}`);
    if (authCapture.profileName) {
      console.log(`Auth profile: ${authCapture.profileName}`);
    }
    console.log(`Run id: ${run.runId}`);
    console.log(`Auth storage: ${storageMode}`);
    if (storageMode === "file") {
      console.log("Warning: keychain unavailable; using local file storage for opaque session references.");
    }
    console.log(`Next: interfacectl validate --root . --surface ${resolved.surfaceId}`);
    return 0;
  } catch (error) {
    console.error(redactSensitiveText((error as Error).message));
    return 1;
  }
}
    const storageMode = getAuthStorageMode();
