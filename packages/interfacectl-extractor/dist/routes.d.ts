/**
 * Recursively collect public route paths from app/ directory.
 * Converts file system paths to URL path segments; dynamic segments
 * are preserved as [param], [...rest], [[...optional]].
 */
export declare function extractRoutes(appDir: string): Promise<string[]>;
//# sourceMappingURL=routes.d.ts.map