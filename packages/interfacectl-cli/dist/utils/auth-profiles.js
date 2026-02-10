import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const DEFAULT_TTL_HOURS = 4;
const KEYCHAIN_SERVICE = "interfacectl.auth.profiles";
const KEYCHAIN_ACCOUNT = "default";
let warnedFallback = false;
function normalizeProfileName(name) {
    return name.trim().toLowerCase();
}
function isSensitiveEnvFlagTrue(name) {
    return process.env[name] === "1" || process.env[name] === "true";
}
function getProfilesPath() {
    const override = process.env.INTERFACECTL_AUTH_PROFILES_PATH;
    if (override && override.trim().length > 0) {
        return path.resolve(override);
    }
    const xdgConfig = process.env.XDG_CONFIG_HOME;
    const configRoot = xdgConfig && xdgConfig.trim().length > 0
        ? xdgConfig
        : path.join(os.homedir(), ".config");
    return path.join(configRoot, "interfacectl", "auth-profiles.json");
}
function toValidDocument(maybeDoc) {
    const parsed = maybeDoc;
    const profiles = Array.isArray(parsed?.profiles)
        ? parsed.profiles.filter((profile) => profile && typeof profile === "object")
        : [];
    return {
        schemaVersion: Number(parsed?.schemaVersion || 1),
        profiles,
    };
}
async function writeJsonAtomic(filePath, doc) {
    await mkdir(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(doc, null, 2)}\n`, "utf-8");
    await rename(tempPath, filePath);
}
export function isProfileExpired(profile, now = new Date()) {
    return Date.parse(profile.expiresAt) <= now.getTime();
}
class FileAuthProfileStore {
    documentPath;
    constructor(documentPath) {
        this.documentPath = documentPath;
    }
    mode() {
        return "file";
    }
    async readDocument() {
        if (!existsSync(this.documentPath)) {
            return { schemaVersion: 1, profiles: [] };
        }
        try {
            const raw = await readFile(this.documentPath, "utf-8");
            return toValidDocument(JSON.parse(raw));
        }
        catch {
            return { schemaVersion: 1, profiles: [] };
        }
    }
    async writeDocument(doc) {
        await writeJsonAtomic(this.documentPath, doc);
    }
    async list() {
        const doc = await this.readDocument();
        return [...doc.profiles].sort((a, b) => a.name.localeCompare(b.name));
    }
    async get(name, domain) {
        const normalized = normalizeProfileName(name);
        const profiles = await this.list();
        return profiles.find((profile) => normalizeProfileName(profile.name) === normalized &&
            (domain ? profile.domain === domain : true)) ?? null;
    }
    async save(input) {
        const doc = await this.readDocument();
        const now = new Date();
        const ttlHours = input.ttlHours ?? DEFAULT_TTL_HOURS;
        const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000).toISOString();
        const normalizedName = normalizeProfileName(input.name);
        const next = {
            name: normalizedName,
            domain: input.domain,
            mode: "browser-session",
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
            expiresAt,
            sessionRef: randomUUID(),
        };
        const existingIndex = doc.profiles.findIndex((profile) => normalizeProfileName(profile.name) === normalizedName && profile.domain === input.domain);
        if (existingIndex >= 0) {
            next.createdAt = doc.profiles[existingIndex].createdAt;
            doc.profiles[existingIndex] = next;
        }
        else {
            doc.profiles.push(next);
        }
        await this.writeDocument(doc);
        console.error(`[auth-event] profile_created profile=${next.name} domain=${next.domain} mode=file`);
        return next;
    }
    async revoke(input) {
        const doc = await this.readDocument();
        const before = doc.profiles.length;
        if (input.name) {
            const normalized = normalizeProfileName(input.name);
            doc.profiles = doc.profiles.filter((profile) => normalizeProfileName(profile.name) !== normalized ||
                (input.domain ? profile.domain !== input.domain : false));
        }
        else if (input.domain) {
            doc.profiles = doc.profiles.filter((profile) => profile.domain !== input.domain);
        }
        else {
            return 0;
        }
        const removed = before - doc.profiles.length;
        if (removed > 0) {
            await this.writeDocument(doc);
            console.error(`[auth-event] profile_revoked count=${removed} mode=file`);
        }
        return removed;
    }
    async revokeAll() {
        const doc = await this.readDocument();
        const removed = doc.profiles.length;
        if (removed > 0) {
            await this.writeDocument({ schemaVersion: 1, profiles: [] });
            console.error(`[auth-event] profile_revoked_all count=${removed} mode=file`);
        }
        return removed;
    }
}
class KeychainAuthProfileStore {
    static exists() {
        if (process.platform !== "darwin")
            return false;
        if (isSensitiveEnvFlagTrue("INTERFACECTL_AUTH_DISABLE_KEYCHAIN"))
            return false;
        try {
            execSync("command -v security", { encoding: "utf-8", stdio: "ignore" });
            return true;
        }
        catch {
            return false;
        }
    }
    static isAvailable() {
        return KeychainAuthProfileStore.exists();
    }
    mode() {
        return "keychain";
    }
    readDocumentSync() {
        try {
            const raw = execSync(`security find-generic-password -s "${KEYCHAIN_SERVICE}" -a "${KEYCHAIN_ACCOUNT}" -w`, { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] });
            return toValidDocument(JSON.parse(raw.trim() || "{}"));
        }
        catch {
            return { schemaVersion: 1, profiles: [] };
        }
    }
    writeDocumentSync(doc) {
        const payload = JSON.stringify(doc);
        execSync(`security add-generic-password -U -s "${KEYCHAIN_SERVICE}" -a "${KEYCHAIN_ACCOUNT}" -w '${payload.replace(/'/g, "'\\''")}'`, { stdio: ["pipe", "ignore", "ignore"] });
    }
    async list() {
        const doc = this.readDocumentSync();
        return [...doc.profiles].sort((a, b) => a.name.localeCompare(b.name));
    }
    async get(name, domain) {
        const normalized = normalizeProfileName(name);
        const profiles = await this.list();
        return profiles.find((profile) => normalizeProfileName(profile.name) === normalized &&
            (domain ? profile.domain === domain : true)) ?? null;
    }
    async save(input) {
        const doc = this.readDocumentSync();
        const now = new Date();
        const ttlHours = input.ttlHours ?? DEFAULT_TTL_HOURS;
        const normalizedName = normalizeProfileName(input.name);
        const next = {
            name: normalizedName,
            domain: input.domain,
            mode: "browser-session",
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
            expiresAt: new Date(now.getTime() + ttlHours * 60 * 60 * 1000).toISOString(),
            sessionRef: randomUUID(),
        };
        const existingIndex = doc.profiles.findIndex((profile) => normalizeProfileName(profile.name) === normalizedName && profile.domain === input.domain);
        if (existingIndex >= 0) {
            next.createdAt = doc.profiles[existingIndex].createdAt;
            doc.profiles[existingIndex] = next;
        }
        else {
            doc.profiles.push(next);
        }
        this.writeDocumentSync(doc);
        console.error(`[auth-event] profile_created profile=${next.name} domain=${next.domain} mode=keychain`);
        return next;
    }
    async revoke(input) {
        const doc = this.readDocumentSync();
        const before = doc.profiles.length;
        if (input.name) {
            const normalized = normalizeProfileName(input.name);
            doc.profiles = doc.profiles.filter((profile) => normalizeProfileName(profile.name) !== normalized ||
                (input.domain ? profile.domain !== input.domain : false));
        }
        else if (input.domain) {
            doc.profiles = doc.profiles.filter((profile) => profile.domain !== input.domain);
        }
        else {
            return 0;
        }
        const removed = before - doc.profiles.length;
        if (removed > 0) {
            this.writeDocumentSync(doc);
            console.error(`[auth-event] profile_revoked count=${removed} mode=keychain`);
        }
        return removed;
    }
    async revokeAll() {
        const doc = this.readDocumentSync();
        const removed = doc.profiles.length;
        if (removed > 0) {
            this.writeDocumentSync({ schemaVersion: 1, profiles: [] });
            console.error(`[auth-event] profile_revoked_all count=${removed} mode=keychain`);
        }
        return removed;
    }
}
let storeSingleton = null;
function resolveStore() {
    if (storeSingleton)
        return storeSingleton;
    if (KeychainAuthProfileStore.isAvailable()) {
        storeSingleton = new KeychainAuthProfileStore();
        return storeSingleton;
    }
    if (!warnedFallback) {
        warnedFallback = true;
        console.error("Warning: keychain storage unavailable; using local file storage for opaque auth session references.");
    }
    storeSingleton = new FileAuthProfileStore(getProfilesPath());
    return storeSingleton;
}
export function getAuthStorageMode() {
    return resolveStore().mode();
}
export async function listAuthProfiles() {
    return resolveStore().list();
}
export async function saveBrowserSessionProfile(input) {
    return resolveStore().save(input);
}
export async function findAuthProfile(name, domain) {
    const profile = await resolveStore().get(name, domain);
    if (profile && isProfileExpired(profile)) {
        console.error(`[auth-event] profile_expired profile=${profile.name} domain=${profile.domain}`);
    }
    return profile;
}
export async function clearAuthProfiles(input) {
    if (input.all) {
        return resolveStore().revokeAll();
    }
    return resolveStore().revoke({ name: input.name, domain: input.domain });
}
