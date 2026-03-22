import path from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import {
  validateContractStructure,
  getBundledContractSchema,
  type InterfaceContract,
  type SurfaceFlowDescriptor,
} from "@surfaces/interfacectl-validator";
import { collectSurfaceDescriptors } from "../descriptors/static-analysis.js";

interface InterfacectlConfig {
  surfaceRoots?: Record<string, string>;
  flowDescriptorPaths?: Record<string, string>;
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

type FlowDescriptorArtifactLoadResult =
  | {
      ok: true;
      flowsBySurface: Map<string, SurfaceFlowDescriptor[]>;
      paths: Map<string, string>;
    }
  | {
      ok: false;
      error: string;
      path: string;
      surfaceId: string;
    };

async function loadFlowDescriptorArtifacts({
  workspaceRoot,
  contract,
  surfaceFilters,
  flowDescriptorPathMap,
}: {
  workspaceRoot: string;
  contract: InterfaceContract;
  surfaceFilters: Set<string>;
  flowDescriptorPathMap: Map<string, string>;
}): Promise<FlowDescriptorArtifactLoadResult> {
  const flowsBySurface = new Map<string, SurfaceFlowDescriptor[]>();
  const paths = new Map<string, string>();

  for (const surface of contract.surfaces) {
    if (!surface.flows || surface.flows.policy === "off") {
      continue;
    }
    if (surfaceFilters.size > 0 && !surfaceFilters.has(surface.id)) {
      continue;
    }

    const configuredPath =
      flowDescriptorPathMap.get(surface.id) ??
      `contracts/generated/${surface.id}.flow-descriptor.json`;
    const absolutePath = path.isAbsolute(configuredPath)
      ? configuredPath
      : path.resolve(workspaceRoot, configuredPath);
    const relativePath = path.isAbsolute(configuredPath)
      ? path.relative(workspaceRoot, configuredPath)
      : configuredPath;

    paths.set(surface.id, relativePath);

    let raw: string;
    try {
      raw = await readFile(absolutePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        continue;
      }
      return {
        ok: false,
        error: `Failed to read flow descriptor for surface "${surface.id}" at ${absolutePath}: ${
          (error as Error).message
        }`,
        path: absolutePath,
        surfaceId: surface.id,
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      return {
        ok: false,
        error: `Flow descriptor for surface "${surface.id}" is not valid JSON at ${absolutePath}: ${
          (error as Error).message
        }`,
        path: absolutePath,
        surfaceId: surface.id,
      };
    }

    if (!Array.isArray(parsed)) {
      return {
        ok: false,
        error: `Flow descriptor for surface "${surface.id}" must be a JSON array at ${absolutePath}.`,
        path: absolutePath,
        surfaceId: surface.id,
      };
    }

    const normalizedFlows: SurfaceFlowDescriptor[] = [];
    for (const [index, entry] of parsed.entries()) {
      if (!entry || typeof entry !== "object") {
        return {
          ok: false,
          error: `Flow descriptor entry ${index} for surface "${surface.id}" must be an object at ${absolutePath}.`,
          path: absolutePath,
          surfaceId: surface.id,
        };
      }
      const entryRecord = entry as Record<string, unknown>;
      const flowIdValue = entryRecord.flowId;

      const flowId = typeof flowIdValue === "string" ? flowIdValue.trim() : "";
      if (!flowId) {
        return {
          ok: false,
          error: `Flow descriptor entry ${index} for surface "${surface.id}" is missing a non-empty flowId at ${absolutePath}.`,
          path: absolutePath,
          surfaceId: surface.id,
        };
      }

      const stepsRaw = entryRecord.steps;
      if (!Array.isArray(stepsRaw)) {
        return {
          ok: false,
          error: `Flow descriptor "${flowId}" for surface "${surface.id}" must include steps[] at ${absolutePath}.`,
          path: absolutePath,
          surfaceId: surface.id,
        };
      }
      const steps: { id: string }[] = [];
      for (const [stepIndex, step] of stepsRaw.entries()) {
        const stepRecord =
          step && typeof step === "object"
            ? (step as Record<string, unknown>)
            : undefined;
        const stepIdValue = stepRecord?.id;
        const stepId =
          typeof stepIdValue === "string" ? stepIdValue.trim() : "";
        if (!stepId) {
          return {
            ok: false,
            error: `Flow descriptor "${flowId}" step ${stepIndex} for surface "${surface.id}" must include non-empty id at ${absolutePath}.`,
            path: absolutePath,
            surfaceId: surface.id,
          };
        }
        steps.push({ id: stepId });
      }

      const transitionsRaw = entryRecord.transitions;
      if (!Array.isArray(transitionsRaw)) {
        return {
          ok: false,
          error: `Flow descriptor "${flowId}" for surface "${surface.id}" must include transitions[] at ${absolutePath}.`,
          path: absolutePath,
          surfaceId: surface.id,
        };
      }
      const transitions: { from: string; to: string }[] = [];
      for (const [transitionIndex, transition] of transitionsRaw.entries()) {
        const transitionRecord =
          transition && typeof transition === "object"
            ? (transition as Record<string, unknown>)
            : undefined;
        const fromValue = transitionRecord?.from;
        const toValue = transitionRecord?.to;
        const from = typeof fromValue === "string" ? fromValue.trim() : "";
        const to = typeof toValue === "string" ? toValue.trim() : "";
        if (!from || !to) {
          return {
            ok: false,
            error: `Flow descriptor "${flowId}" transition ${transitionIndex} for surface "${surface.id}" must include non-empty from/to at ${absolutePath}.`,
            path: absolutePath,
            surfaceId: surface.id,
          };
        }
        transitions.push({ from, to });
      }
      const sourceValue = entryRecord.source;

      normalizedFlows.push({
        flowId,
        steps,
        transitions,
        source: typeof sourceValue === "string" ? sourceValue : relativePath,
      });
    }

    flowsBySurface.set(surface.id, normalizedFlows);
  }

  return { ok: true, flowsBySurface, paths };
}

/**
 * Produce descriptor(s) with primitives for pre-emit guard (check-generation-boundaries).
 * Output format: array of { surfaceId, primitives, sections, fonts, colors, flows, layout, motion }.
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
  const flowDescriptorPathMap = new Map<string, string>();
  if (configResult.ok && configResult.config?.surfaceRoots) {
    for (const [surfaceId, surfaceRoot] of Object.entries(
      configResult.config.surfaceRoots,
    )) {
      surfaceRootMap.set(surfaceId, surfaceRoot);
    }
  }
  if (configResult.ok && configResult.config?.flowDescriptorPaths) {
    for (const [surfaceId, flowDescriptorPath] of Object.entries(
      configResult.config.flowDescriptorPaths,
    )) {
      flowDescriptorPathMap.set(surfaceId, flowDescriptorPath);
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

  const flowDescriptorResult = await loadFlowDescriptorArtifacts({
    workspaceRoot,
    contract,
    surfaceFilters,
    flowDescriptorPathMap,
  });
  if (!flowDescriptorResult.ok) {
    console.error(`Error: ${flowDescriptorResult.error}`);
    return 1;
  }

  const descriptors = descriptorResult.descriptors.map((descriptor) => {
    const artifactFlows = flowDescriptorResult.flowsBySurface.get(descriptor.surfaceId);
    const flowDescriptorPath = flowDescriptorResult.paths.get(descriptor.surfaceId);
    return {
      ...descriptor,
      ...(artifactFlows
        ? {
            flows: artifactFlows,
            flowObservation: {
              source: "flow-descriptor-artifact",
              observedFlowCount: artifactFlows.length,
              ...(flowDescriptorPath ? { location: flowDescriptorPath } : {}),
            },
          }
        : {}),
      ...(flowDescriptorPath ? { flowDescriptorPath } : {}),
    };
  });
  const serialized = `${JSON.stringify(descriptors, null, 2)}\n`;
  await writeFileWithParents(outPath, serialized);

  return 0;
}
