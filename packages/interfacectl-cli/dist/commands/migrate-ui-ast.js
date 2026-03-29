import path from "node:path";
import { writeDeterministicJson } from "../utils/deterministic-json.js";
import { DEFAULT_AST_PATH, resolveUiAstInput } from "../utils/ui-ast.js";
export async function runMigrateUiAstCommand(options) {
    if (!options.contractPath) {
        console.error("--contract is required.");
        return 1;
    }
    const workspaceRoot = process.cwd();
    const resolved = await resolveUiAstInput({
        workspaceRoot,
        contractPath: options.contractPath,
        schemaPath: options.schemaPath,
    });
    if ("error" in resolved) {
        console.error(resolved.error);
        return 1;
    }
    const outPath = path.resolve(options.outPath ?? DEFAULT_AST_PATH);
    await writeDeterministicJson(outPath, resolved.ast);
    if (options.format === "json") {
        process.stdout.write(`${JSON.stringify({
            status: "ok",
            sourceKind: resolved.sourceKind,
            sourcePath: resolved.sourcePath,
            outPath,
            astId: resolved.ast.astId,
            version: resolved.ast.version,
            surfaceIds: resolved.ast.surfaces.map((surface) => surface.id),
            escalations: resolved.ast.migration?.escalations ?? [],
            warnings: resolved.warnings,
        }, null, 2)}\n`);
        return 0;
    }
    process.stdout.write(`Wrote UI AST draft to ${outPath}\n`);
    if (resolved.warnings.length > 0) {
        for (const warning of resolved.warnings) {
            process.stdout.write(`Warning: ${warning}\n`);
        }
    }
    const escalations = resolved.ast.migration?.escalations ?? [];
    if (escalations.length > 0) {
        process.stdout.write("Escalations:\n");
        for (const escalation of escalations) {
            process.stdout.write(`- [${escalation.surfaceId ?? "global"}] ${escalation.code}: ${escalation.message}\n`);
        }
    }
    return 0;
}
