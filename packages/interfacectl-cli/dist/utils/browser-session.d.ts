export interface RemoteBrowserObservation {
    finalUrl: string;
    html: string;
    cssContents: Array<{
        source: string;
        content: string;
    }>;
    loginDetected: boolean;
    accessDeniedDetected: boolean;
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