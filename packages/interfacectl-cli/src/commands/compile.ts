import path from "node:path";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { InterfaceContract, ContractSurface } from "@surfaces/interfacectl-validator";
import {
  validateContractStructure,
  getBundledContractSchema,
} from "@surfaces/interfacectl-validator";
import { normalizeContract } from "../utils/normalize.js";

const BUNDLE_VERSION = "1.0";

/** Stable constant for manifest.schemaVersion. Deterministic: no paths, mtimes, or env. When a custom schema is supplied, inputs.schemaPath records it. */
const SCHEMA_VERSION = "surfaces.web.contract@1";

export interface CompileCommandOptions {
  contractPath: string;
  outDir: string;
  schemaPath?: string;
  format?: "json";
}

interface ManifestInputs {
  contractPath: string;
  schemaPath: string | null;
}

interface ManifestFileEntry {
  path: string;
  sha256: string;
}

interface Manifest {
  bundleVersion: string;
  contractId: string;
  contractVersion: string;
  schemaVersion: string;
  tool: { name: string; version: string };
  inputs: ManifestInputs;
  files: ManifestFileEntry[];
}

/**
 * Recursively sort object keys for deterministic JSON output.
 * Array element order is preserved; only object keys are sorted.
 */
function sortKeysRecursive(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sortKeysRecursive);
  }
  if (typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[k] = sortKeysRecursive((value as Record<string, unknown>)[k]);
    }
    return sorted;
  }
  return value;
}

/**
 * Serialize value to JSON with stable key ordering and readable indent.
 */
function stringifyDeterministic(value: unknown): string {
  return `${JSON.stringify(sortKeysRecursive(value), null, 2)}\n`;
}

function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Write content to file atomically (write to .tmp then rename).
 */
async function writeAtomic(
  filePath: string,
  content: string,
): Promise<void> {
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  await writeFile(tmpPath, content, "utf8");
  await rename(tmpPath, filePath);
}

export async function runCompileCommand(
  options: CompileCommandOptions,
  toolVersion: string,
): Promise<number> {
  const outDir = path.resolve(options.outDir);
  const contractInput = path.resolve(options.contractPath);
  const schemaPath = options.schemaPath
    ? path.resolve(options.schemaPath)
    : undefined;

  let contractRaw: string;
  try {
    contractRaw = await readFile(contractInput, "utf8");
  } catch (err) {
    const message = (err as NodeJS.ErrnoException).code === "ENOENT"
      ? `Contract file not found: ${contractInput}`
      : `Failed to read contract: ${(err as Error).message}`;
    console.error(message);
    return 1;
  }

  let contractData: unknown;
  try {
    contractData = JSON.parse(contractRaw);
  } catch (err) {
    console.error(`Invalid contract JSON: ${(err as Error).message}`);
    return 1;
  }

  let schema: object;
  if (schemaPath) {
    try {
      const raw = await readFile(schemaPath, "utf8");
      schema = JSON.parse(raw) as object;
    } catch (err) {
      const message = (err as NodeJS.ErrnoException).code === "ENOENT"
        ? `Schema file not found: ${schemaPath}`
        : `Failed to read schema: ${(err as Error).message}`;
      console.error(message);
      return 1;
    }
  } else {
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
  const bundleFiles: { path: string; content: string }[] = [
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
    const motionContent = stringifyDeterministic(
      normalizedContract.constraints.motion,
    );
    bundleFiles.push({
      path: "constraints/motion.json",
      content: motionContent,
    });
  }

  const filesSorted = [...bundleFiles].sort((a, b) =>
    a.path.localeCompare(b.path),
  );
  const fileEntries: ManifestFileEntry[] = filesSorted.map(({ path: p, content }) => ({
    path: p,
    sha256: sha256Hex(content),
  }));

  const manifest: Manifest = {
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
  } catch (err) {
    console.error(`Failed to write bundle: ${(err as Error).message}`);
    return 1;
  }

  return 0;
}

function surfaceToBundlePayload(surface: ContractSurface): Record<string, unknown> {
  return {
    id: surface.id,
    displayName: surface.displayName,
    type: surface.type,
    requiredSections: surface.requiredSections,
    allowedFonts: surface.allowedFonts,
    layout: surface.layout,
    ...(surface.icons ? { icons: surface.icons } : {}),
    ...(surface.flows ? { flows: surface.flows } : {}),
  };
}
