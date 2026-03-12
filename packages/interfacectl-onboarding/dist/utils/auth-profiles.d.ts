export type AuthMode = "browser-session";
export type AuthStorageMode = "keychain" | "file";
export type CaptureBrowser = "chromium";
export type AuthProfileReadiness = "ready" | "missing" | "expired" | "legacy" | "not-ready";
export interface AuthProfile {
    name: string;
    domain: string;
    mode: AuthMode;
    createdAt: string;
    updatedAt: string;
    expiresAt: string;
    sessionRef?: string;
    replayStateRef?: string;
    replayReady?: boolean;
    capturedAt?: string;
    captureBrowser?: CaptureBrowser;
}
export interface ReplayableAuthProfile {
    profile: AuthProfile;
    storageState: string;
}
export interface AuthProfileInspection {
    status: AuthProfileReadiness;
    profile?: AuthProfile;
    storageState?: string;
}
export declare function isProfileExpired(profile: AuthProfile, now?: Date): boolean;
export declare function isLegacyAuthProfile(profile: AuthProfile): boolean;
export declare function isProfileReplayReady(profile: AuthProfile): boolean;
export declare function getAuthStorageMode(): AuthStorageMode;
export declare function listAuthProfiles(): Promise<AuthProfile[]>;
export declare function findAuthProfile(name: string, domain?: string): Promise<AuthProfile | null>;
export declare function inspectAuthProfile(name: string, domain: string): Promise<AuthProfileInspection>;
export declare function saveReplayAuthProfile(input: {
    name: string;
    domain: string;
    storageState: string;
    captureBrowser: CaptureBrowser;
    ttlHours?: number;
}): Promise<AuthProfile>;
export declare function clearAuthProfiles(input: {
    all?: boolean;
    name?: string;
    domain?: string;
}): Promise<number>;
//# sourceMappingURL=auth-profiles.d.ts.map