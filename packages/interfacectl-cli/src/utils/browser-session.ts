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

export interface RemoteInteractiveTargetObservation {
  id: string;
  role: string;
  selector?: string;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  hitAreaPx: number;
  nearestNeighborGapPx: number | null;
  nearestNeighborClassification?: "default" | "primary" | "destructive";
  edgeInsetPx: number;
  classification: "default" | "primary" | "destructive";
}

export type RemoteInteractiveTargetCollectionSource =
  | "contract-scoped"
  | "all-visible-fallback"
  | "none-observed";

export interface RemoteInteractiveTargetCollectionObservation {
  source: RemoteInteractiveTargetCollectionSource;
  allVisibleCount: number;
  contractScopedCount: number;
}

export interface RemoteAsyncStateObservation {
  id: string;
  kind: "loading" | "empty" | "partial" | "error" | "success";
  sectionIds: string[];
  recoveryActions: Array<
    "retry" | "refresh" | "dismiss" | "contact-support" | "navigate-home" | "go-back"
  >;
  preserveLastGoodContent: boolean;
  blockedActions: Array<{
    interactionId: string;
    disabled: boolean;
  }>;
}

export interface RemoteFlowStepObservation {
  id: string;
  terminal?: boolean;
}

export interface RemoteFlowTransitionObservation {
  from: string;
  to: string;
}

export interface RemoteFlowObservation {
  flowId: string;
  steps: RemoteFlowStepObservation[];
  transitions: RemoteFlowTransitionObservation[];
}

export type RemoteFlowCollectionSource =
  | "contract-scoped"
  | "none-observed";

export interface RemoteFlowCollectionObservation {
  source: RemoteFlowCollectionSource;
  observedFlowCount: number;
}

export type RemoteAsyncStateCollectionSource =
  | "contract-scoped"
  | "none-observed";

export interface RemoteAsyncStateCollectionObservation {
  source: RemoteAsyncStateCollectionSource;
  observedStateCount: number;
}

export interface RemoteRenderedStyleObservation {
  fonts: string[];
  colors: string[];
  maxWidths: number[];
  radii: number[];
  shadowKinds: Array<"outer" | "inset" | "mixed">;
  motions: RemoteRenderedMotionObservation[];
  containers: string[];
  interactiveTargets: RemoteInteractiveTargetObservation[];
  interactiveTargetCollection: RemoteInteractiveTargetCollectionObservation;
  flows: RemoteFlowObservation[];
  flowCollection: RemoteFlowCollectionObservation;
  asyncStates: RemoteAsyncStateObservation[];
  asyncStateCollection: RemoteAsyncStateCollectionObservation;
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
            interactiveTargets: [],
            interactiveTargetCollection: {
              source: "none-observed" as const,
              allVisibleCount: 0,
              contractScopedCount: 0,
            },
            flows: [],
            flowCollection: {
              source: "none-observed" as const,
              observedFlowCount: 0,
            },
            asyncStates: [],
            asyncStateCollection: {
              source: "none-observed" as const,
              observedStateCount: 0,
            },
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
      const allInteractiveNodes = Array.from(
        doc.querySelectorAll("a, button, summary, [role='button']"),
      ).filter((node) => isVisible(node));
      const contractScopedInteractiveNodes = allInteractiveNodes.filter((node: any) => {
        const dataset = node?.dataset ?? {};
        return Boolean(
          String(dataset.contractTarget ?? "").trim() ||
          String(dataset.contractInteraction ?? "").trim(),
        );
      });
      const interactiveTargetCollection =
        contractScopedInteractiveNodes.length > 0
          ? {
              source: "contract-scoped" as const,
              allVisibleCount: allInteractiveNodes.length,
              contractScopedCount: contractScopedInteractiveNodes.length,
            }
          : allInteractiveNodes.length > 0
            ? {
                source: "all-visible-fallback" as const,
                allVisibleCount: allInteractiveNodes.length,
                contractScopedCount: 0,
              }
            : {
                source: "none-observed" as const,
                allVisibleCount: 0,
                contractScopedCount: 0,
              };
      const interactiveNodes = interactiveTargetCollection.source === "contract-scoped"
        ? contractScopedInteractiveNodes
        : allInteractiveNodes;
      const isAsyncStateKind = (
        value: string,
      ): value is "loading" | "empty" | "partial" | "error" | "success" =>
        value === "loading" ||
        value === "empty" ||
        value === "partial" ||
        value === "error" ||
        value === "success";
      const isRecoveryActionKind = (
        value: string,
      ): value is "retry" | "refresh" | "dismiss" | "contact-support" | "navigate-home" | "go-back" =>
        value === "retry" ||
        value === "refresh" ||
        value === "dismiss" ||
        value === "contact-support" ||
        value === "navigate-home" ||
        value === "go-back";
      const stateNodes = Array.from(
        doc.querySelectorAll("[data-contract-state-kind]"),
      ).filter((node) => isVisible(node));
      const flowNodes = Array.from(
        doc.querySelectorAll("[data-contract-flow-id]"),
      ).filter((node) => isVisible(node));
      const flowCollection =
        flowNodes.length > 0
          ? {
              source: "contract-scoped" as const,
              observedFlowCount: flowNodes.length,
            }
          : {
              source: "none-observed" as const,
              observedFlowCount: 0,
            };
      const asyncStateCollection =
        stateNodes.length > 0
          ? {
              source: "contract-scoped" as const,
              observedStateCount: stateNodes.length,
            }
          : {
              source: "none-observed" as const,
              observedStateCount: 0,
            };
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

