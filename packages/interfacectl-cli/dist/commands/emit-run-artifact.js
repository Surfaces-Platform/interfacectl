import path from "node:path";
import { emitContractRunArtifact } from "../utils/run-artifacts.js";
const VALID_SOURCES = new Set(["bootstrap", "generation", "ci", "runtime"]);
const VALID_STATUSES = new Set(["pass", "warn", "fail", "unknown"]);
function writeError(message, code) {
    process.stderr.write(`${JSON.stringify({ status: "error", code, error: message }, null, 2)}\n`);
}
export async function runEmitRunArtifactCommand(options) {
    try {
        if (!options.workspaceRoot) {
            throw new Error("--workspace-root is required.");
        }
        if (!options.surfaceId) {
            throw new Error("--surface is required.");
        }
        if (!options.source || !VALID_SOURCES.has(options.source)) {
            throw new Error("--source must be one of bootstrap|generation|ci|runtime.");
        }
        if (!options.status || !VALID_STATUSES.has(options.status)) {
            throw new Error("--status must be one of pass|warn|fail|unknown.");
        }
        const findingCodes = typeof options.findingCodes === "string"
            ? options.findingCodes
                .split(",")
                .map((entry) => entry.trim())
                .filter(Boolean)
            : [];
        const result = emitContractRunArtifact({
            rootDir: path.resolve(options.workspaceRoot),
            surfaceId: options.surfaceId,
            source: options.source,
            status: options.status,
            contractPath: options.contractPath,
            extractionPath: options.extractionPath,
            reportPath: options.reportPath,
            findingCodes,
            workspaceId: options.workspaceId,
            idempotencyKey: options.idempotencyKey,
            createdAt: options.createdAt,
            runId: options.runId,
        });
        process.stdout.write(`${JSON.stringify({ ok: true, ...result }, null, 2)}\n`);
        return 0;
    }
    catch (error) {
        writeError(error instanceof Error ? error.message : String(error), "run-artifact.input");
        return 10;
    }
}
