import path from "node:path";
import { access, readFile } from "node:fs/promises";
import {
  deriveLegacyContractFromUiAst,
  getBundledContractSchema,
  getBundledUiAstSchema,
  migrateLegacyContractToUiAst,
  validateContractStructure,
  validateUiAstStructure,
  type InterfaceContract,
  type UiSurfaceAst,
} from "@surfaces/interfacectl-validator";

export const DEFAULT_AST_PATH = "contracts/ui.surface.ast.json";
export const DEFAULT_LEGACY_CONTRACT_PATH = "contracts/surfaces.web.contract.json";

export interface ResolvedUiAstInput {
  ast: UiSurfaceAst;
  derivedContract: InterfaceContract;
  sourceKind: "ast" | "legacy-contract";
  sourcePath: string;
  warnings: string[];
}

export interface ResolvedUiAstInputError {
  error: string;
  code: string;
}

interface ResolveUiAstInputOptions {
  workspaceRoot: string;
  astPath?: string;
  contractPath?: string;
  schemaPath?: string;
}

interface JsonLoadResult {
  ok: boolean;
  value?: unknown;
  error?: string;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function loadJson(filePath: string, label: string): Promise<JsonLoadResult> {
  try {
    const raw = await readFile(filePath, "utf8");
    return {
      ok: true,
      value: JSON.parse(raw),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        ok: false,
        error: `${label} file not found at ${filePath}`,
      };
    }
    return {
      ok: false,
      error: `Failed to read ${label} JSON at ${filePath}: ${(error as Error).message}`,
    };
  }
}

function resolveCandidatePath(
  workspaceRoot: string,
  candidate: string | undefined,
): string | undefined {
  if (!candidate) return undefined;
  return path.isAbsolute(candidate)
    ? candidate
    : path.resolve(workspaceRoot, candidate);
}

export async function resolveUiAstInput(
  options: ResolveUiAstInputOptions,
): Promise<ResolvedUiAstInput | ResolvedUiAstInputError> {
  const explicitAstPath = resolveCandidatePath(options.workspaceRoot, options.astPath);
  const explicitContractPath = resolveCandidatePath(options.workspaceRoot, options.contractPath);
  const defaultAstPath = path.resolve(options.workspaceRoot, DEFAULT_AST_PATH);
  const defaultLegacyPath = path.resolve(
    options.workspaceRoot,
    DEFAULT_LEGACY_CONTRACT_PATH,
  );

  let sourcePath: string;
  let sourceKind: "ast" | "legacy-contract";
  const warnings: string[] = [];

  if (explicitAstPath) {
    sourcePath = explicitAstPath;
    sourceKind = "ast";
  } else if (explicitContractPath) {
    sourcePath = explicitContractPath;
    sourceKind = "legacy-contract";
    warnings.push(
      `--contract is deprecated for UI AST v2. Prefer --ast ${DEFAULT_AST_PATH}.`,
    );
  } else if (await fileExists(defaultAstPath)) {
    sourcePath = defaultAstPath;
    sourceKind = "ast";
  } else {
    sourcePath = defaultLegacyPath;
    sourceKind = "legacy-contract";
    warnings.push(
      `Falling back to legacy contract path ${DEFAULT_LEGACY_CONTRACT_PATH}. Migrate to ${DEFAULT_AST_PATH}.`,
    );
  }

  const source = await loadJson(
    sourcePath,
    sourceKind === "ast" ? "UI AST" : "contract",
  );
  if (!source.ok) {
    return {
      error: source.error ?? "Unknown AST input error.",
      code: sourceKind === "ast" ? "ui-ast.load-error" : "contract.load-error",
    };
  }

  if (sourceKind === "ast") {
    const schemaSource = options.schemaPath
      ? await loadJson(
          resolveCandidatePath(options.workspaceRoot, options.schemaPath) ?? options.schemaPath,
          "UI AST schema",
        )
      : { ok: true, value: getBundledUiAstSchema() };
    if (!schemaSource.ok) {
      return {
        error: schemaSource.error ?? "Failed to load UI AST schema.",
        code: "ui-ast.schema-load-error",
      };
    }
    const validated = validateUiAstStructure(source.value, schemaSource.value as object);
    if (!validated.ok || !validated.ast) {
      return {
        error: `UI AST schema validation failed:\n${validated.errors.map((error) => `  • ${error}`).join("\n")}`,
        code: "ui-ast.schema.invalid",
      };
    }
    return {
      ast: validated.ast,
      derivedContract: deriveLegacyContractFromUiAst(validated.ast),
      sourceKind,
      sourcePath,
      warnings,
    };
  }

  const schemaSource = options.schemaPath
    ? await loadJson(
        resolveCandidatePath(options.workspaceRoot, options.schemaPath) ?? options.schemaPath,
        "contract schema",
      )
    : { ok: true, value: getBundledContractSchema() };
  if (!schemaSource.ok) {
    return {
      error: schemaSource.error ?? "Failed to load contract schema.",
      code: "contract.schema-load-error",
    };
  }
  const validated = validateContractStructure(source.value, schemaSource.value as object);
  if (!validated.ok || !validated.contract) {
    return {
      error: `Contract schema validation failed:\n${validated.errors.map((error) => `  • ${error}`).join("\n")}`,
      code: "contract.schema.invalid",
    };
  }
  const ast = migrateLegacyContractToUiAst(validated.contract);
  const astValidation = validateUiAstStructure(ast);
  if (!astValidation.ok || !astValidation.ast) {
    return {
      error: `Generated UI AST draft failed validation:\n${astValidation.errors.map((error) => `  • ${error}`).join("\n")}`,
      code: "ui-ast.migration.invalid",
    };
  }

  return {
    ast: astValidation.ast,
    derivedContract: validated.contract,
    sourceKind,
    sourcePath,
    warnings,
  };
}
