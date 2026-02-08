export interface DescribeCommandOptions {
    contractPath: string;
    schemaPath?: string;
    root?: string;
    surface?: string[];
    out: string;
    configPath?: string;
}
/**
 * Produce descriptor(s) with primitives for pre-emit guard (check-generation-boundaries).
 * Output format: array of { surfaceId, primitives, sections, fonts, colors, layout, motion }.
 */
export declare function runDescribeCommand(options: DescribeCommandOptions): Promise<number>;
//# sourceMappingURL=describe.d.ts.map