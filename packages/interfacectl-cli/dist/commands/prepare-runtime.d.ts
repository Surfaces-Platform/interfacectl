import { type JsonRecord, type LoadedCompiledSurfaceBundle } from "../adapter/bundle.js";
export interface PrepareRuntimeCommandOptions {
    bundleRoot?: string;
    surfaceId?: string;
    outPath?: string;
}
export declare function buildPreparedRuntimePayload(bundle: LoadedCompiledSurfaceBundle): {
    summary: {
        text: string;
        requiredSectionIds: string[];
        mutationMode: string;
        strictCategories: string[];
        contextIds: string[];
        checklist: {
            id: string;
            label: string;
            detail: string;
        }[];
    };
    governance: JsonRecord;
    runtime: {
        platforms?: any[] | undefined;
        ast?: JsonRecord | undefined;
    };
    evidenceRefs: any[];
    ast?: {
        id: string;
        version: string;
        normalizedPath: string;
    } | undefined;
    surface: {
        surfaceId: string;
        displayName: string;
        type: string;
    };
    bundle: {
        root: string;
        version: string;
        manifestPath: string;
        sourcePaths: {
            runtime: string;
            generation: string;
            sections: string;
            components: string;
            constraints: string;
            repairMap: string;
            platforms?: string | undefined;
            astSlice?: string | undefined;
            contract: string;
            ast?: string | undefined;
        };
    };
    contract: {
        id: string;
        version: string;
        normalizedPath: string;
    };
};
export declare function loadPreparedRuntimePayload(bundleRoot: string, surfaceId: string, cwd?: string): {
    summary: {
        text: string;
        requiredSectionIds: string[];
        mutationMode: string;
        strictCategories: string[];
        contextIds: string[];
        checklist: {
            id: string;
            label: string;
            detail: string;
        }[];
    };
    governance: JsonRecord;
    runtime: {
        platforms?: any[] | undefined;
        ast?: JsonRecord | undefined;
    };
    evidenceRefs: any[];
    ast?: {
        id: string;
        version: string;
        normalizedPath: string;
    } | undefined;
    surface: {
        surfaceId: string;
        displayName: string;
        type: string;
    };
    bundle: {
        root: string;
        version: string;
        manifestPath: string;
        sourcePaths: {
            runtime: string;
            generation: string;
            sections: string;
            components: string;
            constraints: string;
            repairMap: string;
            platforms?: string | undefined;
            astSlice?: string | undefined;
            contract: string;
            ast?: string | undefined;
        };
    };
    contract: {
        id: string;
        version: string;
        normalizedPath: string;
    };
};
export declare function runPrepareRuntimeCommand(options: PrepareRuntimeCommandOptions): Promise<number>;
//# sourceMappingURL=prepare-runtime.d.ts.map