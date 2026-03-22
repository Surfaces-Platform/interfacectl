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
export interface RemoteInteractiveTargetObservation {
    id: string;
    role: string;
    selector?: string;
    boundingBox: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    hitAreaPx: number;
    nearestNeighborGapPx: number | null;
    nearestNeighborClassification?: "default" | "primary" | "destructive";
    edgeInsetPx: number;
    classification: "default" | "primary" | "destructive";
}
export type RemoteInteractiveTargetCollectionSource = "contract-scoped" | "all-visible-fallback" | "none-observed";
export interface RemoteInteractiveTargetCollectionObservation {
    source: RemoteInteractiveTargetCollectionSource;
    allVisibleCount: number;
    contractScopedCount: number;
}
export interface RemoteAsyncStateObservation {
    id: string;
    kind: "loading" | "empty" | "partial" | "error" | "success";
    sectionIds: string[];
    recoveryActions: Array<"retry" | "refresh" | "dismiss" | "contact-support" | "navigate-home" | "go-back">;
    preserveLastGoodContent: boolean;
    blockedActions: Array<{
        interactionId: string;
        disabled: boolean;
    }>;
}
export interface RemoteFlowStepObservation {
    id: string;
    terminal?: boolean;
}
export interface RemoteFlowTransitionObservation {
    from: string;
    to: string;
}
export interface RemoteFlowObservation {
    flowId: string;
    steps: RemoteFlowStepObservation[];
    transitions: RemoteFlowTransitionObservation[];
}
export type RemoteFlowCollectionSource = "contract-scoped" | "none-observed";
export interface RemoteFlowCollectionObservation {
    source: RemoteFlowCollectionSource;
    observedFlowCount: number;
}
export type RemoteAsyncStateCollectionSource = "contract-scoped" | "none-observed";
export interface RemoteAsyncStateCollectionObservation {
    source: RemoteAsyncStateCollectionSource;
    observedStateCount: number;
}
export interface RemoteRenderedStyleObservation {
    fonts: string[];
    colors: string[];
    maxWidths: number[];
    radii: number[];
    shadowKinds: Array<"outer" | "inset" | "mixed">;
    motions: RemoteRenderedMotionObservation[];
    containers: string[];
    interactiveTargets: RemoteInteractiveTargetObservation[];
    interactiveTargetCollection: RemoteInteractiveTargetCollectionObservation;
    flows: RemoteFlowObservation[];
    flowCollection: RemoteFlowCollectionObservation;
    asyncStates: RemoteAsyncStateObservation[];
    asyncStateCollection: RemoteAsyncStateCollectionObservation;
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