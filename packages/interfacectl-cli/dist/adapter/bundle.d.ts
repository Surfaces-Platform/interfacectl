export declare const SUPPORTED_BUNDLE_VERSION = "2.0";
export interface JsonRecord {
    [key: string]: unknown;
}
export interface BundleManifest extends JsonRecord {
    bundleVersion?: string;
    contractId?: string;
    contractVersion?: string;
}
export interface LoadedJsonFile<T extends JsonRecord = JsonRecord> {
    path: string;
    value: T;
}
export interface LoadedCompiledSurfaceBundle {
    root: string;
    version: string;
    contractId: string;
    contractVersion: string;
    manifest: LoadedJsonFile<BundleManifest>;
    contract: LoadedJsonFile;
    surface: {
        id: string;
        dir: string;
        generation: LoadedJsonFile;
        sections: LoadedJsonFile;
        components: LoadedJsonFile;
        constraints: LoadedJsonFile;
        repairMap: LoadedJsonFile;
        runtime?: LoadedJsonFile;
        authoring?: LoadedJsonFile;
    };
}
export declare class AdapterInputError extends Error {
    code: string;
    meta?: Record<string, unknown>;
    constructor(message: string, details?: {
        code?: string;
        meta?: Record<string, unknown>;
    });
}
export declare function isAdapterInputError(error: unknown): error is AdapterInputError;
export declare function isRecord(value: unknown): value is JsonRecord;
export declare function readJsonFile<T extends JsonRecord = JsonRecord>(filePath: string, label: string): T;
export declare function ensureReadableFile(filePath: string, label: string): void;
export declare function ensureReadableDirectory(dirPath: string, label: string): void;
export declare function loadCompiledSurfaceBundle(bundleRootInput: string, surfaceId: string, cwd: string): LoadedCompiledSurfaceBundle;
//# sourceMappingURL=bundle.d.ts.map