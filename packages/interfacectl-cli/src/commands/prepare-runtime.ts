import fs from "node:fs";
import path from "node:path";
import {
  AdapterInputError,
  isRecord,
  loadCompiledSurfaceBundle,
  type JsonRecord,
  type LoadedCompiledSurfaceBundle,
} from "../adapter/bundle.js";
import { stringifyDeterministicJson } from "../utils/deterministic-json.js";

export interface PrepareRuntimeCommandOptions {
  bundleRoot?: string;
  surfaceId?: string;
  outPath?: string;
}

function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
}

function buildSummary(bundle: LoadedCompiledSurfaceBundle) {
  if (!bundle.surface.runtime) {
    throw new AdapterInputError(
      `Bundle for surface "${bundle.surface.id}" does not include runtime.json.`,
      { code: "adapter.bundle.runtime-missing" },
    );
  }

  const runtimeDoc = asRecord(bundle.surface.runtime.value);
  const runtime = asRecord(runtimeDoc.runtime);
  const structure = asRecord(runtime.structure);
  const mutationEnvelope = asRecord(runtime.mutationEnvelope);
  const policySeverities = asRecord(runtime.policySeverities);
  const contexts = Array.isArray(runtime.contexts) ? runtime.contexts : [];
  const requiredSectionIds = asStringArray(structure.requiredSections);
  const mutationMode = asString(mutationEnvelope.mode) ?? "content-only";
  const strictCategories = Object.entries(policySeverities)
    .filter(([, policy]) => policy === "strict")
    .map(([category]) => category);

  const checklist: Array<{ id: string; label: string; detail: string }> = [];
  if (requiredSectionIds.length > 0) {
    checklist.push({
      id: "required-sections",
      label: "Preserve required sections",
      detail: `Runtime must keep sections: ${requiredSectionIds.join(", ")}.`,
    });
  }
  checklist.push({
    id: "mutation-envelope",
    label: "Stay inside the mutation envelope",
    detail: `Allowed runtime mutation mode: ${mutationMode}.`,
  });
  if (strictCategories.length > 0) {
    checklist.push({
      id: "strict-categories",
      label: "Honor strict enforcement categories",
      detail: `Strict categories: ${strictCategories.join(", ")}.`,
    });
  }
  if (contexts.length > 0) {
    checklist.push({
      id: "contexts",
      label: "Apply contextual runtime rules",
      detail: `Context rules: ${contexts.map((context) => asString(asRecord(context).id) ?? "unknown").join(", ")}.`,
    });
  }

  const textParts = [
    requiredSectionIds.length > 0 ? `preserve required sections ${requiredSectionIds.join(", ")}` : undefined,
    `stay within ${mutationMode} mutation scope`,
    strictCategories.length > 0 ? `treat ${strictCategories.join(", ")} as strict runtime categories` : undefined,
    contexts.length > 0 ? `evaluate ${contexts.length} contextual runtime rules` : undefined,
  ].filter((value): value is string => Boolean(value));

  return {
    text: textParts.length > 0
      ? `${textParts.join("; ")}.`
      : "Use the prepared runtime bundle as the authoritative enforcement payload.",
    requiredSectionIds,
    mutationMode,
    strictCategories,
    contextIds: contexts
      .map((context) => asString(asRecord(context).id))
      .filter((value): value is string => Boolean(value)),
    checklist,
  };
}

export function buildPreparedRuntimePayload(bundle: LoadedCompiledSurfaceBundle) {
  if (!bundle.surface.runtime) {
    throw new AdapterInputError(
      `Bundle for surface "${bundle.surface.id}" does not include runtime.json.`,
      { code: "adapter.bundle.runtime-missing" },
    );
  }

  const runtimeDoc = asRecord(bundle.surface.runtime.value);
  const identity = asRecord(runtimeDoc.identity);
  const generation = asRecord(bundle.surface.generation.value);
  const generationRefs = asRecord(generation.refs);

  return {
    surface: {
      surfaceId: asString(identity.surfaceId) ?? bundle.surface.id,
      displayName: asString(identity.displayName) ?? bundle.surface.id,
      type: asString(identity.type) ?? "unknown",
    },
    bundle: {
      root: bundle.root,
      version: bundle.version,
      manifestPath: bundle.manifest.path,
      sourcePaths: {
        contract: bundle.contract.path,
        runtime: bundle.surface.runtime.path,
        generation: bundle.surface.generation.path,
        sections: bundle.surface.sections.path,
        components: bundle.surface.components.path,
        constraints: bundle.surface.constraints.path,
        repairMap: bundle.surface.repairMap.path,
      },
    },
    contract: {
      id: bundle.contractId,
      version: bundle.contractVersion,
      normalizedPath: bundle.contract.path,
    },
    summary: buildSummary(bundle),
    governance: asRecord(runtimeDoc.governance),
    runtime: asRecord(runtimeDoc.runtime),
    evidenceRefs: Array.isArray(generationRefs.evidence) ? generationRefs.evidence : [],
  };
}

export function loadPreparedRuntimePayload(
  bundleRoot: string,
  surfaceId: string,
  cwd = process.cwd(),
) {
  const bundle = loadCompiledSurfaceBundle(bundleRoot, surfaceId, cwd);
  return buildPreparedRuntimePayload(bundle);
}

function writeError(error: AdapterInputError | Error, code: string) {
  process.stderr.write(
    `${JSON.stringify(
      {
        status: "error",
        code,
        error: error.message,
      },
      null,
      2,
    )}\n`,
  );
}

export async function runPrepareRuntimeCommand(
  options: PrepareRuntimeCommandOptions,
): Promise<number> {
  try {
    if (!options.bundleRoot) {
      throw new AdapterInputError("--bundle-root is required.");
    }
    if (!options.surfaceId) {
      throw new AdapterInputError("--surface is required.");
    }

    const payload = loadPreparedRuntimePayload(options.bundleRoot, options.surfaceId, process.cwd());
    const serialized = stringifyDeterministicJson(payload);

    if (options.outPath) {
      const outPath = path.resolve(options.outPath);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, serialized, "utf8");
      return 0;
    }

    process.stdout.write(serialized);
    return 0;
  } catch (error) {
    if (error instanceof AdapterInputError) {
      writeError(error, error.code);
      return 10;
    }

    const internalError = error instanceof Error ? error : new Error(String(error));
    writeError(internalError, "prepare-runtime.internal");
    return 1;
  }
}
