import { spawnSync } from "node:child_process";
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const DEFAULT_TTL_HOURS = 4;
const LEGACY_METADATA_KEYCHAIN_SERVICE = "interfacectl.auth.profiles";
const LEGACY_METADATA_KEYCHAIN_ACCOUNT = "default";
const REPLAY_STATE_KEYCHAIN_SERVICE = "interfacectl.auth.replay-state";
const ENCRYPTED_STATE_VERSION = 1;
let warnedFallback = false;
function normalizeProfileName(name) {
    return name.trim().toLowerCase();
}
function profileKey(profile) {
    return `${normalizeProfileName(profile.name)}::${profile.domain}`;
}
function isSensitiveEnvFlagTrue(name) {
    return process.env[name] === "1" || process.env[name] === "true";
}
function getAuthConfigRoot() {
    const override = process.env.INTERFACECTL_AUTH_PROFILES_PATH;
    if (override && override.trim().length > 0) {
        return path.dirname(path.resolve(override));
    }
    const xdgConfig = process.env.XDG_CONFIG_HOME;
    const configRoot = xdgConfig && xdgConfig.trim().length > 0
        ? xdgConfig
        : path.join(os.homedir(), ".config");
    return path.join(configRoot, "interfacectl");
}
function getProfilesPath() {
    const override = process.env.INTERFACECTL_AUTH_PROFILES_PATH;
    if (override && override.trim().length > 0) {
        return path.resolve(override);
    }
    return path.join(getAuthConfigRoot(), "auth-profiles.json");
}
function getStateDirectory() {
    const override = process.env.INTERFACECTL_AUTH_STATE_DIR;
    if (override && override.trim().length > 0) {
        return path.resolve(override);
    }
    return path.join(getAuthConfigRoot(), "auth-state");
}
function getStateKeyPath() {
    const override = process.env.INTERFACECTL_AUTH_STATE_KEY_PATH;
    if (override && override.trim().length > 0) {
        return path.resolve(override);
    }
    return path.join(getAuthConfigRoot(), "auth-state.key");
}
function isObjectRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function toValidProfile(maybeProfile) {
    if (!isObjectRecord(maybeProfile)) {
        return null;
    }
    const name = typeof maybeProfile.name === "string" ? normalizeProfileName(maybeProfile.name) : "";
    const domain = typeof maybeProfile.domain === "string" ? maybeProfile.domain : "";
    const mode = maybeProfile.mode === "browser-session" ? "browser-session" : null;
    const createdAt = typeof maybeProfile.createdAt === "string" ? maybeProfile.createdAt : "";
    const updatedAt = typeof maybeProfile.updatedAt === "string" ? maybeProfile.updatedAt : createdAt;
    const expiresAt = typeof maybeProfile.expiresAt === "string" ? maybeProfile.expiresAt : "";
    if (!name || !domain || !mode || !createdAt || !expiresAt) {
        return null;
    }
    return {
        name,
        domain,
        mode,
        createdAt,
        updatedAt,
        expiresAt,
        sessionRef: typeof maybeProfile.sessionRef === "string" ? maybeProfile.sessionRef : undefined,
        replayStateRef: typeof maybeProfile.replayStateRef === "string" ? maybeProfile.replayStateRef : undefined,
        replayReady: maybeProfile.replayReady === true,
        capturedAt: typeof maybeProfile.capturedAt === "string" ? maybeProfile.capturedAt : undefined,
        captureBrowser: maybeProfile.captureBrowser === "chromium" ? "chromium" : undefined,
    };
}
function toValidDocument(maybeDoc) {
    const parsed = maybeDoc;
    const profiles = Array.isArray(parsed?.profiles)
        ? parsed.profiles.map(toValidProfile).filter((profile) => profile !== null)
        : [];
    return {
        schemaVersion: Number(parsed?.schemaVersion || 2),
        profiles,
    };
}
async function writeJsonAtomic(filePath, doc) {
    await mkdir(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(doc, null, 2)}\n`, "utf-8");
    await rename(tempPath, filePath);
}
function mergeProfiles(primary, secondary) {
    const merged = new Map();
    for (const profile of [...secondary, ...primary]) {
        const key = profileKey(profile);
        const existing = merged.get(key);
        if (!existing) {
            merged.set(key, profile);
            continue;
        }
        const existingReady = isProfileReplayReady(existing);
        const nextReady = isProfileReplayReady(profile);
        if (nextReady && !existingReady) {
            merged.set(key, profile);
            continue;
        }
        if (existingReady && !nextReady) {
            continue;
        }
        if ((Date.parse(profile.updatedAt) || 0) >= (Date.parse(existing.updatedAt) || 0)) {
            merged.set(key, profile);
        }
    }
    return [...merged.values()].sort((a, b) => {
        const nameDiff = a.name.localeCompare(b.name);
        return nameDiff !== 0 ? nameDiff : a.domain.localeCompare(b.domain);
    });
}
function runSecurity(args) {
    const result = spawnSync("security", args, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "ignore"],
    });
    return {
        ok: result.status === 0,
        stdout: result.stdout ?? "",
    };
}
function keychainAvailable() {
    if (process.platform !== "darwin") {
        return false;
    }
    if (isSensitiveEnvFlagTrue("INTERFACECTL_AUTH_DISABLE_KEYCHAIN")) {
        return false;
    }
    const probe = spawnSync("command", ["-v", "security"], {
        shell: true,
        encoding: "utf-8",
        stdio: "ignore",
    });
    return probe.status === 0;
}
function readLegacyMetadataFromKeychain() {
    if (!keychainAvailable()) {
        return { schemaVersion: 2, profiles: [] };
    }
    const result = runSecurity([
        "find-generic-password",
        "-s",
        LEGACY_METADATA_KEYCHAIN_SERVICE,
        "-a",
        LEGACY_METADATA_KEYCHAIN_ACCOUNT,
        "-w",
    ]);
    if (!result.ok) {
        return { schemaVersion: 2, profiles: [] };
    }
    try {
        return toValidDocument(JSON.parse(result.stdout.trim() || "{}"));
    }
    catch {
        return { schemaVersion: 2, profiles: [] };
    }
}
function clearLegacyMetadataFromKeychain() {
    if (!keychainAvailable()) {
        return;
    }
    runSecurity([
        "delete-generic-password",
        "-s",
        LEGACY_METADATA_KEYCHAIN_SERVICE,
        "-a",
        LEGACY_METADATA_KEYCHAIN_ACCOUNT,
    ]);
}
async function readMetadataDocument() {
    const metadataPath = getProfilesPath();
    const fileDoc = existsSync(metadataPath)
        ? toValidDocument(JSON.parse(await readFile(metadataPath, "utf-8")))
        : { schemaVersion: 2, profiles: [] };
    const legacyDoc = readLegacyMetadataFromKeychain();
    return {
        schemaVersion: 2,
        profiles: mergeProfiles(fileDoc.profiles, legacyDoc.profiles),
    };
}
async function writeMetadataDocument(doc) {
    await writeJsonAtomic(getProfilesPath(), {
        schemaVersion: 2,
        profiles: doc.profiles,
    });
    clearLegacyMetadataFromKeychain();
}
async function ensureFilePermissions(filePath) {
    try {
        await chmod(filePath, 0o600);
    }
    catch {
        // Best effort only.
    }
}
async function readOrCreateMasterKey() {
    const keyPath = getStateKeyPath();
    if (existsSync(keyPath)) {
        const raw = await readFile(keyPath, "utf-8");
        return Buffer.from(raw.trim(), "base64");
    }
    const key = randomBytes(32);
    await mkdir(path.dirname(keyPath), { recursive: true });
    await writeFile(keyPath, key.toString("base64"), "utf-8");
    await ensureFilePermissions(keyPath);
    return key;
}
function encryptState(payload, key) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(payload, "utf-8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return JSON.stringify({
        version: ENCRYPTED_STATE_VERSION,
        iv: iv.toString("base64"),
        authTag: authTag.toString("base64"),
        ciphertext: ciphertext.toString("base64"),
    });
}
function decryptState(payload, key) {
    try {
        const parsed = JSON.parse(payload);
        if (parsed.version !== ENCRYPTED_STATE_VERSION) {
            return null;
        }
        const iv = Buffer.from(String(parsed.iv), "base64");
        const authTag = Buffer.from(String(parsed.authTag), "base64");
        const ciphertext = Buffer.from(String(parsed.ciphertext), "base64");
        const decipher = createDecipheriv("aes-256-gcm", key, iv);
        decipher.setAuthTag(authTag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf-8");
    }
    catch {
        return null;
    }
}
class FileReplayStateStore {
    mode() {
        return "file";
    }
    statePath(ref) {
        return path.join(getStateDirectory(), `${ref}.json.enc`);
    }
    async load(ref) {
        const target = this.statePath(ref);
        if (!existsSync(target)) {
            return null;
        }
        const key = await readOrCreateMasterKey();
        const encrypted = await readFile(target, "utf-8");
        return decryptState(encrypted, key);
    }
    async save(ref, payload) {
        const target = this.statePath(ref);
        const key = await readOrCreateMasterKey();
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, encryptState(payload, key), "utf-8");
        await ensureFilePermissions(target);
    }
    async delete(ref) {
        await rm(this.statePath(ref), { force: true });
    }
}
class KeychainReplayStateStore {
    static isAvailable() {
        return keychainAvailable();
    }
    mode() {
        return "keychain";
    }
    async load(ref) {
        const result = runSecurity([
            "find-generic-password",
            "-s",
            REPLAY_STATE_KEYCHAIN_SERVICE,
            "-a",
            ref,
            "-w",
        ]);
        return result.ok ? result.stdout : null;
    }
    async save(ref, payload) {
        const result = runSecurity([
            "add-generic-password",
            "-U",
            "-s",
            REPLAY_STATE_KEYCHAIN_SERVICE,
            "-a",
            ref,
            "-w",
            payload,
        ]);
        if (!result.ok) {
            throw new Error(`Failed to write replay state for auth profile "${ref}" to keychain.`);
        }
    }
    async delete(ref) {
        runSecurity([
            "delete-generic-password",
            "-s",
            REPLAY_STATE_KEYCHAIN_SERVICE,
            "-a",
            ref,
        ]);
    }
}
let replayStateStoreSingleton = null;
function resolveReplayStateStore() {
    if (replayStateStoreSingleton) {
        return replayStateStoreSingleton;
    }
    if (KeychainReplayStateStore.isAvailable()) {
        replayStateStoreSingleton = new KeychainReplayStateStore();
        return replayStateStoreSingleton;
    }
    if (!warnedFallback) {
        warnedFallback = true;
        console.error("Warning: keychain storage unavailable; using encrypted local file storage for replayable auth state.");
    }
    replayStateStoreSingleton = new FileReplayStateStore();
    return replayStateStoreSingleton;
}
function dedupeProfiles(profiles) {
    return mergeProfiles(profiles, []);
}
function findProfileInDocument(doc, name, domain) {
    const normalized = normalizeProfileName(name);
    return doc.profiles.find((profile) => normalizeProfileName(profile.name) === normalized &&
        (domain ? profile.domain === domain : true)) ?? null;
}
export function isProfileExpired(profile, now = new Date()) {
    return Date.parse(profile.expiresAt) <= now.getTime();
}
export function isLegacyAuthProfile(profile) {
    return Boolean(profile.sessionRef) && !profile.replayStateRef;
}
export function isProfileReplayReady(profile) {
    return Boolean(!isLegacyAuthProfile(profile) &&
        profile.replayReady === true &&
        profile.replayStateRef &&
        profile.capturedAt &&
        profile.captureBrowser === "chromium");
}
export function getAuthStorageMode() {
    return resolveReplayStateStore().mode();
}
export async function listAuthProfiles() {
    const doc = await readMetadataDocument();
    return dedupeProfiles(doc.profiles);
}
export async function findAuthProfile(name, domain) {
    const doc = await readMetadataDocument();
    const profile = findProfileInDocument(doc, name, domain);
    if (profile && isProfileExpired(profile)) {
        console.error(`[auth-event] profile_expired profile=${profile.name} domain=${profile.domain}`);
    }
    return profile;
}
export async function inspectAuthProfile(name, domain) {
    const profile = await findAuthProfile(name, domain);
    if (!profile) {
        return { status: "missing" };
    }
    if (isProfileExpired(profile)) {
        return { status: "expired", profile };
    }
    if (isLegacyAuthProfile(profile)) {
        return { status: "legacy", profile };
    }
    if (!isProfileReplayReady(profile) || !profile.replayStateRef) {
        return { status: "not-ready", profile };
    }
    const storageState = await resolveReplayStateStore().load(profile.replayStateRef);
    if (!storageState) {
        return { status: "not-ready", profile };
    }
    return {
        status: "ready",
        profile,
        storageState,
    };
}
export async function saveReplayAuthProfile(input) {
    const doc = await readMetadataDocument();
    const now = new Date();
    const normalizedName = normalizeProfileName(input.name);
    const ttlHours = input.ttlHours ?? DEFAULT_TTL_HOURS;
    const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000).toISOString();
    const replayStateRef = randomUUID();
    const existing = findProfileInDocument(doc, normalizedName, input.domain);
    await resolveReplayStateStore().save(replayStateRef, input.storageState);
    if (existing?.replayStateRef && existing.replayStateRef !== replayStateRef) {
        await resolveReplayStateStore().delete(existing.replayStateRef);
    }
    const next = {
        name: normalizedName,
        domain: input.domain,
        mode: "browser-session",
        createdAt: existing?.createdAt ?? now.toISOString(),
        updatedAt: now.toISOString(),
        expiresAt,
        replayStateRef,
        replayReady: true,
        capturedAt: now.toISOString(),
        captureBrowser: input.captureBrowser,
    };
    const profiles = dedupeProfiles(doc.profiles.filter((profile) => profileKey(profile) !== profileKey(next)).concat(next));
    await writeMetadataDocument({
        schemaVersion: 2,
        profiles,
    });
    console.error(`[auth-event] profile_captured profile=${next.name} domain=${next.domain} storage=${getAuthStorageMode()}`);
    return next;
}
export async function clearAuthProfiles(input) {
    const doc = await readMetadataDocument();
    const shouldRemove = (profile) => {
        if (input.all) {
            return true;
        }
        if (input.name) {
            return normalizeProfileName(profile.name) === normalizeProfileName(input.name) &&
                (input.domain ? profile.domain === input.domain : true);
        }
        if (input.domain) {
            return profile.domain === input.domain;
        }
        return false;
    };
    const removedProfiles = doc.profiles.filter(shouldRemove);
    const remainingProfiles = doc.profiles.filter((profile) => !shouldRemove(profile));
    for (const profile of removedProfiles) {
        if (profile.replayStateRef) {
            await resolveReplayStateStore().delete(profile.replayStateRef);
        }
    }
    if (removedProfiles.length > 0 || input.all) {
        await writeMetadataDocument({
            schemaVersion: 2,
            profiles: dedupeProfiles(remainingProfiles),
        });
    }
    if (removedProfiles.length > 0) {
        console.error(`[auth-event] profile_revoked count=${removedProfiles.length} storage=${getAuthStorageMode()}`);
    }
    return removedProfiles.length;
}
