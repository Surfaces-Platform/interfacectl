import { test } from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliPath = path.resolve(__dirname, "..", "dist", "index.js");

async function run(args, options = {}) {
  const child = spawn("node", [cliPath, ...args], {
    cwd: options.cwd,
    env: { ...process.env, ...(options.env ?? {}) },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => { stdout += d.toString(); });
  child.stderr.on("data", (d) => { stderr += d.toString(); });
  const [exitCode] = await once(child, "exit");
  return { exitCode: Number(exitCode), stdout, stderr };
}

async function writeRootLayout(appDir, bodyContents) {
  await writeFile(
    path.join(appDir, "layout.tsx"),
    `import "./globals.css";
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        ${bodyContents}
        {children}
      </body>
    </html>
  );
}
`,
    "utf-8",
  );
}

async function writeGlobals(appDir, css) {
  await writeFile(path.join(appDir, "globals.css"), css, "utf-8");
}

async function createMarketingApp(rootDir) {
  const appRoot = path.join(rootDir, "apps", "marketing-site");
  const appDir = path.join(appRoot, "app");
  await mkdir(appDir, { recursive: true });

  await writeRootLayout(appDir, "<header><nav><a href=\"/pricing\">Pricing</a></nav></header>");
  await writeFile(
    path.join(appDir, "page.tsx"),
    `export default function Page() {
  return (
    <main>
      <section data-contract-section="landing.hero">
        <h1 data-contract-copy-role="heroTitle" style={{ fontFamily: "var(--font-display)" }}>
          Surface onboarding that starts with your UI.
        </h1>
        <p data-contract-copy-role="heroBody" style={{ fontSize: "var(--type-body)" }}>
          Extract the system you have and draft the one you need.
        </p>
        <a href="/start" data-contract-copy-role="primaryCta" style={{ paddingInline: "var(--space-6)" }}>
          Get started
        </a>
      </section>
      <section data-contract-section="landing.proof">
        <p>Teams use this to formalize design systems from live surfaces.</p>
      </section>
      <section data-contract-section="landing.cta">
        <a href="/contact">Book demo</a>
      </section>
    </main>
  );
}
`,
    "utf-8",
  );
  await writeGlobals(
    appDir,
    `:root {
  --font-display: "Soehne", sans-serif;
  --type-body: 1rem;
  --space-6: 24px;
  --surface-bg: #ffffff;
  --surface-text: #111111;
  --motion-standard: 180ms;
}

body {
  background: var(--surface-bg);
  color: var(--surface-text);
  transition: opacity var(--motion-standard) ease-in-out;
}

section {
  max-width: 72rem;
  border-radius: 24px;
}
`,
  );

  return appRoot;
}

async function createApplicationApp(rootDir) {
  const appRoot = path.join(rootDir, "apps", "product-app");
  const appDir = path.join(appRoot, "app");
  await mkdir(path.join(appDir, "auth", "login"), { recursive: true });
  await mkdir(path.join(appDir, "auth", "callback"), { recursive: true });
  await mkdir(path.join(appDir, "auth", "session"), { recursive: true });
  await mkdir(path.join(appDir, "auth", "logout"), { recursive: true });
  await mkdir(path.join(appDir, "dashboard"), { recursive: true });
  await mkdir(path.join(appDir, "settings"), { recursive: true });
  await mkdir(path.join(appDir, "workspace"), { recursive: true });
  await mkdir(path.join(appDir, "billing"), { recursive: true });
  await mkdir(path.join(appDir, "users"), { recursive: true });

  await writeRootLayout(
    appDir,
    `<Navigation />
      <aside>
        <a href="/dashboard">Dashboard</a>
        <a href="/settings">Settings</a>
      </aside>`,
  );
  await writeFile(
    path.join(appDir, "layout.tsx"),
    `import "./globals.css";
import Navigation from "@surfaces/ui/components/Navigation";

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body data-contract-container="primary-shell">
        <Navigation />
        <aside>
          <a href="/dashboard">Dashboard</a>
          <a href="/settings">Settings</a>
        </aside>
        {children}
      </body>
    </html>
  );
}
`,
    "utf-8",
  );
  await writeFile(
    path.join(appDir, "page.tsx"),
    `export default function Home() {
  return <main data-contract-section="app.home">Home</main>;
}
`,
    "utf-8",
  );
  const routePage = (sectionId) => `export default function Page() {
  return <main data-contract-section="${sectionId}" style={{ paddingInline: "var(--space-4)", maxWidth: "var(--container-app)" }}>Route</main>;
}
`;
  await writeFile(path.join(appDir, "dashboard", "page.tsx"), routePage("app.dashboard"), "utf-8");
  await writeFile(path.join(appDir, "settings", "page.tsx"), routePage("app.settings"), "utf-8");
  await writeFile(path.join(appDir, "workspace", "page.tsx"), routePage("app.workspace"), "utf-8");
  await writeFile(path.join(appDir, "billing", "page.tsx"), routePage("app.billing"), "utf-8");
  await writeFile(path.join(appDir, "users", "page.tsx"), routePage("app.users"), "utf-8");
  await writeFile(path.join(appDir, "auth", "login", "page.tsx"), routePage("auth.login"), "utf-8");
  await writeFile(path.join(appDir, "auth", "callback", "page.tsx"), routePage("auth.callback"), "utf-8");
  await writeFile(path.join(appDir, "auth", "session", "page.tsx"), routePage("auth.session"), "utf-8");
  await writeFile(path.join(appDir, "auth", "logout", "page.tsx"), routePage("auth.logout"), "utf-8");
  await writeGlobals(
    appDir,
    `:root {
  --font-sans: "Soehne Buch", sans-serif;
  --type-body: 1rem;
  --space-4: 16px;
  --container-app: 1120px;
  --motion-fast: 160ms;
  --motion-ease: ease-out;
  --color-text: #102030;
  --color-bg: #f4f6f8;
}

body {
  font-family: var(--font-sans);
  color: var(--color-text);
  background: var(--color-bg);
}

main {
  font-size: var(--type-body);
  line-height: var(--type-body);
  transition: opacity var(--motion-fast) var(--motion-ease);
}

aside {
  width: var(--container-app);
}
`,
  );

  return appRoot;
}

async function createMixedSignalsApp(rootDir) {
  const appRoot = path.join(rootDir, "apps", "mixed-signals");
  const appDir = path.join(appRoot, "app");
  await mkdir(appDir, { recursive: true });
  await writeFile(
    path.join(appDir, "layout.tsx"),
    `import "./globals.css";
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <nav><a href="/">Home</a></nav>
        <aside>Filters</aside>
        {children}
      </body>
    </html>
  );
}
`,
    "utf-8",
  );
  await writeFile(
    path.join(appDir, "page.tsx"),
    `export default function Page() {
  return <main>Mixed signals</main>;
}
`,
    "utf-8",
  );
  await writeGlobals(
    appDir,
    `body { font-family: "Soehne", sans-serif; color: #222222; background: #ffffff; }
main { transition: opacity 200ms ease; max-width: 60rem; }
`,
  );
  return appRoot;
}

test("analyze: local-root marketing surface emits marketing analysis", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "interfacectl-analyze-marketing-"));
  try {
    const appRoot = await createMarketingApp(cwd);
    const result = await run(
      ["analyze", "--app-root", appRoot, "--surface", "marketing-site"],
      { cwd },
    );
    assert.equal(result.exitCode, 0, result.stderr);

    const analysis = JSON.parse(
      await readFile(
        path.join(cwd, "contracts", "generated", "marketing-site.analysis.json"),
        "utf-8",
      ),
    );

    assert.equal(analysis.classification.inferredKind, "marketing");
    assert.equal(analysis.proposedContract.suggestedMarketingProfile, true);
    assert.ok(analysis.extracted.sectionCount >= 3);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("init: local-root application surface writes contract, draft, and extraction artifacts", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "interfacectl-init-application-"));
  try {
    const appRoot = await createApplicationApp(cwd);
    const result = await run(
      ["init", "--non-interactive", "--app-root", appRoot, "--surface", "product-app"],
      { cwd },
    );
    assert.equal(result.exitCode, 0, result.stderr);

    const generatedDir = path.join(cwd, "contracts", "generated");
    const analysis = JSON.parse(
      await readFile(path.join(generatedDir, "product-app.analysis.json"), "utf-8"),
    );
    const draft = JSON.parse(
      await readFile(path.join(generatedDir, "product-app.design-system.draft.json"), "utf-8"),
    );
    const contract = JSON.parse(
      await readFile(path.join(generatedDir, "product-app.contract.json"), "utf-8"),
    );
    const extraction = JSON.parse(
      await readFile(path.join(generatedDir, "product-app.extraction.json"), "utf-8"),
    );

    assert.equal(analysis.classification.confirmedKind, "application");
    assert.equal(draft.webSurfaceKind, "application");
    assert.equal(draft.mode, "adopt");
    assert.equal(contract.surfaces[0].phase0.authPosture, "auth-first");
    assert.equal(contract.surfaces[0].phase0.requiresShell, true);
    assert.equal(extraction.onboarding.extractMode, "local-root");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("init: non-interactive mixed-signal surface requires explicit surface kind", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "interfacectl-init-mixed-"));
  try {
    const appRoot = await createMixedSignalsApp(cwd);
    const result = await run(
      ["init", "--non-interactive", "--app-root", appRoot, "--surface", "mixed-signals"],
      { cwd },
    );
    assert.equal(result.exitCode, 1);
    assert.match(`${result.stdout}\n${result.stderr}`, /--surface-kind/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
