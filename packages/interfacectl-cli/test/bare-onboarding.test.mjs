import { test } from "node:test";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { access, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliPath = path.resolve(__dirname, "..", "dist", "index.js");
const { runBareWelcomeFlow } = await import(path.resolve(__dirname, "..", "dist", "utils", "bare-onboarding.js"));
const forceWelcomeEnv = { INTERFACECTL_FORCE_BARE_WELCOME: "1" };

async function run(args, options = {}) {
  const child = spawn("node", [cliPath, ...args], {
    cwd: options.cwd,
    env: { ...process.env, NODE_NO_WARNINGS: "1", ...(options.env ?? {}) },
  });
  if (options.input) {
    child.stdin.write(options.input);
    child.stdin.end();
  }

  let stdout = "";
  let stderr = "";
  const timeout = setTimeout(() => {
    child.kill("SIGKILL");
  }, options.timeoutMs ?? 20000);

  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const [exitCode, signal] = await once(child, "exit");
  clearTimeout(timeout);
  return {
    exitCode: exitCode === null ? null : Number(exitCode),
    signal: signal ?? null,
    stdout,
    stderr,
  };
}

async function runInteractive(args, options = {}) {
  const child = spawn("node", [cliPath, ...args], {
    cwd: options.cwd,
    env: { ...process.env, NODE_NO_WARNINGS: "1", ...(options.env ?? {}) },
  });

  let stdout = "";
  let stderr = "";
  let stepIndex = 0;
  let stdinClosed = false;
  const steps = options.steps ?? [];

  const tryAdvance = () => {
    while (stepIndex < steps.length) {
      const step = steps[stepIndex];
      const combined = `${stdout}${stderr}`;
      if (!step.when.test(combined)) {
        return;
      }
      child.stdin.write(step.input);
      stepIndex += 1;
    }
    if (!stdinClosed && stepIndex === steps.length) {
      stdinClosed = true;
      child.stdin.end();
    }
  };

  const timeout = setTimeout(() => {
    child.kill("SIGKILL");
  }, options.timeoutMs ?? 20000);

  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
    tryAdvance();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
    tryAdvance();
  });

  const [exitCode, signal] = await once(child, "exit");
  clearTimeout(timeout);
  return {
    exitCode: exitCode === null ? null : Number(exitCode),
    signal: signal ?? null,
    stdout,
    stderr,
  };
}

