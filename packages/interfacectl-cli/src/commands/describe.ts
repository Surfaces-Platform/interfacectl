import path from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import {
  validateContractStructure,
  getBundledContractSchema,
  type InterfaceContract,
} from "@surfaces/interfacectl-validator";
import { collectSurfaceDescriptors } from "../descriptors/static-analysis.js";

interface InterfacectlConfig {
  surfaceRoots?: Record<string, string>;
}

export interface DescribeCommandOptions {
  contractPath: string;
  schemaPath?: string;
  root?: string;
  surface?: string[];
  out: string;
  configPath?: string;
}

interface ConfigLoadResult {
  ok: boolean;
  config?: InterfacectlConfig;
  error?: string;
  reason?: "missing" | "invalid";
}

async function loadConfigFile(configPath: string): Promise<ConfigLoadResult> {
  try {
    const raw = await readFile(configPath, "utf-8");
    const parsed = JSON.parse(raw) as InterfacectlConfig;
    if (!parsed || typeof parsed !== "object") {
      throw new Error("Config must be a JSON object");
    }
    return { ok: true, config: parsed };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        ok: false,
        reason: "missing",
        error: `Config file not found at ${configPath}`,
      };
    }
    const message =
      error instanceof SyntaxError
        ? `Config file at ${configPath} is not valid JSON: ${error.message}`
        : `Failed to read config file at ${configPath}: ${
            (error as Error).message
          }`;
    return {
      ok: false,
      reason: "invalid",
      error: message,
    };
  }
}

async function loadJson(
  filePath: string,
  label: string,
): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  try {
    const raw = await readFile(filePath, "utf-8");
    return { ok: true, value: JSON.parse(raw) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      const message = `${label} file not found at ${filePath}`;
      return { ok: false, error: message };
    }
    return {
      ok: false,
      error: `Failed to read ${label} file at ${filePath}: ${
        (error as Error).message
      }`,
    };
  }
}

async function writeFileWithParents(
  filePath: string,
  contents: string,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents, "utf8");
}

/**
 * Produce descriptor(s) with primitives for pre-emit guard (check-generation-boundaries).
 * Output format: array of { surfaceId, primitives, sections, fonts, colors, layout, motion }.
 */
export async function runDescribeCommand(
  options: DescribeCommandOptions,
): Promise<number> {
  const cwd = process.cwd();
  const workspaceRoot = path.resolve(options.root ?? cwd);
  const contractPath = path.isAbsolute(options.contractPath)
    ? options.contractPath
    : path.resolve(cwd, options.contractPath);
  const outPath = path.isAbsolute(options.out)
    ? options.out
    : path.resolve(workspaceRoot, options.out);
  const configPath = path.resolve(
    workspaceRoot,
    options.configPath ?? "interfacectl.config.json",
  );
  const schemaPath = options.schemaPath
    ? path.isAbsolute(options.schemaPath)
      ? options.schemaPath
      : path.resolve(workspaceRoot, options.schemaPath)
    : undefined;

  const contractSource = await loadJson(contractPath, "contract");
  if (contractSource.ok === false) {
    console.error(`Error: ${contractSource.error}`);
    return 1;
  }

  const schemaSource = schemaPath
    ? await loadJson(schemaPath, "schema")
    : { ok: true as const, value: getBundledContractSchema() };
  if (schemaSource.ok === false) {
    console.error(`Error: ${schemaSource.error}`);
    return 1;
  }

  const schema = schemaSource.value as object;
  const structureResult = validateContractStructure(
    contractSource.value,
    schema,
  );

  if (!structureResult.ok || !structureResult.contract) {
    console.error("Contract schema validation failed:");
    for (const err of structureResult.errors ?? []) {
      console.error(`  • ${err}`);
    }
    return 1;
  }

  const contract = structureResult.contract as InterfaceContract;

  const configResult = await loadConfigFile(configPath);
  const surfaceRootMap = new Map<string, string>();
  if (configResult.ok && configResult.config?.surfaceRoots) {
    for (const [surfaceId, surfaceRoot] of Object.entries(
      configResult.config.surfaceRoots,
    )) {
      surfaceRootMap.set(surfaceId, surfaceRoot);
    }
  }

  const surfaceFilters = new Set(
    (options.surface ?? []).map((s) => s.trim()).filter(Boolean),
  );

  const descriptorResult = await collectSurfaceDescriptors({
    workspaceRoot,
    contract,
    surfaceFilters,
    surfaceRootMap,
  });

  if (descriptorResult.errors.length > 0) {
    console.error("Surface descriptor errors:");
    for (const err of descriptorResult.errors) {
      console.error(`  • ${err.message}`);
    }
    return 1;
  }

  const descriptors = descriptorResult.descriptors;
  const serialized = `${JSON.stringify(descriptors, null, 2)}\n`;
  await writeFileWithParents(outPath, serialized);

  return 0;
}
