import { type InterfaceContract, type SurfaceDescriptor, type SurfacePrimitiveDescriptor, type TokenMetadata } from "@surfaces/interfacectl-validator";
import { type RemoteBrowserObservation, type SourceHealthConfidence, type SourceHealthStatus } from "./browser-session.js";
export type WebSurfaceKind = "marketing" | "application" | "unknown";
export type FirstRunMode = "adopt" | "synthesize";
export type AnalysisSourceMode = "local-root" | "remote-url";
type FindingSeverity = "info" | "warning";
interface ColorValueSummary {
    canonical: string;
    count: number;
    sources: string[];
}
interface FontValueSummary {
    value: string;
    count: number;
    sources: string[];
}
interface MotionValueSummary {
    durationMs: number;
    timingFunction: string;
    count: number;
    sources: string[];
}
interface IconSourceSummary {
    value: string;
    count: number;
    sources: string[];
}
export interface AnalysisFinding {
    code: string;
    severity: FindingSeverity;
    category: "classification" | "typography" | "color" | "layout" | "motion" | "icons" | "structure";
    message: string;
}
export interface AnalysisEvidence {
    key: string;
    label: string;
    weight: number;
    supports: Exclude<WebSurfaceKind, "unknown">;
    value: string;
    message: string;
}
export interface SurfaceAnalysisArtifact {
    schemaVersion: 1;
    surfaceId: string;
    surfaceName: string;
    source: {
        mode: AnalysisSourceMode;
        appRoot?: string;
        url?: string;
    };
    extracted: {
        routes: string[];
        hasShell: boolean;
        authAware: boolean;
        designSystemComponents: string[];
        sections: string[];
        sectionCount: number;
        fonts: FontValueSummary[];
        colors: ColorValueSummary[];
        motion: MotionValueSummary[];
        iconSources: IconSourceSummary[];
        primitives: SurfacePrimitiveDescriptor[];
        layout: {
            maxContentWidth: number | null;
            containers: string[];
            chrome: {
                maxBorderRadiusPx: number | null;
                shadowKinds: string[];
            };
            landingSignals: {
                sectionOrder: string[];
                topLevelSections: string[];
                nestedSections: string[];
                pageBackgroundMode: "solid" | "custom" | "unknown";
                heroSignal: boolean;
                copyRoleCount: number;
                ctaCount: number;
            };
        };
        tokens: {
            typography: TokenMetadata[];
            layout: TokenMetadata[];
            motion: TokenMetadata[];
        };
    };
    sourceHealth: {
        status: SourceHealthStatus;
        finalUrl?: string;
        authMode: "none" | "browser-session";
        confidence: SourceHealthConfidence;
    };
    classification: {
        inferredKind: WebSurfaceKind;
        confirmedKind: WebSurfaceKind;
        confidence: number;
        requiresConfirmation: boolean;
        scores: Record<WebSurfaceKind, number>;
        supporting: AnalysisEvidence[];
        opposing: AnalysisEvidence[];
    };
    existingSystem: {
        score: number;
        mode: FirstRunMode;
        reasons: string[];
    };
    inconsistencies: {
        findings: AnalysisFinding[];
    };
    proposedContract: {
        phase0: {
            authPosture: "public" | "auth-aware" | "auth-first";
            requiresShell: boolean;
            expectsAuthRoutes: boolean;
            expectsDesignSystem: boolean;
        };
        sectionSeedMode: "observed" | "placeholder";
        seedCounts: {
            typographyTokens: number;
            layoutTokens: number;
            motionTokens: number;
            colors: number;
            iconSources: number;
            sections: number;
        };
        suggestedMarketingProfile: boolean;
    };
    warnings: Array<{
        code: string;
        message: string;
    }>;
}
export interface DesignSystemDraftArtifact {
    schemaVersion: 1;
    surfaceId: string;
    surfaceName: string;
    webSurfaceKind: WebSurfaceKind;
    confidence: number;
    mode: FirstRunMode;
    summary: {
        tokenCount: number;
        inconsistencyCount: number;
        existingSystemScore: number;
    };
    categories: {
        typography: {
            canonicalTokens: TokenMetadata[];
            observedFamilies: string[];
            roleCoverage: string[];
            aliases: string[];
            semanticGroups: string[];
            outliers: string[];
        };
        color: {
            canonicalValues: string[];
            aliases: string[];
            semanticGroups: string[];
            outliers: string[];
        };
        layout: {
            canonicalTokens: TokenMetadata[];
            maxContentWidth: number | null;
            containers: string[];
            radiusPx: number | null;
            shadowKinds: string[];
            semanticGroups: string[];
            outliers: string[];
        };
        motion: {
            canonicalTokens: TokenMetadata[];
            durationsMs: number[];
            timingFunctions: string[];
            aliases: string[];
            semanticGroups: string[];
            outliers: string[];
        };
        icons: {
            allowedSources: string[];
            outliers: string[];
        };
        structure: {
            sections: string[];
            primitives: SurfacePrimitiveDescriptor[];
            surfacePatterns: string[];
            outliers: string[];
        };
    };
    manualFollowUp: string[];
    warnings: Array<{
        code: string;
        message: string;
    }>;
}
export interface AnalyzeSurfaceOptions {
    workspaceRoot: string;
    surfaceId: string;
    surfaceName: string;
    sourceMode: AnalysisSourceMode;
    appRoot?: string;
    url?: string;
    surfaceKindOverride?: WebSurfaceKind;
    authMode?: "none" | "browser-session";
    authProfileName?: string;
    authStorageState?: string;
    remoteObservation?: RemoteBrowserObservation;
}
export interface AnalyzeSurfaceResult {
    analysis: SurfaceAnalysisArtifact;
    draft: DesignSystemDraftArtifact;
    contract: InterfaceContract;
    extractionReport: Record<string, unknown>;
    descriptor: SurfaceDescriptor;
}
export declare function analyzeSurface(options: AnalyzeSurfaceOptions): Promise<AnalyzeSurfaceResult>;
export declare function stringifyStableArtifact(payload: unknown): string;
export {};
//# sourceMappingURL=first-run-analysis.d.ts.map