async function createMarketingApp(rootDir, name = "marketing-site") {
  const appRoot = path.join(rootDir, "apps", name);
  const appDir = path.join(appRoot, "app");
  await mkdir(appDir, { recursive: true });
  await writeFile(
    path.join(appDir, "layout.tsx"),
    `import "./globals.css";
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <header><nav><a href="/pricing">Pricing</a></nav></header>
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
  return (
    <main>
      <section data-contract-section="landing.hero">
        <h1 data-contract-copy-role="heroTitle">Surface onboarding that starts with your UI.</h1>
        <p data-contract-copy-role="heroBody">Extract the system you have and draft the one you need.</p>
        <a href="/start" data-contract-copy-role="primaryCta">Get started</a>
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
  await writeFile(
    path.join(appDir, "globals.css"),
    `:root {
  --font-display: "Soehne", sans-serif;
  --space-6: 24px;
  --motion-standard: 180ms;
}

body {
  font-family: var(--font-display);
  color: #111111;
  background: #ffffff;
}

section {
  max-width: 72rem;
  border-radius: 24px;
  transition: opacity var(--motion-standard) ease-in-out;
}
`,
    "utf-8",
  );

  return appRoot;
}

async function createPreviewApp(rootDir) {
  const appRoot = path.join(rootDir, "apps", "preview-app");
  const appDir = path.join(appRoot, "app");
  await mkdir(appDir, { recursive: true });
  await writeFile(
    path.join(appDir, "layout.tsx"),
    `import "./globals.css";
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`,
    "utf-8",
  );
  await writeFile(
    path.join(appDir, "page.tsx"),
    `export default function Page() {
  return (
    <main data-contract-section="app.home">
      <h1>Preview app</h1>
      <p>Preview before writing artifacts.</p>
    </main>
  );
}
`,
    "utf-8",
  );
  await writeFile(
    path.join(appDir, "globals.css"),
    `body {
  font-family: "Soehne", sans-serif;
  color: #111111;
  background: #ffffff;
}

main {
  max-width: 64rem;
  transition: opacity 180ms ease-in-out;
}
`,
    "utf-8",
  );
  return appRoot;
}

function createRemoteMarketingServer() {
  return createServer((req, res) => {
    if (req.url === "/styles.css") {
      res.writeHead(200, { "content-type": "text/css" });
      res.end(`
        body { font-family: "Founders Grotesk", sans-serif; color: #101820; background: #ffffff; }
        .hero { max-width: 72rem; padding: 3rem; border-radius: 24px; }
        .cta { transition: opacity 200ms ease-in-out; }
      `);
      return;
    }

    res.writeHead(200, { "content-type": "text/html" });
    res.end(`
      <!doctype html>
      <html>
        <head>
          <link rel="stylesheet" href="/styles.css" />
        </head>
        <body>
          <header><nav><a href="/pricing">Pricing</a><a href="/contact">Contact</a></nav></header>
          <main>
            <section class="hero" data-contract-section="landing.hero">
              <h1>Launch surfaces faster.</h1>
              <p data-contract-copy-role="heroTitle">Ship a first contract and starter system in one pass.</p>
              <a class="cta" href="/start">Get started</a>
            </section>
            <section data-contract-section="landing.proof">
              <button class="cta">Book demo</button>
            </section>
            <section data-contract-section="landing.cta">
              <a class="cta" href="/docs">Learn more</a>
            </section>
          </main>
        </body>
      </html>
    `);
  });
}

function parseCookies(rawCookieHeader) {
  return (rawCookieHeader ?? "")
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce((acc, entry) => {
      const [key, ...rest] = entry.split("=");
      acc[key] = rest.join("=");
      return acc;
    }, {});
}

function createProtectedServer() {
  return createServer((req, res) => {
    const cookies = parseCookies(req.headers.cookie);
    const authenticated = cookies.surface_session === "1";

    if (req.url === "/styles.css") {
      if (!authenticated) {
        res.writeHead(302, { location: "/login" });
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "text/css" });
      res.end(`
        body { font-family: "Founders Grotesk", sans-serif; color: #102030; background: #f6f8fb; }
        main { max-width: 72rem; transition: opacity 180ms ease-in-out; }
        aside { width: 18rem; border-radius: 16px; }
      `);
      return;
    }

    if (req.url === "/app") {
      if (!authenticated) {
        res.writeHead(302, { location: "/login" });
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "text/html" });
      res.end(`
        <!doctype html>
        <html>
          <head>
            <link rel="stylesheet" href="/styles.css" />
          </head>
          <body>
            <header><nav><a href="/dashboard">Dashboard</a><a href="/settings">Settings</a></nav></header>
            <aside>Workspace navigation</aside>
            <main>
              <section data-contract-section="app.dashboard"><h1>Protected dashboard</h1></section>
              <section data-contract-section="app.settings"><a href="/auth/session">Session</a></section>
            </main>
          </body>
        </html>
      `);
      return;
    }

    if (req.url === "/login") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(`
        <!doctype html>
        <html>
          <body>
            <main>
              <h1>Sign in</h1>
              <form><input type="email" /><input type="password" /></form>
            </main>
          </body>
        </html>
      `);
      return;
    }

    res.writeHead(404);
    res.end("not found");
  });
}

function createPublicNextLikeServer() {
  return createServer((req, res) => {
    if (req.url === "/styles.css") {
      res.writeHead(200, { "content-type": "text/css" });
      res.end(`
        body { font-family: "Founders Grotesk", sans-serif; color: #101820; background: #ffffff; }
        .hero { max-width: 72rem; border-radius: 24px; }
        .shim { border-right: 1px solid rgba(0, 0, 0, .403); }
      `);
      return;
    }

    res.writeHead(200, { "content-type": "text/html" });
    res.end(`
      <!doctype html>
      <html>
        <head>
          <link rel="stylesheet" href="/styles.css" />
          <script>
            self.__next_f = self.__next_f || [];
            self.__next_f.push(["forbidden","$undefined","unauthorized","$undefined"]);
          </script>
        </head>
        <body>
          <main>
            <section class="hero" data-contract-section="landing.hero">
              <h1>Public product site</h1>
              <p>Draft a contract from the rendered surface, not the framework payload.</p>
              <a href="/docs">Read the docs</a>
            </section>
            <section data-contract-section="landing.cta">
              <a href="/start">Get started</a>
            </section>
          </main>
        </body>
      </html>
    `);
  });
}

function createCaptureOutput() {
  let value = "";
  return {
    output: new Writable({
      write(chunk, _encoding, callback) {
        value += chunk.toString();
        callback();
      },
    }),
    read() {
      return value;
    },
  };
}

test("bare interfacectl in non-tty preserves help output and exit semantics", async () => {
  const result = await run([]);
  const combined = `${result.stdout}${result.stderr}`;
  assert.equal(result.exitCode, 1);
  assert.match(combined, /Usage: interfacectl/);
  assert.doesNotMatch(combined, /Surfaces Platform/);
});

test("bare interfacectl welcome flow exits cleanly on q without writing artifacts", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "interfacectl-bare-quit-"));
  try {
    const result = await run([], {
      cwd,
      env: forceWelcomeEnv,
      input: "q\n",
    });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /Surfaces Platform/);
    assert.match(result.stdout, /Choose a source: \[1\] Local app root  \[2\] Live URL  \[q\] Quit/);
    assert.match(result.stdout, /Advanced commands: init, analyze, validate, auth, --help/);
    assert.match(result.stdout, /Exited onboarding\./);

    const generatedDir = path.join(cwd, "contracts", "generated");
    try {
      await access(generatedDir, fsConstants.F_OK);
      const entries = await readdir(generatedDir);
      assert.equal(entries.length, 0);
    } catch (error) {
      assert.equal(error?.code, "ENOENT");
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("bare interfacectl welcome routes local selection into interactive init", async () => {
  const capture = createCaptureOutput();
  let receivedOptions = null;

  const exitCode = await runBareWelcomeFlow({
    input: Readable.from(["1\n"]),
    output: capture.output,
    initRunner: async (options) => {
      receivedOptions = options;
      return 0;
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(receivedOptions, { extractMode: "local-root" });
  assert.match(capture.read(), /Choose a source: \[1\] Local app root  \[2\] Live URL  \[q\] Quit/);
});

test("bare interfacectl welcome routes remote selection into interactive init", async () => {
  const capture = createCaptureOutput();
  let receivedOptions = null;

  const exitCode = await runBareWelcomeFlow({
    input: Readable.from(["2\n"]),
    output: capture.output,
    initRunner: async (options) => {
      receivedOptions = options;
      return 0;
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(receivedOptions, { extractMode: "remote-url" });
  assert.match(capture.read(), /Surfaces Platform/);
});

test("help and explicit commands bypass the bare welcome flow", async () => {
  const commands = [
    ["--help"],
    ["validate", "--help"],
    ["init", "--help"],
    ["analyze", "--help"],
    ["auth", "--help"],
  ];

  for (const args of commands) {
    const result = await run(args, { env: forceWelcomeEnv });
    assert.equal(result.exitCode, 0, `${args.join(" ")}: ${result.stderr}`);
    assert.doesNotMatch(result.stdout, /Surfaces Platform/);
  }
});

test("bare interfacectl remote onboarding stops at gate and quits without writing artifacts", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "interfacectl-bare-gated-quit-"));
  const server = createProtectedServer();
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const result = await runInteractive([], {
      cwd,
      env: forceWelcomeEnv,
      steps: [
        { when: /> $/, input: "2\n" },
        { when: /Surface URL: $/, input: `${baseUrl}/app\n` },
        { when: /Surface id \[[^\]]+\]: $/, input: "\n" },
        { when: /Surface name \[[^\]]+\]: $/, input: "\n" },
        { when: /sign in to see the real page\? \(y\/N\) $/, input: "\n" },
        { when: /We reached a login page instead of the target surface\.[\s\S]*\[q\] Quit/, input: "q\n" },
      ],
    });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /We reached a login page instead of the target surface\./);
    assert.match(result.stdout, /\[1\] Capture auth and retry/);
    assert.match(result.stdout, /Exited onboarding before artifacts were written\./);

    const generatedDir = path.join(cwd, "contracts", "generated");
    await assert.rejects(access(generatedDir, fsConstants.F_OK), /ENOENT/);
  } finally {
    server.closeAllConnections?.();
    server.close();
    await rm(cwd, { recursive: true, force: true });
  }
});

test("bare interfacectl remote onboarding can continue with provisional output after gate warning", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "interfacectl-bare-gated-continue-"));
  const server = createProtectedServer();
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const result = await runInteractive([], {
      cwd,
      env: forceWelcomeEnv,
      steps: [
        { when: /> $/, input: "2\n" },
        { when: /Surface URL: $/, input: `${baseUrl}/app\n` },
        { when: /Surface id \[[^\]]+\]: $/, input: "\n" },
        { when: /Surface name \[[^\]]+\]: $/, input: "\n" },
        { when: /sign in to see the real page\? \(y\/N\) $/, input: "\n" },
        { when: /We reached a login page instead of the target surface\.[\s\S]*\[2\] Continue anyway with provisional results/, input: "2\n" },
        { when: /Create these draft artifacts now\?/, input: "y\n" },
      ],
    });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /What we found/);
    assert.match(result.stdout, /We analyzed a limited view of the source, so results are provisional\./);
    assert.match(result.stdout, /Created/);
    assert.match(result.stdout, /Next/);
    assert.match(result.stdout, /Artifacts/);
    assert.doesNotMatch(result.stdout, /Run id:/);
    assert.doesNotMatch(result.stdout, /Auth storage:/);

    const analysis = JSON.parse(
      await readFile(
        path.join(cwd, "contracts", "generated", "127-0-0-1-app.analysis.json"),
        "utf-8",
      ),
    );
    assert.equal(analysis.sourceHealth.status, "login");
    assert.equal(
      analysis.warnings.some((warning) => warning.code === "remote.source.provisional"),
      true,
    );
  } finally {
    server.closeAllConnections?.();
    server.close();
    await rm(cwd, { recursive: true, force: true });
  }
});

test("bare interfacectl remote onboarding does not stop on a public Next-like page with framework auth strings", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "interfacectl-bare-public-next-like-"));
  const server = createPublicNextLikeServer();
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const result = await runInteractive([], {
      cwd,
      env: forceWelcomeEnv,
      steps: [
        { when: /> $/, input: "2\n" },
        { when: /Surface URL: $/, input: `${baseUrl}/\n` },
        { when: /Surface id \[[^\]]+\]: $/, input: "\n" },
        { when: /Surface name \[[^\]]+\]: $/, input: "\n" },
        { when: /sign in to see the real page\? \(y\/N\) $/, input: "\n" },
        { when: /Create these draft artifacts now\?/, input: "y\n" },
      ],
    });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /Access check stopped onboarding/);
    assert.match(result.stdout, /What we found/);
    assert.match(result.stdout, /We successfully analyzed the source\./);
    assert.match(result.stdout, /What we'll create/);
    assert.match(result.stdout, /What needs review/);
    assert.match(result.stdout, /Continue/);
    assert.doesNotMatch(result.stdout, /existing-system score/);
    assert.doesNotMatch(result.stdout, /adopt mode|synthesize mode/);
    assert.doesNotMatch(result.stdout, /source access:/);

    const analysis = JSON.parse(
      await readFile(
        path.join(cwd, "contracts", "generated", "127-0-0-1.analysis.json"),
        "utf-8",
      ),
    );
    assert.equal(analysis.sourceHealth.status, "ok");
  } finally {
    server.closeAllConnections?.();
    server.close();
    await rm(cwd, { recursive: true, force: true });
  }
});

test("interactive init can quit at preview without writing artifacts", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "interfacectl-init-preview-quit-"));
  try {
    const appRoot = await createPreviewApp(cwd);
    const result = await runInteractive([
      "init",
      "--extract-mode",
      "local-root",
      "--app-root",
      appRoot,
      "--surface-kind",
      "application",
    ], {
      cwd,
      steps: [
        { when: /Surface id \[preview-app\]: $/, input: "\n" },
        { when: /Surface name \[Preview App\]: $/, input: "\n" },
        { when: /Create these draft artifacts now\?/, input: "q\n" },
      ],
    });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /Previewing generated draft/);
    assert.match(result.stdout, /What we found/);
    assert.match(result.stdout, /What we'll create/);
    assert.match(result.stdout, /What needs review/);
    assert.match(result.stdout, /We could not confidently infer layout foundations yet\./);
    assert.doesNotMatch(result.stdout, /0 layout token seed\(s\)/);
    assert.doesNotMatch(result.stdout, /Technical detail:/);
    assert.match(result.stdout, /Exited onboarding before artifacts were written\./);
    await assert.rejects(
      access(path.join(cwd, "contracts", "generated"), fsConstants.F_OK),
      /ENOENT/,
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("interactive init --verbose keeps technical detail in preview and success output", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "interfacectl-init-verbose-"));
  try {
    const appRoot = await createPreviewApp(cwd);
    const result = await runInteractive([
      "init",
      "--extract-mode",
      "local-root",
      "--app-root",
      appRoot,
      "--surface-kind",
      "application",
      "--verbose",
    ], {
      cwd,
      steps: [
        { when: /Surface id \[preview-app\]: $/, input: "verbose-site\n" },
        { when: /Surface name \[Verbose Site\]: $/, input: "\n" },
        { when: /Create these draft artifacts now\?/, input: "y\n" },
      ],
    });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /Technical detail: surface kind confidence \d+\.\d{2}\./);
    assert.match(result.stdout, /Technical detail: existing-system mode /);
    assert.match(result.stdout, /Technical detail: \d+ typography token seed\(s\)/);
    assert.match(result.stdout, /Created/);
    assert.match(result.stdout, /Technical details/);
    assert.match(result.stdout, /Run id:/);
    assert.match(result.stdout, /Auth storage:/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
