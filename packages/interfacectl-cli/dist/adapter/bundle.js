import fs from "node:fs";
import path from "node:path";
export const SUPPORTED_BUNDLE_VERSION = "2.0";
export class AdapterInputError extends Error {
    code;
    meta;
    constructor(message, details = {}) {
        super(message);
        this.name = "AdapterInputError";
        this.code = details.code ?? "adapter.input";
        this.meta = details.meta;
    }
}
export function isAdapterInputError(error) {
    return error instanceof AdapterInputError;
}
export function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
export function readJsonFile(filePath, label) {
    try {
        const raw = fs.readFileSync(filePath, "utf8");
        const parsed = JSON.parse(raw);
        if (!isRecord(parsed)) {
            throw new Error(`${label} JSON must be an object.`);
        }
        return parsed;
    }
    catch (error) {
        throw new AdapterInputError(`Failed to read ${label} JSON at ${filePath}: ${error.message}`);
    }
}
export function ensureReadableFile(filePath, label) {
    if (!fs.existsSync(filePath)) {
        throw new AdapterInputError(`${label} file not found at ${filePath}.`);
    }
    if (!fs.statSync(filePath).isFile()) {
        throw new AdapterInputError(`${label} path is not a file: ${filePath}.`);
    }
}
export function ensureReadableDirectory(dirPath, label) {
    if (!fs.existsSync(dirPath)) {
        throw new AdapterInputError(`${label} directory not found at ${dirPath}.`);
    }
    if (!fs.statSync(dirPath).isDirectory()) {
        throw new AdapterInputError(`${label} path is not a directory: ${dirPath}.`);
    }
}
function getNestedString(record, key) {
    if (!record)
        return undefined;
    const value = record[key];
    return typeof value === "string" && value.length > 0 ? value : undefined;
}
export function loadCompiledSurfaceBundle(bundleRootInput, surfaceId, cwd) {
    const bundleRoot = path.resolve(cwd, bundleRootInput);
    ensureReadableDirectory(bundleRoot, "Bundle root");
    const manifestPath = path.join(bundleRoot, "manifest.json");
    ensureReadableFile(manifestPath, "Bundle manifest");
    const manifest = readJsonFile(manifestPath, "bundle manifest");
    if (manifest.bundleVersion !== SUPPORTED_BUNDLE_VERSION) {
        throw new AdapterInputError(`Unsupported bundle version "${manifest.bundleVersion ?? "unknown"}". Expected ${SUPPORTED_BUNDLE_VERSION}.`, { code: "adapter.bundle.version-unsupported" });
    }
    const surfaceDir = path.join(bundleRoot, "surfaces", surfaceId);
    ensureReadableDirectory(surfaceDir, "Surface bundle");
    const generationPath = path.join(surfaceDir, "generation.json");
    const sectionsPath = path.join(surfaceDir, "sections.json");
    const componentsPath = path.join(surfaceDir, "components.json");
    const constraintsPath = path.join(surfaceDir, "constraints.json");
    const repairMapPath = path.join(surfaceDir, "repair-map.json");
    for (const [filePath, label] of [
        [generationPath, "generation entrypoint"],
        [sectionsPath, "sections bundle"],
        [componentsPath, "components bundle"],
        [constraintsPath, "constraints bundle"],
        [repairMapPath, "repair map"],
    ]) {
        ensureReadableFile(filePath, label);
    }
    const generation = {
        path: generationPath,
        value: readJsonFile(generationPath, "generation entrypoint"),
    };
    const sections = {
        path: sectionsPath,
        value: readJsonFile(sectionsPath, "sections bundle"),
    };
    const components = {
        path: componentsPath,
        value: readJsonFile(componentsPath, "components bundle"),
    };
    const constraints = {
        path: constraintsPath,
        value: readJsonFile(constraintsPath, "constraints bundle"),
    };
    const repairMap = {
        path: repairMapPath,
        value: readJsonFile(repairMapPath, "repair map"),
    };
    const refs = isRecord(generation.value.refs) ? generation.value.refs : {};
    const contractRef = typeof refs.contract === "string" && refs.contract.trim().length > 0
        ? refs.contract
        : "../../contract/normalized.json";
    const contractPath = path.resolve(path.dirname(generationPath), contractRef);
    ensureReadableFile(contractPath, "Compiled contract");
    const contract = {
        path: contractPath,
        value: readJsonFile(contractPath, "Compiled contract"),
    };
    let authoring;
    if (typeof refs.authoring === "string" && refs.authoring.trim().length > 0) {
        const authoringPath = path.resolve(path.dirname(generationPath), refs.authoring);
        ensureReadableFile(authoringPath, "Authoring bundle");
        authoring = {
            path: authoringPath,
            value: readJsonFile(authoringPath, "Authoring bundle"),
        };
    }
    const generationProvenance = isRecord(generation.value.provenance)
        ? generation.value.provenance
        : undefined;
    const contractId = typeof manifest.contractId === "string" && manifest.contractId.length > 0
        ? manifest.contractId
        : getNestedString(generationProvenance, "contractId") ??
            getNestedString(contract.value, "contractId") ??
            "unknown";
    const contractVersion = typeof manifest.contractVersion === "string" && manifest.contractVersion.length > 0
        ? manifest.contractVersion
        : getNestedString(generationProvenance, "contractVersion") ??
            getNestedString(contract.value, "version") ??
            "unknown";
    return {
        root: bundleRoot,
        version: SUPPORTED_BUNDLE_VERSION,
        contractId,
        contractVersion,
        manifest: {
            path: manifestPath,
            value: manifest,
        },
        contract,
        surface: {
            id: surfaceId,
            dir: surfaceDir,
            generation,
            sections,
            components,
            constraints,
            repairMap,
            ...(authoring ? { authoring } : {}),
        },
    };
}
