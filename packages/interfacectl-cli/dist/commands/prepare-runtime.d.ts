import { type JsonRecord, type LoadedCompiledSurfaceBundle } from "../adapter/bundle.js";
export interface PrepareRuntimeCommandOptions {
    bundleRoot?: string;
    surfaceId?: string;
    outPath?: string;
}
export declare function buildPreparedRuntimePayload(bundle: LoadedCompiledSurfaceBundle): {
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
            contract: string;
            runtime: string;
            generation: string;
            sections: string;
            components: string;
            constraints: string;
            repairMap: string;
        };
    };
    contract: {
        id: string;
        version: string;
        normalizedPath: string;
    };
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
    runtime: JsonRecord;
    evidenceRefs: any[];
};
export declare function loadPreparedRuntimePayload(bundleRoot: string, surfaceId: string, cwd?: string): {
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
            contract: string;
            runtime: string;
            generation: string;
            sections: string;
            components: string;
            constraints: string;
            repairMap: string;
        };
    };
    contract: {
        id: string;
        version: string;
        normalizedPath: string;
    };
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
    runtime: JsonRecord;
    evidenceRefs: any[];
};
export declare function runPrepareRuntimeCommand(options: PrepareRuntimeCommandOptions): Promise<number>;
//# sourceMappingURL=prepare-runtime.d.ts.map