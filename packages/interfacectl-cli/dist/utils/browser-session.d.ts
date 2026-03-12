export type SourceHealthStatus = "ok" | "login" | "access-denied";
export type SourceHealthConfidence = "full" | "limited";
export interface RemoteSourceHealth {
    status: SourceHealthStatus;
    confidence: SourceHealthConfidence;
    finalUrl: string;
    documentStatus: number | null;
    authMode: "none" | "browser-session";
}
export interface RemoteRenderedMotionObservation {
    durationMs: number;
    timingFunction: string;
}
export interface RemoteRenderedStyleObservation {
    fonts: string[];
    colors: string[];
    maxWidths: number[];
    radii: number[];
    shadowKinds: Array<"outer" | "inset" | "mixed">;
    motions: RemoteRenderedMotionObservation[];
    containers: string[];
}
export interface RemoteBrowserObservation {
    finalUrl: string;
    html: string;
    cssContents: Array<{
        source: string;
        content: string;
    }>;
    loginDetected: boolean;
    accessDeniedDetected: boolean;
    sourceHealth: RemoteSourceHealth;
    renderedStyles: RemoteRenderedStyleObservation;
}
export declare function captureBrowserStorageState(options: {
    url: string;
}): Promise<{
    finalUrl: string;
    storageState: string;
}>;
export declare function observeRemotePage(options: {
    url: string;
    storageState?: string;
}): Promise<RemoteBrowserObservation>;
//# sourceMappingURL=browser-session.d.ts.map