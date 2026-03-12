import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runOnboardingRequest, validateOnboardingRequest, saveReplayAuthProfile } from "../dist/index.js";

async function makeSandbox() {
  const root = await mkdtemp(path.join(os.tmpdir(), "interfacectl-onboarding-"));
  await mkdir(path.join(root, "contracts", "generated"), { recursive: true });
  await writeFile(
    path.join(root, "contracts", "surfaces.web.contract.json"),
    JSON.stringify({
      contractId: "surfaces.web",
      version: "0.1.0",
      surfaces: [],
      sections: [],
      constraints: {
        motion: { allowedDurationsMs: [120], allowedTimingFunctions: ["linear"] },
      },
    }, null, 2),
    "utf8",
  );
  return root;
}

async function makeLocalApp(root, relativePath = "demo") {
  const appRoot = path.join(root, relativePath, "app");
  await mkdir(appRoot, { recursive: true });
  await writeFile(
    path.join(appRoot, "page.tsx"),
    [
      "export default function Page() {",
      "  return (",
      "    <main>",
      "      <section>",
      "        <h1>Surface onboarding that starts with your UI.</h1>",
      "        <p>Works for local roots too.</p>",
      "      </section>",
      "    </main>",
      "  );",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
  return relativePath;
}

function makeRemoteObservation(status = "ok") {
  return {
    finalUrl: "https://example.com/",
    html: `
      <html>
        <body>
          <main>
            <section data-section="landing.hero">
              <h1>Surface onboarding that starts with your UI.</h1>
              <a href="/contact">Get started</a>
            </section>
          </main>
        </body>
      </html>
    `,
    cssContents: [],
    loginDetected: status === "login",
    accessDeniedDetected: status === "access-denied",
    sourceHealth: {
      status,
      confidence: status === "ok" ? "full" : "limited",
      finalUrl: "https://example.com/",
      documentStatus: status === "access-denied" ? 403 : 200,
      authMode: "none",
    },
    renderedStyles: {
      fonts: ["Inter"],
      colors: ["rgb(255, 255, 255)", "rgb(15, 23, 42)"],
      maxWidths: [1120],
      radii: [8],
      shadowKinds: [],
      motions: [{ durationMs: 120, timingFunction: "linear" }],
      containers: ["container"],
    },
  };
}

test("validateOnboardingRequest rejects invalid remote URL", () => {
  const result = validateOnboardingRequest({ url: "not-a-url" });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /URL must be valid/);
});

test("runOnboardingRequest returns auth_required on gated remote source without continueOnGate", async () => {
  const root = await makeSandbox();
  try {
    const result = await runOnboardingRequest({
      rootDir: root,
      url: "https://example.com",
      remoteObservation: makeRemoteObservation("login"),
    });
    assert.equal(result.state, "auth_required");
    assert.equal(result.gateStatus, "login");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runOnboardingRequest writes generation artifacts when continueOnGate is enabled", async () => {
  const root = await makeSandbox();
  try {
    const result = await runOnboardingRequest({
      rootDir: root,
      url: "https://example.com",
      continueOnGate: true,
      remoteObservation: makeRemoteObservation("login"),
    });
    assert.equal(result.state, "completed");
    assert.equal(result.status, "warn");
    const report = JSON.parse(await readFile(result.artifacts.reportPath, "utf8"));
    assert.equal(report.surfaceId, result.surfaceId);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runOnboardingRequest uses a saved auth profile when provided", async () => {
  const root = await makeSandbox();
  const authProfilesPath = path.join(root, "auth-profiles.json");
  process.env.INTERFACECTL_AUTH_PROFILES_PATH = authProfilesPath;
  try {
    await saveReplayAuthProfile({
      name: "example",
      domain: "example.com",
      storageState: JSON.stringify({ cookies: [], origins: [] }),
      captureBrowser: "chromium",
    });
    const observation = makeRemoteObservation("ok");
    observation.sourceHealth.authMode = "browser-session";
    const result = await runOnboardingRequest({
      rootDir: root,
      url: "https://example.com",
      authProfileName: "example",
      remoteObservation: observation,
    });
    assert.equal(result.state, "completed");
    assert.equal(result.authProfileName, "example");
  } finally {
    delete process.env.INTERFACECTL_AUTH_PROFILES_PATH;
    await rm(root, { recursive: true, force: true });
  }
});

test("runOnboardingRequest supports local-root onboarding", async () => {
  const root = await makeSandbox();
  try {
    const appRoot = await makeLocalApp(root);
    const result = await runOnboardingRequest({
      rootDir: root,
      sourceMode: "local-root",
      appRoot,
    });
    assert.equal(result.state, "completed");
    assert.equal(result.sourceMode, "local-root");
    assert.equal(result.surfaceId, "demo");
    const contract = JSON.parse(await readFile(result.artifacts.contractPath, "utf8"));
    assert.equal(contract.surfaces[0].id, "demo");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runOnboardingRequest fails when the requested auth profile is missing", async () => {
  const root = await makeSandbox();
  const authProfilesPath = path.join(root, "auth-profiles.json");
  process.env.INTERFACECTL_AUTH_PROFILES_PATH = authProfilesPath;
  try {
    const result = await runOnboardingRequest({
      rootDir: root,
      url: "https://example.com",
      authProfileName: "missing-profile",
    });
    assert.equal(result.state, "failed");
    assert.match(result.message, /missing-profile/);
    assert.match(result.message, /was not found/);
  } finally {
    delete process.env.INTERFACECTL_AUTH_PROFILES_PATH;
    await rm(root, { recursive: true, force: true });
  }
});

test("runOnboardingRequest fails when the requested auth profile is expired", async () => {
  const root = await makeSandbox();
  const authProfilesPath = path.join(root, "auth-profiles.json");
  process.env.INTERFACECTL_AUTH_PROFILES_PATH = authProfilesPath;
  try {
    await saveReplayAuthProfile({
      name: "expired",
      domain: "example.com",
      storageState: JSON.stringify({ cookies: [], origins: [] }),
      captureBrowser: "chromium",
      ttlHours: -1,
    });
    const result = await runOnboardingRequest({
      rootDir: root,
      url: "https://example.com",
      authProfileName: "expired",
    });
    assert.equal(result.state, "failed");
    assert.match(result.message, /expired/);
    assert.match(result.message, /is expired/);
  } finally {
    delete process.env.INTERFACECTL_AUTH_PROFILES_PATH;
    await rm(root, { recursive: true, force: true });
  }
});
