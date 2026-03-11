import readline from "node:readline/promises";
import { stdin as input, stderr as promptOutput } from "node:process";
import { chromium, type BrowserContextOptions } from "playwright";

export interface RemoteBrowserObservation {
  finalUrl: string;
  html: string;
  cssContents: Array<{ source: string; content: string }>;
  loginDetected: boolean;
  accessDeniedDetected: boolean;
}

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

function detectAuthGate(html: string, finalUrl: string): {
  loginDetected: boolean;
  accessDeniedDetected: boolean;
} {
  const url = new URL(finalUrl);
  const lowerHtml = html.toLowerCase();
  const loginDetected =
    /(login|signin|sign-in|auth|session)/i.test(url.pathname) ||
    /<input[^>]+type=["']password["']/i.test(html) ||
    /<form[\s\S]*?(sign in|log in|login)/i.test(html) ||
    /\b(sign in|log in|login to continue|enter your password|forgot password)\b/i.test(lowerHtml);
  const accessDeniedDetected =
    /\b(access denied|forbidden|not authorized|unauthorized|permission denied|403)\b/i.test(lowerHtml);
  return { loginDetected, accessDeniedDetected };
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
    await page.goto(options.url, { waitUntil: "load" });
    await waitForPageSettle(page);

    const html = await page.content();
    const finalUrl = page.url();
    const finalOrigin = new URL(finalUrl).origin;
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
    const authGate = detectAuthGate(html, finalUrl);

    return {
      finalUrl,
      html,
      cssContents,
      loginDetected: authGate.loginDetected,
      accessDeniedDetected: authGate.accessDeniedDetected,
    };
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}
