import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { AdapterInputError, runGenerationAdapter, } from "../adapter/core.js";
function readDescriptor(descriptorPath) {
    const resolvedPath = path.resolve(descriptorPath);
    if (!fs.existsSync(resolvedPath)) {
        throw new AdapterInputError(`Descriptor file not found: ${resolvedPath}.`);
    }
    try {
        const parsed = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
        if (!Array.isArray(parsed)) {
            throw new AdapterInputError(`Descriptor file must contain a JSON array: ${resolvedPath}.`);
        }
        return parsed;
    }
    catch (error) {
        if (error instanceof AdapterInputError) {
            throw error;
        }
        throw new AdapterInputError(`Failed to read descriptor JSON at ${resolvedPath}: ${error.message}`);
    }
}
export async function runValidateGenerationCommand(options) {
    const request = {
        requestId: options.requestId ?? crypto.randomUUID(),
        tool: options.tool,
        surfaceId: options.surfaceId,
        mode: options.mode,
        bundleRoot: options.bundleRoot,
        provenance: {
            timestamp: new Date().toISOString(),
            sessionId: process.env.SURFACES_ADAPTER_SESSION_ID,
            userId: process.env.SURFACES_ADAPTER_USER_ID,
        },
    };
    if (options.mode === "workspace") {
        request.workspaceRoot =
            typeof options.workspaceRoot === "string"
                ? path.resolve(options.workspaceRoot)
                : undefined;
    }
    else if (options.mode === "descriptor") {
        if (!options.descriptorPath) {
            throw new AdapterInputError("--descriptor-path is required when --mode descriptor.");
        }
        request.descriptor = readDescriptor(options.descriptorPath);
    }
    if (options.mode === "workspace" && !options.workspaceRoot) {
        throw new AdapterInputError("--workspace-root is required when --mode workspace.");
    }
    const runtimeOptions = {
        cwd: process.cwd(),
        descriptorParityConfigPath: options.descriptorParityConfigPath,
    };
    try {
        const response = await runGenerationAdapter(request, runtimeOptions);
        const serialized = `${JSON.stringify(response, null, 2)}\n`;
        if (options.outPath) {
            const outPath = path.resolve(options.outPath);
            fs.mkdirSync(path.dirname(outPath), { recursive: true });
            fs.writeFileSync(outPath, serialized, "utf8");
        }
        process.stdout.write(serialized);
        return response.status === "block" ? 30 : 0;
    }
    catch (error) {
        if (error instanceof AdapterInputError) {
            process.stderr.write(`${JSON.stringify({
                requestId: request.requestId,
                status: "block",
                error: error.message,
                code: error.code,
            }, null, 2)}\n`);
            return 10;
        }
        process.stderr.write(`${JSON.stringify({
            requestId: request.requestId,
            status: "block",
            error: error instanceof Error ? error.message : String(error),
            code: "adapter.internal",
        }, null, 2)}\n`);
        return 1;
    }
}