      const classifyTarget = (node: any): "default" | "primary" | "destructive" => {
        const dataset = node?.dataset ?? {};
        const raw =
          String(dataset.contractActionRisk ?? dataset.contractActionKind ?? "").toLowerCase() ||
          (String(node?.getAttribute?.("type") ?? "").toLowerCase() === "submit" ? "primary" : "");
        if (raw === "destructive" || raw === "danger") {
          return "destructive";
        }
        if (raw === "primary" || raw === "cta") {
          return "primary";
        }
        return "default";
      };
      const viewportWidth = typeof globalThis.innerWidth === "number" ? globalThis.innerWidth : 0;
      const viewportHeight = typeof globalThis.innerHeight === "number" ? globalThis.innerHeight : 0;
      const interactiveTargets = (interactiveNodes as any[]).map((node, index, list) => {
        const rect = node.getBoundingClientRect();
        const classification = classifyTarget(node);
        let nearestNeighborGapPx: number | null = null;
        let nearestNeighborClassification: "default" | "primary" | "destructive" | undefined;

        for (const other of list) {
          if (other === node) continue;
          const otherRect = other.getBoundingClientRect();
          const dx = Math.max(0, otherRect.left - rect.right, rect.left - otherRect.right);
          const dy = Math.max(0, otherRect.top - rect.bottom, rect.top - otherRect.bottom);
          const gap = dx === 0 ? dy : dy === 0 ? dx : Math.hypot(dx, dy);
          if (nearestNeighborGapPx === null || gap < nearestNeighborGapPx) {
            nearestNeighborGapPx = gap;
            nearestNeighborClassification = classifyTarget(other);
          }
        }

        const edgeInsetPx = Math.min(
          rect.left,
          viewportWidth - rect.right,
          rect.top,
          viewportHeight - rect.bottom,
        );
        const dataset = node?.dataset ?? {};

        return {
          id:
            String(dataset.contractTarget ?? dataset.contractInteraction ?? "").trim() ||
            `${String(node?.tagName ?? "target").toLowerCase()}-${index + 1}`,
          role:
            String(node?.tagName ?? "target").toLowerCase() === "a"
              ? "link"
              : String(node?.tagName ?? "target").toLowerCase(),
          selector:
            typeof dataset.contractInteraction === "string"
              ? `[data-contract-interaction="${dataset.contractInteraction}"]`
              : typeof dataset.contractTarget === "string"
                ? `[data-contract-target="${dataset.contractTarget}"]`
                : undefined,
          boundingBox: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          },
          hitAreaPx: rect.width * rect.height,
          nearestNeighborGapPx,
          nearestNeighborClassification,
          edgeInsetPx,
          classification,
        };
      });
      const asyncStates = (stateNodes as any[]).flatMap((node, index) => {
        const dataset = node?.dataset ?? {};
        const stateId =
          String(dataset.contractStateId ?? "").trim() ||
          String(dataset.contractStateKind ?? "").trim() ||
          `state-${index + 1}`;
        const stateKind = String(dataset.contractStateKind ?? "").trim().toLowerCase();
        if (!isAsyncStateKind(stateKind)) {
          return [];
        }
        const selector = `[data-contract-state-id="${stateId}"]`;
        const sectionIds = Array.from(
          doc.querySelectorAll(`${selector}[data-contract-section]`),
        )
          .filter((candidate) => isVisible(candidate))
          .map((candidate: any) => String(candidate?.dataset?.contractSection ?? "").trim())
          .filter(Boolean);
        const recoveryActions = Array.from(
          doc.querySelectorAll(`${selector}[data-contract-recovery-action]`),
        )
          .filter((candidate) => isVisible(candidate))
          .map((candidate: any) =>
            String(candidate?.dataset?.contractRecoveryAction ?? "").trim().toLowerCase(),
          )
          .filter(isRecoveryActionKind);
        const preserveLastGoodContent = Array.from(
          doc.querySelectorAll(`${selector}[data-contract-preserve-last-good="true"]`),
        ).some((candidate) => isVisible(candidate));
        const blockedActions = Array.from(
          doc.querySelectorAll(`${selector}[data-contract-interaction]`),
        )
          .filter((candidate) => isVisible(candidate))
          .map((candidate: any) => {
            const interactionId = String(candidate?.dataset?.contractInteraction ?? "").trim();
            return {
              interactionId,
              disabled:
                Boolean(candidate?.disabled) ||
                String(candidate?.getAttribute?.("aria-disabled") ?? "").toLowerCase() === "true",
            };
          })
          .filter((candidate) => candidate.interactionId.length > 0);

        return [{
          id: stateId,
          kind: stateKind,
          sectionIds: [...new Set(sectionIds)].sort((a, b) => a.localeCompare(b)),
          recoveryActions: [...new Set(recoveryActions)].sort((a, b) => a.localeCompare(b)),
          preserveLastGoodContent,
          blockedActions,
        }];
      });
      const flows = (flowNodes as any[]).flatMap((flowNode, index) => {
        const flowId = String(flowNode?.dataset?.contractFlowId ?? "").trim() || `flow-${index + 1}`;
        const stepMap = new Map<string, { id: string; terminal?: boolean }>();
        const transitionMap = new Map<string, { from: string; to: string }>();
        const stepNodes = Array.from(
          flowNode.querySelectorAll("[data-contract-flow-step]"),
        ).filter((candidate) =>
          isVisible(candidate) &&
          (candidate as any).closest?.("[data-contract-flow-id]") === flowNode,
        );

        for (const stepNode of stepNodes as any[]) {
          const stepId = String(stepNode?.dataset?.contractFlowStep ?? "").trim();
          if (!stepId) {
            continue;
          }
          stepMap.set(stepId, {
            id: stepId,
            ...(String(stepNode?.getAttribute?.("data-contract-flow-terminal") ?? "").toLowerCase() === "true"
              ? { terminal: true }
              : {}),
          });

          const transitionNodes = Array.from(
            stepNode.querySelectorAll("[data-contract-flow-transition-to]"),
          ).filter((candidate) =>
            isVisible(candidate) &&
            (candidate as any).closest?.("[data-contract-flow-step]") === stepNode,
          );

          for (const transitionNode of transitionNodes as any[]) {
            const transitionTo = String(
              transitionNode?.dataset?.contractFlowTransitionTo ?? "",
            ).trim();
            if (!transitionTo) {
              continue;
            }
            transitionMap.set(`${stepId}->${transitionTo}`, {
              from: stepId,
              to: transitionTo,
            });
          }
        }

        return [{
          flowId,
          steps: [...stepMap.values()].sort((a, b) => a.id.localeCompare(b.id)),
          transitions: [...transitionMap.values()].sort((a, b) =>
            a.from.localeCompare(b.from) || a.to.localeCompare(b.to),
          ),
        }];
      });

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
          interactiveTargets,
          interactiveTargetCollection,
          flows,
          flowCollection,
          asyncStates,
          asyncStateCollection,
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
