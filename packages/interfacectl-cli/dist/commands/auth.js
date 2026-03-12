import { captureBrowserStorageState, observeRemotePage } from "../utils/browser-session.js";
import { clearAuthProfiles, getAuthStorageMode, inspectAuthProfile, isLegacyAuthProfile, isProfileExpired, isProfileReplayReady, listAuthProfiles, saveReplayAuthProfile, } from "../utils/auth-profiles.js";
function buildProfileStatus(profile) {
    if (!profile) {
        return "missing";
    }
    if (isProfileExpired(profile)) {
        return "expired";
    }
    if (isLegacyAuthProfile(profile)) {
        return "legacy";
    }
    if (isProfileReplayReady(profile)) {
        return "ready";
    }
    return "not-ready";
}
export async function runAuthListCommand() {
    return runAuthListCommandWithOptions({});
}
export async function runAuthListCommandWithOptions(options) {
    const profiles = await listAuthProfiles();
    const storageMode = getAuthStorageMode();
    if (options.format === "json") {
        const payload = {
            ok: true,
            storageMode,
            profiles: profiles.map((profile) => ({
                ...profile,
                replayReady: isProfileReplayReady(profile),
                status: buildProfileStatus(profile),
            })),
        };
        console.log(JSON.stringify(payload, null, 2));
        return 0;
    }
    if (profiles.length === 0) {
        console.log(`No auth profiles found. storage=${storageMode}`);
        return 0;
    }
    for (const profile of profiles) {
        console.log(`${profile.name} (${profile.domain}) status=${buildProfileStatus(profile)} replayReady=${isProfileReplayReady(profile)} capturedAt=${profile.capturedAt ?? "n/a"} expires=${profile.expiresAt} storage=${storageMode}`);
    }
    return 0;
}
export async function runAuthCaptureCommand(options) {
    if (!options.profile || !options.url) {
        const error = "Missing required --profile and/or --url for auth capture.";
        if (options.format === "json") {
            console.log(JSON.stringify({ ok: false, error }, null, 2));
            return 1;
        }
        console.error(error);
        return 1;
    }
    try {
        const requestedUrl = new URL(options.url);
        const captured = await captureBrowserStorageState({
            url: requestedUrl.toString(),
        });
        const finalUrl = new URL(captured.finalUrl);
        if (finalUrl.hostname !== requestedUrl.hostname) {
            throw new Error(`Capture finished on ${finalUrl.hostname}, but the requested host was ${requestedUrl.hostname}. Capture a profile for the final host instead.`);
        }
        const profile = await saveReplayAuthProfile({
            name: options.profile,
            domain: finalUrl.hostname,
            storageState: captured.storageState,
            captureBrowser: "chromium",
        });
        if (options.format === "json") {
            console.log(JSON.stringify({
                ok: true,
                storageMode: getAuthStorageMode(),
                profile: {
                    ...profile,
                    replayReady: true,
                    status: buildProfileStatus(profile),
                },
                finalUrl: finalUrl.toString(),
            }, null, 2));
            return 0;
        }
        console.log(`Captured auth profile: ${profile.name} (${profile.domain})`);
        console.log(`Final URL: ${finalUrl.toString()}`);
        console.log(`Storage: ${getAuthStorageMode()}`);
        return 0;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (options.format === "json") {
            console.log(JSON.stringify({ ok: false, error: message }, null, 2));
            return 1;
        }
        console.error(message);
        return 1;
    }
}
export async function runAuthTestCommand(options) {
    if (!options.profile) {
        if (options.format === "json") {
            console.log(JSON.stringify({ ok: false, error: "Missing --profile for auth test." }, null, 2));
            return 1;
        }
        console.error("Missing --profile for auth test.");
        return 1;
    }
    const domain = options.url ? new URL(options.url).hostname : options.domain;
    if (!domain) {
        if (options.format === "json") {
            console.log(JSON.stringify({ ok: false, error: "Provide --domain or --url for auth test." }, null, 2));
            return 1;
        }
        console.error("Provide --domain or --url for auth test.");
        return 1;
    }
    const inspection = await inspectAuthProfile(options.profile, domain);
    if (inspection.status !== "ready" || !inspection.profile || !inspection.storageState) {
        const error = inspection.status === "missing"
            ? `Auth profile not found: ${options.profile} (${domain})`
            : inspection.status === "expired"
                ? `Auth profile expired: ${options.profile} (${domain})`
                : inspection.status === "legacy"
                    ? `Auth profile is legacy and must be re-captured: ${options.profile} (${domain})`
                    : `Auth profile is not replay-ready and must be re-captured: ${options.profile} (${domain})`;
        if (options.format === "json") {
            console.log(JSON.stringify({
                ok: false,
                error,
                storageMode: getAuthStorageMode(),
                profile: inspection.profile
                    ? {
                        ...inspection.profile,
                        replayReady: isProfileReplayReady(inspection.profile),
                        status: buildProfileStatus(inspection.profile),
                    }
                    : undefined,
            }, null, 2));
            return 1;
        }
        console.error(error);
        return 1;
    }
    if (!options.url) {
        if (options.format === "json") {
            console.log(JSON.stringify({
                ok: true,
                storageMode: getAuthStorageMode(),
                profile: {
                    ...inspection.profile,
                    replayReady: true,
                    status: buildProfileStatus(inspection.profile),
                },
            }, null, 2));
            return 0;
        }
        console.log(`Auth profile replay-ready: ${inspection.profile.name} (${inspection.profile.domain})`);
        return 0;
    }
    try {
        const observation = await observeRemotePage({
            url: options.url,
            storageState: inspection.storageState,
        });
        const ok = new URL(observation.finalUrl).hostname === inspection.profile.domain &&
            observation.sourceHealth.status === "ok";
        if (options.format === "json") {
            console.log(JSON.stringify({
                ok,
                storageMode: getAuthStorageMode(),
                profile: {
                    ...inspection.profile,
                    replayReady: true,
                    status: buildProfileStatus(inspection.profile),
                },
                finalUrl: observation.finalUrl,
                loginDetected: observation.loginDetected,
                accessDeniedDetected: observation.accessDeniedDetected,
                sourceHealth: observation.sourceHealth,
            }, null, 2));
            return ok ? 0 : 1;
        }
        if (!ok) {
            console.error(`Auth replay failed for ${inspection.profile.name} (${inspection.profile.domain}).`);
            console.error(`Final URL: ${observation.finalUrl}`);
            if (observation.sourceHealth.status === "login") {
                console.error("The replayed session still resolved to a login page.");
            }
            if (observation.sourceHealth.status === "access-denied") {
                console.error("The replayed session resolved to an access-denied page.");
            }
            return 1;
        }
        console.log(`Auth replay OK: ${inspection.profile.name} (${inspection.profile.domain})`);
        console.log(`Final URL: ${observation.finalUrl}`);
        return 0;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (options.format === "json") {
            console.log(JSON.stringify({
                ok: false,
                error: message,
                storageMode: getAuthStorageMode(),
                profile: {
                    ...inspection.profile,
                    replayReady: true,
                    status: buildProfileStatus(inspection.profile),
                },
            }, null, 2));
            return 1;
        }
        console.error(message);
        return 1;
    }
}
export async function runAuthClearCommand(options) {
    if (!options.all && !options.profile && !options.domain) {
        if (options.format === "json") {
            console.log(JSON.stringify({ ok: false, error: "Provide --all, --profile <name>, or --domain <domain>." }, null, 2));
            return 1;
        }
        console.error("Provide --all, --profile <name>, or --domain <domain>.");
        return 1;
    }
    const removed = await clearAuthProfiles({
        all: options.all,
        name: options.profile,
        domain: options.domain,
    });
    if (options.format === "json") {
        console.log(JSON.stringify({ ok: true, removed, storageMode: getAuthStorageMode() }, null, 2));
        return 0;
    }
    console.log(`Removed ${removed} auth profile(s).`);
    return 0;
}
