import path from "node:path";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { createHash } from "node:crypto";
import { validateContractStructure, getBundledContractSchema, } from "@surfaces/interfacectl-validator";
import { normalizeContract } from "../utils/normalize.js";
const BUNDLE_VERSION = "1.0";
/** Stable constant for manifest.schemaVersion. Deterministic: no paths, mtimes, or env. When a custom schema is supplied, inputs.schemaPath records it. */
const SCHEMA_VERSION = "surfaces.web.contract@1";
/**
 * Recursively sort object keys for deterministic JSON output.
 * Array element order is preserved; only object keys are sorted.
 */
function sortKeysRecursive(value) {
    if (value === null || value === undefined) {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map(sortKeysRecursive);
    }
    if (typeof value === "object") {
        const sorted = {};
        for (const k of Object.keys(value).sort()) {
            sorted[k] = sortKeysRecursive(value[k]);
        }
        return sorted;
    }
    return value;
}
/**
 * Serialize value to JSON with stable key ordering and readable indent.
 */
function stringifyDeterministic(value) {
    return `${JSON.stringify(sortKeysRecursive(value), null, 2)}\n`;
}
function sha256Hex(content) {
    return createHash("sha256").update(content, "utf8").digest("hex");
}
/**
 * Write content to file atomically (write to .tmp then rename).
 */
async function writeAtomic(filePath, content) {
    const dir = path.dirname(filePath);
    await mkdir(dir, { recursive: true });
    const tmpPath = `${filePath}.tmp`;
    await writeFile(tmpPath, content, "utf8");
    await rename(tmpPath, filePath);
}
export async function runCompileCommand(options, toolVersion) {
    const outDir = path.resolve(options.outDir);
    const contractInput = path.resolve(options.contractPath);
    const schemaPath = options.schemaPath
        ? path.resolve(options.schemaPath)
        : undefined;
    let contractRaw;
    try {
        contractRaw = await readFile(contractInput, "utf8");
    }
    catch (err) {
        const message = err.code === "ENOENT"
            ? `Contract file not found: ${contractInput}`
            : `Failed to read contract: ${err.message}`;
        console.error(message);
        return 1;
    }
    let contractData;
    try {
        contractData = JSON.parse(contractRaw);
    }
    catch (err) {
        console.error(`Invalid contract JSON: ${err.message}`);
        return 1;
    }
    let schema;
    if (schemaPath) {
        try {
            const raw = await readFile(schemaPath, "utf8");
            schema = JSON.parse(raw);
        }
        catch (err) {
            const message = err.code === "ENOENT"
                ? `Schema file not found: ${schemaPath}`
                : `Failed to read schema: ${err.message}`;
            console.error(message);
            return 1;
        }
    }
    else {
        schema = getBundledContractSchema();
    }
    const structureResult = validateContractStructure(contractData, schema);
    if (!structureResult.ok || !structureResult.contract) {
        console.error("Contract schema validation failed:");
        for (const error of structureResult.errors) {
            console.error(`  • ${error}`);
        }
        return 1;
    }
    const contract = structureResult.contract;
    const { contract: normalizedContract } = normalizeContract(contract);
    const contractContent = stringifyDeterministic(normalizedContract);
    const bundleFiles = [
        { path: "contract.normalized.json", content: contractContent },
    ];
    for (const surface of normalizedContract.surfaces) {
        const surfacePayload = surfaceToBundlePayload(surface);
        const content = stringifyDeterministic(surfacePayload);
        bundleFiles.push({
            path: `surfaces/${surface.id}.json`,
            content,
        });
    }
    if (normalizedContract.constraints.motion) {
        const motionContent = stringifyDeterministic(normalizedContract.constraints.motion);
        bundleFiles.push({
            path: "constraints/motion.json",
            content: motionContent,
        });
    }
    const filesSorted = [...bundleFiles].sort((a, b) => a.path.localeCompare(b.path));
    const fileEntries = filesSorted.map(({ path: p, content }) => ({
        path: p,
        sha256: sha256Hex(content),
    }));
    const manifest = {
        bundleVersion: BUNDLE_VERSION,
        contractId: normalizedContract.contractId,
        contractVersion: normalizedContract.version,
        schemaVersion: SCHEMA_VERSION,
        tool: { name: "interfacectl", version: toolVersion },
        inputs: {
            contractPath: options.contractPath,
            schemaPath: schemaPath ?? null,
        },
        files: fileEntries,
    };
    const manifestContent = stringifyDeterministic(manifest);
    try {
        for (const { path: p, content } of filesSorted) {
            await writeAtomic(path.join(outDir, p), content);
        }
        await writeAtomic(path.join(outDir, "manifest.json"), manifestContent);
    }
    catch (err) {
        console.error(`Failed to write bundle: ${err.message}`);
        return 1;
    }
    return 0;
}
function surfaceToBundlePayload(surface) {
    return {
        id: surface.id,
        displayName: surface.displayName,
        type: surface.type,
        requiredSections: surface.requiredSections,
        allowedFonts: surface.allowedFonts,
        ...(surface.allowedColors && { allowedColors: surface.allowedColors }),
        layout: surface.layout,
    };
}
