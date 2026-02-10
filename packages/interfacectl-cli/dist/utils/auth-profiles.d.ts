export type AuthMode = "browser-session";
export type AuthStorageMode = "keychain" | "file";
export interface AuthProfile {
    name: string;
    domain: string;
    mode: AuthMode;
    createdAt: string;
    updatedAt: string;
    expiresAt: string;
    sessionRef: string;
}
export interface AuthProfileStore {
    list(): Promise<AuthProfile[]>;
    get(name: string, domain?: string): Promise<AuthProfile | null>;
    save(input: {
        name: string;
        domain: string;
        ttlHours?: number;
    }): Promise<AuthProfile>;
    revoke(input: {
        name?: string;
        domain?: string;
    }): Promise<number>;
    revokeAll(): Promise<number>;
    mode(): AuthStorageMode;
}
export declare function isProfileExpired(profile: AuthProfile, now?: Date): boolean;
export declare function getAuthStorageMode(): AuthStorageMode;
export declare function listAuthProfiles(): Promise<AuthProfile[]>;
export declare function saveBrowserSessionProfile(input: {
    name: string;
    domain: string;
    ttlHours?: number;
}): Promise<AuthProfile>;
export declare function findAuthProfile(name: string, domain?: string): Promise<AuthProfile | null>;
export declare function clearAuthProfiles(input: {
    all?: boolean;
    name?: string;
    domain?: string;
}): Promise<number>;
//# sourceMappingURL=auth-profiles.d.ts.map