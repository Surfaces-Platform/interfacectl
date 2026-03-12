import readline from "node:readline/promises";
import { stdin as input, stderr as promptOutput } from "node:process";
import { chromium, type BrowserContextOptions } from "playwright";

export type SourceHealthStatus = "ok" | "login" | "access-denied";
export type SourceHealthConfidence = "full" | "limited";

export interface RemoteSourceHealth {
  status: SourceHealthStatus;
  confidence: SourceHealthConfidence;
  finalUrl: string;
  documentStatus: number | null;
  authMode: "none" | "browser-session";
}

export interface RemoteRenderedMotionObservation {
  durationMs: number;
  timingFunction: string;
}

export interface RemoteRenderedStyleObservation {
  fonts: string[];
  colors: string[];
  maxWidths: number[];
  radii: number[];
  shadowKinds: Array<"outer" | "inset" | "mixed">;
  motions: RemoteRenderedMotionObservation[];
  containers: string[];
}

interface RemoteRenderedGateObservation {
  bodyText: string;
  mainText: string;
  headingText: string;
  formTexts: string[];
  hasPasswordField: boolean;
}

export interface RemoteBrowserObservation {
  finalUrl: string;
  html: string;
  cssContents: Array<{ source: string; content: string }>;
  loginDetected: boolean;
  accessDeniedDetected: boolean;
  sourceHealth: RemoteSourceHealth;
  renderedStyles: RemoteRenderedStyleObservation;
}

const LOGIN_PATH_PATTERN = /(?:^|\/)(login|log-in|signin|sign-in)(?:\/|$)/i;
const LOGIN_TEXT_PATTERN =
  /\b(sign in|sign-in|log in|log-in|login to continue|forgot password|enter your password|continue with (google|github|microsoft|okta)|welcome back)\b/i;
const ACCESS_DENIED_TEXT_PATTERN =
  /\b(access denied|permission denied|not authorized|not authorised|you do not have access|you don't have access|request access|403 forbidden|access forbidden)\b/i;
const STANDALONE_ACCESS_DENIED_HEADING_PATTERN = /^(unauthorized|forbidden|access denied|permission denied)$/i;

function isEnvTrue(name: string): boolean {
  return process.env[name] === "1" || process.env[name] === "true";
}

function toLaunchError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (/Executable doesn't exist|browserType\.launch/i.test(message)) {
    return new Error(
      `Playwright Chromium is not installed. Run "pnpm exec playwright install chromium" in /Users/mike/SurfacesPlatform/interfacectl.`,
    );
  }
  return error instanceof Error ? error : new Error(message);
}

async function waitForPageSettle(page: { waitForLoadState: Function; waitForTimeout: Function }): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => undefined);
  await page.waitForTimeout(300);
}

function detectAuthGate(input: {
  finalUrl: string;
  renderedGateObservation: RemoteRenderedGateObservation;
}): {
  loginDetected: boolean;
  accessDeniedDetected: boolean;
} {
  const url = new URL(input.finalUrl);
  const urlLooksLikeLogin = LOGIN_PATH_PATTERN.test(url.pathname);
  const mainText = input.renderedGateObservation.mainText.trim();
  const bodyText = input.renderedGateObservation.bodyText.trim();
  const headingText = input.renderedGateObservation.headingText.trim();
  const loginHeadingDetected = LOGIN_TEXT_PATTERN.test(headingText);
  const loginMainDetected = LOGIN_TEXT_PATTERN.test(mainText);
  const loginBodyDetected = mainText.length === 0 && LOGIN_TEXT_PATTERN.test(bodyText);
  const hasLoginForm = input.renderedGateObservation.formTexts.some((text) => LOGIN_TEXT_PATTERN.test(text));

  const deniedHeadingDetected =
    ACCESS_DENIED_TEXT_PATTERN.test(headingText) ||
    STANDALONE_ACCESS_DENIED_HEADING_PATTERN.test(headingText);
  const deniedMainDetected = ACCESS_DENIED_TEXT_PATTERN.test(mainText);
  const deniedBodyDetected = mainText.length === 0 && ACCESS_DENIED_TEXT_PATTERN.test(bodyText);

  const loginDetected =
    input.renderedGateObservation.hasPasswordField ||
    hasLoginForm ||
    loginHeadingDetected ||
    ((loginMainDetected || loginBodyDetected) && urlLooksLikeLogin);
  const accessDeniedDetected = deniedHeadingDetected || deniedMainDetected || deniedBodyDetected;
  return { loginDetected, accessDeniedDetected };
}

function classifySourceHealth(input: {
  finalUrl: string;
  documentStatus: number | null;
  authMode: "none" | "browser-session";
  renderedGateObservation: RemoteRenderedGateObservation;
}): RemoteSourceHealth & {
  loginDetected: boolean;
  accessDeniedDetected: boolean;
} {
  const authGate = detectAuthGate({
    finalUrl: input.finalUrl,
    renderedGateObservation: input.renderedGateObservation,
  });
  const status: SourceHealthStatus =
    authGate.accessDeniedDetected || input.documentStatus === 401 || input.documentStatus === 403
      ? "access-denied"
      : authGate.loginDetected
        ? "login"
        : "ok";

  return {
    status,
    confidence: status === "ok" ? "full" : "limited",
    finalUrl: input.finalUrl,
    documentStatus: input.documentStatus,
    authMode: input.authMode,
    loginDetected: authGate.loginDetected,
    accessDeniedDetected: authGate.accessDeniedDetected || input.documentStatus === 401 || input.documentStatus === 403,
  };
}

