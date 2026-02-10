export interface AuthCommandOptions {
    profile?: string;
    domain?: string;
    all?: boolean;
    format?: "text" | "json";
}
export declare function runAuthListCommand(): Promise<number>;
export declare function runAuthListCommandWithOptions(options: AuthCommandOptions): Promise<number>;
export declare function runAuthTestCommand(options: AuthCommandOptions): Promise<number>;
export declare function runAuthClearCommand(options: AuthCommandOptions): Promise<number>;
//# sourceMappingURL=auth.d.ts.map