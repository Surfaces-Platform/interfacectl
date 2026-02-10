type ExtractMode = "remote-url" | "local-root";
export interface InitOptions {
    url?: string;
    surface?: string;
    surfaceName?: string;
    authProfile?: string;
    extractMode?: ExtractMode;
    appRoot?: string;
    nonInteractive?: boolean;
    outDir?: string;
}
export declare function runInitCommand(options: InitOptions): Promise<number>;
export {};
//# sourceMappingURL=init.d.ts.map