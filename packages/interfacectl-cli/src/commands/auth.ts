import {
  clearAuthProfiles,
  findAuthProfile,
  getAuthStorageMode,
  isProfileExpired,
  listAuthProfiles,
} from "../utils/auth-profiles.js";

export interface AuthCommandOptions {
  profile?: string;
  domain?: string;
  all?: boolean;
  format?: "text" | "json";
}

export async function runAuthListCommand(): Promise<number> {
  return runAuthListCommandWithOptions({});
}

export async function runAuthListCommandWithOptions(options: AuthCommandOptions): Promise<number> {
  const profiles = await listAuthProfiles();
  const storageMode = getAuthStorageMode();
  if (options.format === "json") {
    const payload = {
      ok: true,
      storageMode,
      profiles: profiles.map((profile) => ({
        ...profile,
        status: isProfileExpired(profile) ? "expired" : "active",
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
    const status = isProfileExpired(profile) ? "expired" : "active";
    console.log(
      `${profile.name} (${profile.domain}) mode=${profile.mode} status=${status} expires=${profile.expiresAt}`,
    );
  }
  return 0;
}

export async function runAuthTestCommand(options: AuthCommandOptions): Promise<number> {
  if (!options.profile) {
    if (options.format === "json") {
      console.log(JSON.stringify({ ok: false, error: "Missing --profile for auth test." }, null, 2));
      return 1;
    }
    console.error("Missing --profile for auth test.");
    return 1;
  }
  const profile = await findAuthProfile(options.profile, options.domain);
  if (!profile) {
    if (options.format === "json") {
      console.log(JSON.stringify({ ok: false, error: `Auth profile not found: ${options.profile}` }, null, 2));
      return 1;
    }
    console.error(`Auth profile not found: ${options.profile}`);
    return 1;
  }
  if (isProfileExpired(profile)) {
    if (options.format === "json") {
      console.log(
        JSON.stringify(
          {
            ok: false,
            error: `Auth profile expired: ${profile.name} (${profile.domain})`,
            storageMode: getAuthStorageMode(),
            profile: { ...profile, status: "expired" },
          },
          null,
          2,
        ),
      );
      return 1;
    }
    console.error(`Auth profile expired: ${profile.name} (${profile.domain})`);
    return 1;
  }
  if (options.format === "json") {
    console.log(
      JSON.stringify(
        {
          ok: true,
          storageMode: getAuthStorageMode(),
          profile: { ...profile, status: "active" },
        },
        null,
        2,
      ),
    );
    return 0;
  }
  console.log(`Auth profile OK: ${profile.name} (${profile.domain})`);
  return 0;
}

export async function runAuthClearCommand(options: AuthCommandOptions): Promise<number> {
  if (!options.all && !options.profile && !options.domain) {
    if (options.format === "json") {
      console.log(
        JSON.stringify(
          { ok: false, error: "Provide --all, --profile <name>, or --domain <domain>." },
          null,
          2,
        ),
      );
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
    console.log(
      JSON.stringify(
        { ok: true, removed, storageMode: getAuthStorageMode() },
        null,
        2,
      ),
    );
    return 0;
  }
  console.log(`Removed ${removed} auth profile(s).`);
  return 0;
}
