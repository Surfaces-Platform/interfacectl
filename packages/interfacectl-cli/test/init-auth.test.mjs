import { test } from "node:test";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliPath = path.resolve(__dirname, "..", "dist", "index.js");
const forceFileStorageEnv = { INTERFACECTL_AUTH_DISABLE_KEYCHAIN: "1" };

async function run(args, options = {}) {
  const child = spawn("node", [cliPath, ...args], {
    cwd: options.cwd,
    env: { ...process.env, ...(options.env ?? {}) },
  });
  if (options.input) {
    child.stdin.write(options.input);
    child.stdin.end();
  }
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => { stdout += d.toString(); });
  child.stderr.on("data", (d) => { stderr += d.toString(); });
  const [exitCode] = await once(child, "exit");
  return { exitCode: Number(exitCode), stdout, stderr };
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

    if (req.url === "/session/start") {
      res.writeHead(302, {
        location: "/app",
        "set-cookie": "surface_session=1; Path=/; HttpOnly",
      });
      res.end();
      return;
    }

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
          </main>
        </body>
      </html>
    `);
  });
}

function createAccessDeniedServer() {
  return createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`
      <!doctype html>
      <html>
        <body>
          <main>
            <h1>Access denied</h1>
            <p>You do not have access to this workspace.</p>
          </main>
        </body>
      </html>
    `);
  });
}

test("init: non-interactive remote-url writes first-run artifacts and run metadata", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "interfacectl-init-remote-"));
  const profilePath = path.join(cwd, "auth-profiles.json");
  const server = createServer((req, res) => {
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
            <section data-contract-section="landing.hero">
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
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    await mkdir(path.join(cwd, "contracts"), { recursive: true });
    await writeFile(
      path.join(cwd, "contracts", "surfaces.web.contract.json"),
      JSON.stringify({
        contractId: "test-contract",
        version: "1.0.0",
        surfaces: [],
        sections: [],
        constraints: {
          motion: { allowedDurationsMs: [120], allowedTimingFunctions: ["linear"] },
        },
      }, null, 2),
      "utf-8",
    );

    const result = await run(
      [
        "init",
        "--non-interactive",
        "--url",
        `${baseUrl}/`,
        "--surface",
        "customer-products",
        "--surface-kind",
        "marketing",
      ],
      { cwd, env: { ...forceFileStorageEnv, INTERFACECTL_AUTH_PROFILES_PATH: profilePath } },
    );
    assert.equal(result.exitCode, 0, result.stderr);
    const generatedDir = path.join(cwd, "contracts", "generated");
    const analysis = JSON.parse(
      await readFile(path.join(generatedDir, "customer-products.analysis.json"), "utf-8"),
    );
    const draft = JSON.parse(
      await readFile(path.join(generatedDir, "customer-products.design-system.draft.json"), "utf-8"),
    );
    const contract = JSON.parse(
      await readFile(path.join(generatedDir, "customer-products.contract.json"), "utf-8"),
    );
    const extraction = JSON.parse(
      await readFile(path.join(generatedDir, "customer-products.extraction.json"), "utf-8"),
    );
    const runs = JSON.parse(
      await readFile(path.join(generatedDir, "contract-runs.json"), "utf-8"),
    );
    const lineage = JSON.parse(
      await readFile(path.join(generatedDir, "contract-lineage.json"), "utf-8"),
    );

    assert.equal(analysis.classification.confirmedKind, "marketing");
    assert.equal(draft.webSurfaceKind, "marketing");
    assert.equal(contract.surfaces[0].id, "customer-products");
    assert.equal(extraction.onboarding.extractMode, "remote-url");
    assert.equal(extraction.onboarding.authMode, "none");
    assert.equal(analysis.sourceHealth.status, "ok");
    assert.equal(extraction.sourceHealth.confidence, "full");
    assert.equal(runs.schemaVersion, 1);
    assert.equal(runs.runs[0].source, "generation");
    assert.equal(lineage.surfaces["customer-products"].lastSource, "generation");
  } finally {
    server.closeAllConnections?.();
    server.close();
    await rm(cwd, { recursive: true, force: true });
  }
});

test("init: remote-url ignores zero-duration timing-only motion when seeding contract constraints", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "interfacectl-init-remote-motion-zero-"));
  const profilePath = path.join(cwd, "auth-profiles.json");
  const server = createServer((req, res) => {
    if (req.url === "/styles.css") {
      res.writeHead(200, { "content-type": "text/css" });
      res.end(`
        body { font-family: "Founders Grotesk", sans-serif; color: #101820; background: #ffffff; }
        .hero { max-width: 72rem; border-radius: 24px; }
        .cta { transition-timing-function: ease-in-out; animation-timing-function: linear; }
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
          <main>
            <section data-contract-section="landing.hero">
              <h1>Launch surfaces faster.</h1>
              <a class="cta" href="/start">Get started</a>
            </section>
            <section data-contract-section="landing.cta">
              <a class="cta" href="/docs">Learn more</a>
            </section>
          </main>
        </body>
      </html>
    `);
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    await mkdir(path.join(cwd, "contracts"), { recursive: true });
    await writeFile(
      path.join(cwd, "contracts", "surfaces.web.contract.json"),
      JSON.stringify({
        contractId: "test-contract",
        version: "1.0.0",
        surfaces: [],
        sections: [],
        constraints: {
          motion: { allowedDurationsMs: [120], allowedTimingFunctions: ["linear"] },
        },
      }, null, 2),
      "utf-8",
    );

    const result = await run(
      [
        "init",
        "--non-interactive",
        "--url",
        `${baseUrl}/`,
        "--surface",
        "timing-only-site",
        "--surface-kind",
        "marketing",
      ],
      { cwd, env: { ...forceFileStorageEnv, INTERFACECTL_AUTH_PROFILES_PATH: profilePath } },
    );
    assert.equal(result.exitCode, 0, result.stderr);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /Motion duration 0ms is not allowed/);

    const contract = JSON.parse(
      await readFile(
        path.join(cwd, "contracts", "generated", "timing-only-site.contract.json"),
        "utf-8",
      ),
    );

    assert.deepEqual(contract.constraints.motion.allowedDurationsMs, [120]);
    assert.deepEqual(contract.constraints.motion.allowedTimingFunctions, ["ease-in-out", "linear"]);
  } finally {
    server.closeAllConnections?.();
    server.close();
    await rm(cwd, { recursive: true, force: true });
  }
});

test("auth: capture/list/test/clear operate on replayable local profile store", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "interfacectl-auth-"));
  const profilePath = path.join(cwd, "auth-profiles.json");
  const server = createProtectedServer();
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const capture = await run(
      ["auth", "capture", "--profile", "demo", "--url", `${baseUrl}/session/start`, "--format", "json"],
      {
        cwd,
        env: {
          ...forceFileStorageEnv,
          INTERFACECTL_PLAYWRIGHT_HEADLESS: "1",
          INTERFACECTL_AUTH_PROFILES_PATH: profilePath,
        },
        input: "\n",
      },
    );
    assert.equal(capture.exitCode, 0, capture.stderr);
    const capturePayload = JSON.parse(capture.stdout);
    assert.equal(capturePayload.ok, true);
    assert.equal(capturePayload.profile.replayReady, true);
    assert.ok(capturePayload.profile.replayStateRef);

    const list = await run(
      ["auth", "list", "--format", "json"],
      { cwd, env: { ...forceFileStorageEnv, INTERFACECTL_AUTH_PROFILES_PATH: profilePath } },
    );
    assert.equal(list.exitCode, 0, list.stderr);
    const listPayload = JSON.parse(list.stdout);
    assert.equal(listPayload.ok, true);
    assert.equal(listPayload.profiles.length, 1);
    assert.equal(listPayload.profiles[0].name, "demo");
    assert.equal(listPayload.profiles[0].replayReady, true);

    const testProfile = await run(
      ["auth", "test", "--profile", "demo", "--url", `${baseUrl}/app`, "--format", "json"],
      {
        cwd,
        env: {
          ...forceFileStorageEnv,
          INTERFACECTL_AUTH_PROFILES_PATH: profilePath,
        },
      },
    );
    assert.equal(testProfile.exitCode, 0, testProfile.stderr);
    assert.equal(JSON.parse(testProfile.stdout).ok, true);

    const clear = await run(
      ["auth", "revoke", "--profile", "demo", "--domain", "127.0.0.1", "--format", "json"],
      { cwd, env: { ...forceFileStorageEnv, INTERFACECTL_AUTH_PROFILES_PATH: profilePath } },
    );
    assert.equal(clear.exitCode, 0, clear.stderr);
    assert.equal(JSON.parse(clear.stdout).removed, 1);

    const listAfter = await run(
      ["auth", "list", "--format", "json"],
      { cwd, env: { ...forceFileStorageEnv, INTERFACECTL_AUTH_PROFILES_PATH: profilePath } },
    );
    assert.equal(listAfter.exitCode, 0, listAfter.stderr);
    assert.equal(JSON.parse(listAfter.stdout).profiles.length, 0);
  } finally {
    server.closeAllConnections?.();
    server.close();
    await rm(cwd, { recursive: true, force: true });
  }
});

test("auth: legacy profile is surfaced as non-replayable and analyze with auth-profile fails", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "interfacectl-auth-legacy-"));
  const profilePath = path.join(cwd, "auth-profiles.json");
  const server = createProtectedServer();
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    await writeFile(
      profilePath,
      JSON.stringify({
        schemaVersion: 1,
        profiles: [
          {
            name: "legacy",
            domain: "127.0.0.1",
            mode: "browser-session",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 3600_000).toISOString(),
            sessionRef: "session-legacy",
          },
        ],
      }, null, 2),
      "utf-8",
    );

    const list = await run(
      ["auth", "list", "--format", "json"],
      { cwd, env: { ...forceFileStorageEnv, INTERFACECTL_AUTH_PROFILES_PATH: profilePath } },
    );
    assert.equal(list.exitCode, 0, list.stderr);
    const listPayload = JSON.parse(list.stdout);
    assert.equal(listPayload.profiles[0].status, "legacy");
    assert.equal(listPayload.profiles[0].replayReady, false);

    const testProfile = await run(
      ["auth", "test", "--profile", "legacy", "--domain", "127.0.0.1", "--format", "json"],
      { cwd, env: { ...forceFileStorageEnv, INTERFACECTL_AUTH_PROFILES_PATH: profilePath } },
    );
    assert.equal(testProfile.exitCode, 1);
    assert.match(JSON.parse(testProfile.stdout).error, /re-captured/i);

    const analyze = await run(
      ["analyze", "--url", `${baseUrl}/app`, "--surface", "private-app", "--auth-profile", "legacy"],
      { cwd, env: { ...forceFileStorageEnv, INTERFACECTL_AUTH_PROFILES_PATH: profilePath } },
    );
    assert.equal(analyze.exitCode, 1);
    assert.match(`${analyze.stdout}\n${analyze.stderr}`, /re-captured/i);
  } finally {
    server.closeAllConnections?.();
    server.close();
    await rm(cwd, { recursive: true, force: true });
  }
});

test("analyze: protected remote surface warns anonymously and succeeds with replayed auth profile", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "interfacectl-auth-remote-"));
  const profilePath = path.join(cwd, "auth-profiles.json");
  const server = createProtectedServer();
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const anonymous = await run(
      ["analyze", "--url", `${baseUrl}/app`, "--surface", "private-app"],
      { cwd, env: { ...forceFileStorageEnv, INTERFACECTL_AUTH_PROFILES_PATH: profilePath } },
    );
    assert.equal(anonymous.exitCode, 0, anonymous.stderr);
    const anonymousAnalysis = JSON.parse(
      await readFile(path.join(cwd, "contracts", "generated", "private-app.analysis.json"), "utf-8"),
    );
    assert.equal(
      anonymousAnalysis.warnings.some((warning) => warning.code === "remote.auth.login-detected"),
      true,
    );
    assert.equal(anonymousAnalysis.sourceHealth.status, "login");
    assert.match(anonymous.stdout, /Source access: login/);

    const capture = await run(
      ["auth", "capture", "--profile", "demo", "--url", `${baseUrl}/session/start`, "--format", "json"],
      {
        cwd,
        env: {
          ...forceFileStorageEnv,
          INTERFACECTL_PLAYWRIGHT_HEADLESS: "1",
          INTERFACECTL_AUTH_PROFILES_PATH: profilePath,
        },
        input: "\n",
      },
    );
    assert.equal(capture.exitCode, 0, capture.stderr);

    const authenticated = await run(
      ["analyze", "--url", `${baseUrl}/app`, "--surface", "private-app", "--auth-profile", "demo"],
      { cwd, env: { ...forceFileStorageEnv, INTERFACECTL_AUTH_PROFILES_PATH: profilePath } },
    );
    assert.equal(authenticated.exitCode, 0, authenticated.stderr);
    const authenticatedAnalysis = JSON.parse(
      await readFile(path.join(cwd, "contracts", "generated", "private-app.analysis.json"), "utf-8"),
    );
    assert.equal(authenticatedAnalysis.classification.inferredKind, "application");
    assert.equal(authenticatedAnalysis.extracted.hasShell, true);
    assert.equal(authenticatedAnalysis.sourceHealth.status, "ok");
  } finally {
    server.closeAllConnections?.();
    server.close();
    await rm(cwd, { recursive: true, force: true });
  }
});

test("analyze: public Next-like page with framework auth strings remains sourceHealth ok", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "interfacectl-auth-public-next-like-"));
  const server = createPublicNextLikeServer();
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const result = await run(
      ["analyze", "--url", `${baseUrl}/`, "--surface", "public-site"],
      { cwd, env: { ...forceFileStorageEnv } },
    );
    assert.equal(result.exitCode, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /Source access:/);

    const analysis = JSON.parse(
      await readFile(path.join(cwd, "contracts", "generated", "public-site.analysis.json"), "utf-8"),
    );
    assert.equal(analysis.sourceHealth.status, "ok");
    assert.equal(analysis.sourceHealth.confidence, "full");
  } finally {
    server.closeAllConnections?.();
    server.close();
    await rm(cwd, { recursive: true, force: true });
  }
});

test("analyze: visible access-denied page still classifies as access-denied", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "interfacectl-auth-access-denied-"));
  const server = createAccessDeniedServer();
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const result = await run(
      ["analyze", "--url", `${baseUrl}/`, "--surface", "denied-site"],
      { cwd, env: { ...forceFileStorageEnv } },
    );
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /Source access: access-denied/);

    const analysis = JSON.parse(
      await readFile(path.join(cwd, "contracts", "generated", "denied-site.analysis.json"), "utf-8"),
    );
    assert.equal(analysis.sourceHealth.status, "access-denied");
    assert.equal(analysis.sourceHealth.confidence, "limited");
  } finally {
    server.closeAllConnections?.();
    server.close();
    await rm(cwd, { recursive: true, force: true });
  }
});

test("init: non-interactive gated remote-url fails without continue-on-gate and writes nothing", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "interfacectl-init-gated-fail-"));
  const profilePath = path.join(cwd, "auth-profiles.json");
  const server = createProtectedServer();
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const result = await run(
      [
        "init",
        "--non-interactive",
        "--url",
        `${baseUrl}/app`,
        "--surface",
        "private-app",
        "--surface-kind",
        "application",
      ],
      { cwd, env: { ...forceFileStorageEnv, INTERFACECTL_AUTH_PROFILES_PATH: profilePath } },
    );
    assert.equal(result.exitCode, 1);
    assert.match(`${result.stdout}\n${result.stderr}`, /--continue-on-gate|--auth-profile|login page/i);

    await assert.rejects(
      access(
        path.join(cwd, "contracts", "generated", "private-app.contract.json"),
        fsConstants.F_OK,
      ),
      /ENOENT/,
    );
  } finally {
    server.closeAllConnections?.();
    server.close();
    await rm(cwd, { recursive: true, force: true });
  }
});

test("init: non-interactive gated remote-url writes provisional artifacts with continue-on-gate", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "interfacectl-init-gated-continue-"));
  const profilePath = path.join(cwd, "auth-profiles.json");
  const server = createProtectedServer();
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const result = await run(
      [
        "init",
        "--non-interactive",
        "--continue-on-gate",
        "--url",
        `${baseUrl}/app`,
        "--surface",
        "private-app",
        "--surface-kind",
        "application",
      ],
      { cwd, env: { ...forceFileStorageEnv, INTERFACECTL_AUTH_PROFILES_PATH: profilePath } },
    );
    assert.equal(result.exitCode, 0, result.stderr);

    const generatedDir = path.join(cwd, "contracts", "generated");
    const analysis = JSON.parse(
      await readFile(path.join(generatedDir, "private-app.analysis.json"), "utf-8"),
    );
    const extraction = JSON.parse(
      await readFile(path.join(generatedDir, "private-app.extraction.json"), "utf-8"),
    );

    assert.equal(analysis.sourceHealth.status, "login");
    assert.equal(analysis.sourceHealth.confidence, "limited");
    assert.equal(
      analysis.warnings.some((warning) => warning.code === "remote.source.provisional"),
      true,
    );
    assert.equal(extraction.sourceHealth.status, "login");
    assert.equal(extraction.sourceHealth.confidence, "limited");
  } finally {
    server.closeAllConnections?.();
    server.close();
    await rm(cwd, { recursive: true, force: true });
  }
});

test("auth test returns non-zero when profile is expired", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "interfacectl-auth-expired-"));
  const profilePath = path.join(cwd, "auth-profiles.json");
  try {
    await writeFile(
      profilePath,
      JSON.stringify({
        schemaVersion: 1,
        profiles: [
          {
            name: "expired",
            domain: "customer.example.com",
            mode: "browser-session",
            createdAt: new Date(Date.now() - 7200_000).toISOString(),
            updatedAt: new Date(Date.now() - 7200_000).toISOString(),
            expiresAt: new Date(Date.now() - 3600_000).toISOString(),
            sessionRef: "session-2",
          },
        ],
      }, null, 2),
      "utf-8",
    );
    const result = await run(
      ["auth", "test", "--profile", "expired", "--domain", "customer.example.com", "--format", "json"],
      { cwd, env: { ...forceFileStorageEnv, INTERFACECTL_AUTH_PROFILES_PATH: profilePath } },
    );
    assert.equal(result.exitCode, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, false);
    assert.match(payload.error, /expired/i);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
