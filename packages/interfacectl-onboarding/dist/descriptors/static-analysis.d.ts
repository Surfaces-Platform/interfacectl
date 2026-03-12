import { type InterfaceContract, type SurfaceDescriptor } from "@surfaces/interfacectl-validator";
export interface DescriptorIssue {
    surfaceId?: string;
    code: string;
    message: string;
    location?: string;
}
export interface CollectSurfaceDescriptorsOptions {
    workspaceRoot: string;
    contract: InterfaceContract;
    surfaceFilters: Set<string>;
    surfaceRootMap: Map<string, string>;
}
export interface CollectSurfaceDescriptorsResult {
    descriptors: SurfaceDescriptor[];
    warnings: DescriptorIssue[];
    errors: DescriptorIssue[];
}
export declare function collectSurfaceDescriptors(options: CollectSurfaceDescriptorsOptions): Promise<CollectSurfaceDescriptorsResult>;
//# sourceMappingURL=static-analysis.d.ts.map