export async function captureBrowserStorageState(options: {
  url: string;
}): Promise<{
  finalUrl: string;
  storageState: string;
}> {
  const headless = isEnvTrue("INTERFACECTL_PLAYWRIGHT_HEADLESS");
  const browser = await chromium.launch({ headless }).catch((error) => {
    throw toLaunchError(error);
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(options.url, { waitUntil: "load" });
    await waitForPageSettle(page);

    const rl = readline.createInterface({ input, output: promptOutput });
    try {
      await rl.question(
        `Browser session is open at ${new URL(options.url).hostname}. Complete login, then press Enter to capture the session.`,
      );
    } finally {
      rl.close();
    }

    await waitForPageSettle(page);
    const finalUrl = page.url();
    const storageState = JSON.stringify(await context.storageState());
    return {
      finalUrl,
      storageState,
    };
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

export async function observeRemotePage(options: {
  url: string;
  storageState?: string;
}): Promise<RemoteBrowserObservation> {
  const browser = await chromium.launch({ headless: true }).catch((error) => {
    throw toLaunchError(error);
  });
  const storageState = options.storageState
    ? (JSON.parse(options.storageState) as NonNullable<BrowserContextOptions["storageState"]>)
    : undefined;
  const context = options.storageState
    ? await browser.newContext({ storageState })
    : await browser.newContext();
  const page = await context.newPage();
  const stylesheetBodies = new Map<string, Promise<{ source: string; content: string } | null>>();

  page.on("response", (response) => {
    const responseUrl = response.url();
    const resourceType = response.request().resourceType();
    const contentType = response.headers()["content-type"] ?? "";
    const looksLikeCss =
      resourceType === "stylesheet" ||
      contentType.includes("text/css") ||
      /\.css(?:[?#].*)?$/i.test(new URL(responseUrl).pathname);
    if (!looksLikeCss || stylesheetBodies.has(responseUrl)) {
      return;
    }

    stylesheetBodies.set(
      responseUrl,
      response.text()
        .then((content) => ({ source: responseUrl, content }))
        .catch(() => null),
    );
  });

  try {
    const response = await page.goto(options.url, { waitUntil: "load" });
    await waitForPageSettle(page);

    const html = await page.content();
    const finalUrl = page.url();
    const finalOrigin = new URL(finalUrl).origin;
    const renderedObservation = await page.evaluate(() => {
      const global = globalThis as {
        document?: {
          body?: unknown;
          querySelectorAll: (selectors: string) => ArrayLike<unknown>;
        };
        window?: {
          getComputedStyle: (node: unknown) => {
            display?: string;
            visibility?: string;
            opacity?: string;
            fontFamily?: string;
            color?: string;
            backgroundColor?: string;
            maxWidth?: string;
            borderRadius?: string;
            boxShadow?: string;
            transitionDuration?: string;
            transitionTimingFunction?: string;
            animationDuration?: string;
            animationTimingFunction?: string;
          };
        };
      };
      const doc = global.document;
      const win = global.window;
      if (!doc || !win) {
        return {
          gateObservation: {
            bodyText: "",
            mainText: "",
            headingText: "",
            formTexts: [],
            hasPasswordField: false,
          },
          renderedStyles: {
            fonts: [],
            colors: [],
            maxWidths: [],
            radii: [],
            shadowKinds: [],
            motions: [],
            containers: [],
          },
        };
      }

      const normalizeText = (value: string | undefined): string =>
        String(value ?? "")
          .replace(/\s+/g, " ")
          .trim();
      const parsePx = (value: string | undefined): number | null => {
        if (!value || value === "none" || value === "normal") {
          return null;
        }
        const parsed = Number.parseFloat(value);
        return Number.isFinite(parsed) ? parsed : null;
      };
      const splitList = (value: string | undefined): string[] =>
        String(value ?? "")
          .split(",")
          .map((entry) => entry.trim())
          .filter(Boolean);
      const getVisibleText = (node: any): string => normalizeText(String(node?.innerText ?? node?.textContent ?? ""));
      const isVisible = (node: any): boolean => {
        const style = win.getComputedStyle(node);
        const rect = typeof node.getBoundingClientRect === "function"
          ? node.getBoundingClientRect()
          : { width: 0, height: 0 };
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number.parseFloat(style.opacity ?? "1") > 0 &&
          rect.width > 0 &&
          rect.height > 0
        );
      };
      const collectMotionPairs = (durationValue: string | undefined, timingValue: string | undefined) => {
        const durations = splitList(durationValue);
        const timings = splitList(timingValue);
        const pairs: Array<{ durationMs: number; timingFunction: string }> = [];
        durations.forEach((entry, index) => {
          const trimmed = entry.trim().toLowerCase();
          let durationMs: number | null = null;
          if (trimmed.endsWith("ms")) {
            durationMs = Number.parseFloat(trimmed.slice(0, -2));
          } else if (trimmed.endsWith("s")) {
            durationMs = Number.parseFloat(trimmed.slice(0, -1)) * 1000;
          } else if (/^[0-9.]+$/.test(trimmed)) {
            durationMs = Number.parseFloat(trimmed);
          }
          if (!Number.isFinite(durationMs) || durationMs === null || durationMs <= 0) {
            return;
          }
          pairs.push({
            durationMs,
            timingFunction: timings[index] ?? timings[0] ?? "linear",
          });
        });
        return pairs;
      };

      const fonts: string[] = [];
      const colors: string[] = [];
      const maxWidths: number[] = [];
      const radii: number[] = [];
      const shadowKinds: Array<"outer" | "inset" | "mixed"> = [];
      const motions: Array<{ durationMs: number; timingFunction: string }> = [];
      const containers = new Set<string>();
      const mainNodes = Array.from(doc.querySelectorAll("main, [role='main']")).filter((node) => isVisible(node));
      const headingNodes = Array.from(
        doc.querySelectorAll("main h1, main h2, [role='main'] h1, [role='main'] h2, h1, h2"),
      ).filter((node) => isVisible(node));
      const visibleForms = Array.from(doc.querySelectorAll("form")).filter((node) => isVisible(node));
      const passwordInputs = Array.from(doc.querySelectorAll("input[type='password']")).filter((node) =>
        isVisible(node),
      );
      const nodes = Array.from(
        doc.querySelectorAll(
          "body, main, header, nav, footer, aside, section, article, form, div, h1, h2, h3, h4, h5, h6, p, a, button, input, label",
        ),
      );

      for (const node of nodes as any[]) {
        if (!node || typeof node !== "object" || !isVisible(node)) {
          continue;
        }
        const style = win.getComputedStyle(node);
        const fontFamily = splitList(style.fontFamily)[0]?.replace(/^["']|["']$/g, "");
        if (fontFamily) {
          fonts.push(fontFamily);
        }

        const color = style.color?.trim();
        if (color && color !== "transparent" && color !== "rgba(0, 0, 0, 0)") {
          colors.push(color);
        }
        const backgroundColor = style.backgroundColor?.trim();
        if (
          backgroundColor &&
          backgroundColor !== "transparent" &&
          backgroundColor !== "rgba(0, 0, 0, 0)"
        ) {
          colors.push(backgroundColor);
        }

        const maxWidth = parsePx(style.maxWidth);
        if (maxWidth !== null && maxWidth > 0 && maxWidth < 5000) {
          maxWidths.push(maxWidth);
        }

        const radius = parsePx(style.borderRadius);
        if (radius !== null && radius > 0) {
          radii.push(radius);
        }

        const boxShadow = style.boxShadow?.trim().toLowerCase();
        if (boxShadow && boxShadow !== "none") {
          shadowKinds.push(boxShadow.includes("inset") ? "inset" : "outer");
        }

        motions.push(
          ...collectMotionPairs(style.transitionDuration, style.transitionTimingFunction),
          ...collectMotionPairs(style.animationDuration, style.animationTimingFunction),
        );

        const className = String((node as { className?: unknown }).className ?? "");
        if (/\bcontainer\b/i.test(className)) {
          containers.add("container");
        }
      }

      return {
        gateObservation: {
          bodyText: getVisibleText(doc.body),
          mainText: normalizeText(mainNodes.map((node) => getVisibleText(node)).join(" ")),
          headingText: normalizeText(headingNodes.map((node) => getVisibleText(node)).join(" ")),
          formTexts: visibleForms.map((node) => getVisibleText(node)).filter(Boolean),
          hasPasswordField: passwordInputs.length > 0,
        },
        renderedStyles: {
          fonts,
          colors,
          maxWidths,
          radii,
          shadowKinds,
          motions,
          containers: [...containers].sort((a, b) => a.localeCompare(b)),
        },
      };
    });
    const cssContents = (await Promise.all([...stylesheetBodies.values()]))
      .filter((entry): entry is { source: string; content: string } => entry !== null)
      .filter((entry) => {
        try {
          return new URL(entry.source).origin === finalOrigin;
        } catch {
          return false;
        }
      })
      .sort((a, b) => a.source.localeCompare(b.source));
    const sourceHealth = classifySourceHealth({
      finalUrl,
      documentStatus: response?.status() ?? null,
      authMode: options.storageState ? "browser-session" : "none",
      renderedGateObservation: renderedObservation.gateObservation,
    });

    return {
      finalUrl,
      html,
      cssContents,
      loginDetected: sourceHealth.loginDetected,
      accessDeniedDetected: sourceHealth.accessDeniedDetected,
      sourceHealth,
      renderedStyles: renderedObservation.renderedStyles,
    };
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}
