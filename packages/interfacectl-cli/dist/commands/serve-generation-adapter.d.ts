import http from "node:http";
export interface ServeGenerationAdapterCommandOptions {
    host?: string;
    port?: number;
    token?: string;
    tokenHeader?: string;
    bundleRoot?: string;
    descriptorParityConfigPath?: string;
}
export declare function createGenerationAdapterServer(config?: {
    host?: string;
    token?: string;
    tokenHeader?: string;
    bundleRoot?: string;
    descriptorParityConfigPath?: string;
}): http.Server<typeof http.IncomingMessage, typeof http.ServerResponse>;
export declare function runServeGenerationAdapterCommand(options: ServeGenerationAdapterCommandOptions): Promise<void>;
//# sourceMappingURL=serve-generation-adapter.d.ts.map