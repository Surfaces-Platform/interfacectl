import { type JsonRecord, type LoadedCompiledSurfaceBundle } from "../adapter/bundle.js";
export interface PrepareGenerationCommandOptions {
    bundleRoot?: string;
    surfaceId?: string;
    outPath?: string;
}
type RepairPriority = "high" | "medium" | "low";
interface SummaryRepairItem {
    code: string;
    priority: RepairPriority;
    category: string;
    actionType: string;
}
export declare function buildPreparedGenerationPayload(bundle: LoadedCompiledSurfaceBundle): {
    evidenceRefs: any[];
    authoring?: JsonRecord | undefined;
    runtime?: JsonRecord | undefined;
    generation: {
        boundary: JsonRecord;
        structure: JsonRecord;
        layout: JsonRecord;
        visual: JsonRecord;
        governance: JsonRecord;
        adaptation: JsonRecord;
        guidance: JsonRecord;
        platforms?: any[] | undefined;
        ast?: JsonRecord | undefined;
    };
    sections: any[];
    components: any[];
    constraints: JsonRecord;
    repairMap: any[];
    integration?: JsonRecord | undefined;
    proposal?: JsonRecord | undefined;
    lifecycle?: JsonRecord | undefined;
    summary: {
        text: string;
        focusOrder: string[];
        requiredSectionIds: string[];
        prohibitedRoles: string[];
        checklist: {
            id: string;
            label: string;
            detail: string;
        }[];
        topRepairs: SummaryRepairItem[];
    };
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
            authoring?: string | undefined;
            runtime?: string | undefined;
            generation: string;
            sections: string;
            components: string;
            constraints: string;
            repairMap: string;
            integration?: string | undefined;
            proposal?: string | undefined;
            lifecycle?: string | undefined;
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
export declare function loadPreparedGenerationPayload(bundleRoot: string, surfaceId: string, cwd?: string): {
    evidenceRefs: any[];
    authoring?: JsonRecord | undefined;
    runtime?: JsonRecord | undefined;
    generation: {
        boundary: JsonRecord;
        structure: JsonRecord;
        layout: JsonRecord;
        visual: JsonRecord;
        governance: JsonRecord;
        adaptation: JsonRecord;
        guidance: JsonRecord;
        platforms?: any[] | undefined;
        ast?: JsonRecord | undefined;
    };
    sections: any[];
    components: any[];
    constraints: JsonRecord;
    repairMap: any[];
    integration?: JsonRecord | undefined;
    proposal?: JsonRecord | undefined;
    lifecycle?: JsonRecord | undefined;
    summary: {
        text: string;
        focusOrder: string[];
        requiredSectionIds: string[];
        prohibitedRoles: string[];
        checklist: {
            id: string;
            label: string;
            detail: string;
        }[];
        topRepairs: SummaryRepairItem[];
    };
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
            authoring?: string | undefined;
            runtime?: string | undefined;
            generation: string;
            sections: string;
            components: string;
            constraints: string;
            repairMap: string;
            integration?: string | undefined;
            proposal?: string | undefined;
            lifecycle?: string | undefined;
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
export declare function runPrepareGenerationCommand(options: PrepareGenerationCommandOptions): Promise<number>;
export {};
//# sourceMappingURL=prepare-generation.d.ts.map