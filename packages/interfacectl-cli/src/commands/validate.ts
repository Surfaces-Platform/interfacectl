import path from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import pc from "picocolors";
import {
  validateContractStructure,
  evaluateContractCompliance,
  getBundledContractSchema,
  type InterfaceContract,
  type ValidationSummary,
  type DriftViolationType,
  type SurfaceFlowDescriptor,
} from "@surfaces/interfacectl-validator";
import {
  collectSurfaceDescriptors,
  type DescriptorIssue,
} from "../descriptors/static-analysis.js";
import { getExitCodeVersion, type ExitCodeVersion } from "../utils/exit-codes.js";
import {
  classifyViolationType,
  getExitCodeForCategory,
  type ViolationCategory,
} from "../utils/violation-classifier.js";

type OutputFormat = "text" | "json";
type FindingSeverity = "error" | "warning";

interface JsonFinding {
  code: string;
  severity: FindingSeverity;
  category: ViolationCategory;
  surface?: string;
  message: string;
  expected?: unknown;
  found?: unknown;
  location?: string;
}

interface JsonResult {
  contractPath: string;
  contractVersion: string | null;
  summary: {
    errors: number;
    warnings: number;
  };
  findings: JsonFinding[];
}

interface TextReporter {
  log: (line?: string) => void;
  warn: (line: string) => void;
  error: (line: string) => void;
  lines: string[];
}

interface InterfacectlConfig {
  surfaceRoots?: Record<string, string>;
  flowDescriptorPaths?: Record<string, string>;
}

export interface ValidateCommandOptions {
  contractPath?: string;
  schemaPath?: string;
  workspaceRoot?: string;
  surfaceFilters?: string[];
  outputFormat?: OutputFormat;
  outputPath?: string;
  configPath?: string;
  configProvided?: boolean;
  exitCodes?: ExitCodeVersion;
}

export async function runValidateCommand(
  options: ValidateCommandOptions,
): Promise<number> {
  const workspaceRoot = path.resolve(
    options.workspaceRoot ?? process.cwd(),
  );
  const contractInput =
    options.contractPath ?? "contracts/surfaces.web.contract.json";
  const contractPath = path.isAbsolute(contractInput)
    ? contractInput
    : path.resolve(workspaceRoot, contractInput);
  const schemaPath = options.schemaPath
    ? path.isAbsolute(options.schemaPath)
      ? options.schemaPath
      : path.resolve(workspaceRoot, options.schemaPath)
    : undefined;
  const outputFormat: OutputFormat = options.outputFormat ?? "text";
  const isJson = outputFormat === "json";
  const outputPath = options.outputPath
    ? path.isAbsolute(options.outputPath)
      ? options.outputPath
      : path.resolve(workspaceRoot, options.outputPath)
    : undefined;
  const configInput =
    options.configPath ?? "interfacectl.config.json";
  const configWasExplicit = Boolean(options.configProvided);
  const configPath = path.isAbsolute(configInput)
    ? configInput
    : path.resolve(workspaceRoot, configInput);
  const textReporter = createTextReporter({
    capture: Boolean(outputPath) && !isJson,
    print: !isJson,
  });

  const findings: JsonFinding[] = [];
  let surfaceRootMap = new Map<string, string>();
  let flowDescriptorPathMap = new Map<string, string>();

  // Determine exit code version
  const exitCodeVersion = getExitCodeVersion({ exitCodes: options.exitCodes });

  const finalize = async (
    exitCode: number,
    contractVersion?: string | null,
  ) => {
    if (isJson) {
      const payload = buildJsonResult(
        contractPath,
        contractVersion ?? null,
        findings,
      );
      const serialized = `${JSON.stringify(payload, null, 2)}\n`;
      if (outputPath) {
        await writeFileWithParents(outputPath, serialized);
      } else {
        process.stdout.write(serialized);
      }
      return exitCode;
    }

    if (outputPath) {
      const contents =
        textReporter.lines.length > 0
          ? `${textReporter.lines.join("\n")}\n`
          : "";
      await writeFileWithParents(outputPath, contents);
    }
    return exitCode;
  };

  const contractSource = await loadJson(contractPath, "contract");
  if (!contractSource.ok) {
    const message = `Failed to read contract JSON: ${contractSource.error}`;
    if (!isJson) {
      printHeader(pc.red("✖ Failed to read contract JSON"), textReporter);
      textReporter.error(pc.red(contractSource.error));
    }
    findings.push({
      code: "contract.read-error",
      severity: "error",
      category: "E0",
      message,
      location: contractPath,
    });
    const e0ExitCode = exitCodeVersion === "v2" ? 10 : 2;
    return finalize(e0ExitCode, null);
  }

  const initialContractVersion = extractContractVersion(contractSource.value);

  const configResult = await loadConfigFile(configPath);
  if (configResult.ok) {
    surfaceRootMap = new Map(
      Object.entries(configResult.config.surfaceRoots ?? {}).map(
        ([surfaceId, surfaceRoot]) => [surfaceId, surfaceRoot],
      ),
    );
    flowDescriptorPathMap = new Map(
      Object.entries(configResult.config.flowDescriptorPaths ?? {}).map(
        ([surfaceId, flowDescriptorPath]) => [surfaceId, flowDescriptorPath],
      ),
    );
  } else if (
    !(configResult.reason === "missing" && !configWasExplicit)
  ) {
    const message = `Failed to load config: ${configResult.error}`;
    if (!isJson) {
      printHeader(pc.red("✖ Failed to load config"), textReporter);
      textReporter.error(pc.red(configResult.error));
    }
    findings.push({
      code: "config.load-error",
      severity: "error",
      category: "E0",
      message,
      location: configPath,
    });
    const e0ExitCode = exitCodeVersion === "v2" ? 10 : 2;
    return finalize(e0ExitCode, initialContractVersion);
  }

  const schemaSource = schemaPath
    ? await loadJson(schemaPath, "schema", true)
    : ({
        ok: true as const,
        value: getBundledContractSchema(),
      } satisfies { ok: true; value: object });

  const schema =
    schemaSource.ok === true ? (schemaSource.value as object) : undefined;

  if (schemaSource.ok === false && !schemaSource.optional) {
    const message = `Failed to read contract schema: ${schemaSource.error}`;
    if (!isJson) {
      printHeader(pc.red("✖ Failed to read contract schema"), textReporter);
      textReporter.error(pc.red(schemaSource.error));
    }
    findings.push({
      code: "contract.schema-load-error",
      severity: "error",
      category: "E0",
      message,
      location: schemaPath,
    });
    const e0ExitCode = exitCodeVersion === "v2" ? 10 : 2;
    return finalize(e0ExitCode, initialContractVersion);
  }

  const structureResult = schema
    ? validateContractStructure(contractSource.value, schema)
    : {
        ok: true,
        errors: [],
        contract: contractSource.value as InterfaceContract,
      };

  if (!structureResult.ok || !structureResult.contract) {
    if (!isJson) {
      printHeader(
        pc.red("✖ Contract schema validation failed (capability gap)"),
        textReporter,
      );
      textReporter.error(
        pc.dim(
          "Schema validation errors indicate the contract structure is not supported by this version of interfacectl.",
        ),
      );
      for (const error of structureResult.errors) {
        textReporter.error(pc.red(`  • ${error}`));
      }
    } else {
      for (const error of structureResult.errors) {
        // Check if this is an additionalProperties error (capability gap)
        const isCapabilityGap = error.includes("Additional property") || 
                                error.includes("is not allowed");
        findings.push({
          code: isCapabilityGap ? "contract.schema-unsupported-field" : "contract.schema-error",
          severity: "error",
          category: "E0",
          message: error,
        });
      }
    }
    const e0ExitCode = exitCodeVersion === "v2" ? 10 : 2;
    return finalize(e0ExitCode, initialContractVersion);
  }

  const contract = structureResult.contract;

  const surfaceFilters = new Set(
    (options.surfaceFilters ?? []).map((value) => value.trim()),
  );

  const structuralDescriptorResult = await collectSurfaceDescriptors({
    workspaceRoot,
    contract,
    surfaceFilters,
    surfaceRootMap,
  });

  if (structuralDescriptorResult.warnings.length > 0) {
    if (!isJson) {
      printHeader(
        pc.yellow("⚠ Surface descriptor warnings"),
        textReporter,
      );
      for (const warning of structuralDescriptorResult.warnings) {
        textReporter.warn(pc.yellow(`  • ${warning.message}`));
      }
    }
    for (const warning of structuralDescriptorResult.warnings) {
      findings.push(issueToFinding(warning, "warning"));
    }
  }

  if (structuralDescriptorResult.errors.length > 0) {
    if (!isJson) {
      printHeader(pc.red("✖ Surface descriptor errors"), textReporter);
      for (const error of structuralDescriptorResult.errors) {
        textReporter.error(pc.red(`  • ${error.message}`));
      }
    }
    for (const error of structuralDescriptorResult.errors) {
      findings.push(issueToFinding(error, "error"));
    }
    const e0ExitCode = exitCodeVersion === "v2" ? 10 : 2;
    return finalize(e0ExitCode, contract.version ?? initialContractVersion);
  }

  const flowDescriptorResult = await loadFlowDescriptorArtifacts({
    workspaceRoot,
    contract,
    surfaceFilters,
    flowDescriptorPathMap,
  });
  if (!flowDescriptorResult.ok) {
    const message = `Failed to load flow descriptor artifact: ${flowDescriptorResult.error}`;
    if (!isJson) {
      printHeader(pc.red("✖ Flow descriptor artifact load failed"), textReporter);
      textReporter.error(pc.red(flowDescriptorResult.error));
    }
    findings.push({
      code: "flow-descriptor.load-error",
      severity: "error",
      category: "E0",
      message,
      surface: flowDescriptorResult.surfaceId,
      location: flowDescriptorResult.path,
    });
    const e0ExitCode = exitCodeVersion === "v2" ? 10 : 2;
    return finalize(e0ExitCode, contract.version ?? initialContractVersion);
  }

  const descriptorsWithFlowArtifacts = structuralDescriptorResult.descriptors.map(
    (descriptor) => {
      const flowDescriptorPath = flowDescriptorResult.paths.get(
        descriptor.surfaceId,
      );
      return {
        ...descriptor,
        flows: flowDescriptorResult.flowsBySurface.get(descriptor.surfaceId),
        flowDescriptorPath,
      };
    },
  );

  const summary = evaluateContractCompliance(
    contract,
    descriptorsWithFlowArtifacts,
  );
  const violationFindings = mapViolationsToFindings(summary);
  findings.push(...violationFindings);

  if (!isJson) {
    printSummary(summary, textReporter);
  }
  // Determine exit code based on violation categories
  let exitCode: number;
  if (violationFindings.length === 0) {
    exitCode = 0;
  } else {
    // Filter to only error-level findings for exit code determination
    const errorFindings = violationFindings.filter((f) => f.severity === "error");
    if (errorFindings.length === 0) {
      exitCode = 0; // Only warnings, don't fail
    } else {
      // Find the highest severity category (E2 > E1)
      let maxCategory: ViolationCategory | null = null;
      for (const finding of errorFindings) {
        const category = finding.category;
        if (category === "E2") {
          maxCategory = "E2";
          break; // E2 is highest, no need to continue
        } else if (category === "E1" && (maxCategory === null || maxCategory === "E1")) {
          maxCategory = "E1";
        }
      }

      if (maxCategory) {
        exitCode = getExitCodeForCategory(maxCategory, exitCodeVersion);
      } else {
        // Fallback (should not happen, but handle gracefully)
        exitCode = exitCodeVersion === "v2" ? 30 : 1;
      }
    }

    // Print deprecation warning for v1
    if (exitCodeVersion === "v1") {
      process.stderr.write(
        "Deprecation: default exit codes will change. Use --exit-codes v2 to opt in.\n",
      );
    }
  }

  return finalize(exitCode, contract.version ?? initialContractVersion);
}

async function loadJson(
  filePath: string,
  label: string,
  optional = false,
): Promise<
  | { ok: true; value: unknown }
  | { ok: false; error: string; optional: boolean }
> {
  try {
    const raw = await readFile(filePath, "utf-8");
    return { ok: true, value: JSON.parse(raw) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      const message = `${label} file not found at ${filePath}`;
      return { ok: false, error: message, optional };
    }
    return {
      ok: false,
      error: `Failed to read ${label} file at ${filePath}: ${
        (error as Error).message
      }`,
      optional,
    };
  }
}

function buildJsonResult(
  contractPath: string,
  contractVersion: string | null,
  findings: JsonFinding[],
): JsonResult {
  const summary = summarizeFindings(findings);
  return { contractPath, contractVersion, summary, findings };
}

function summarizeFindings(findings: JsonFinding[]): {
  errors: number;
  warnings: number;
} {
  let errors = 0;
  let warnings = 0;
  for (const finding of findings) {
    if (finding.severity === "error") {
      errors += 1;
    } else {
      warnings += 1;
    }
  }
  return { errors, warnings };
}

function issueToFinding(
  issue: DescriptorIssue,
  severity: FindingSeverity,
): JsonFinding {
  return {
    code: issue.code,
    severity,
    category: "E0", // Descriptor errors are E0 (artifact invalid)
    surface: issue.surfaceId,
    message: issue.message,
    location: issue.location,
  };
}

function mapViolationsToFindings(
  summary: ValidationSummary,
): JsonFinding[] {
  const findings: JsonFinding[] = [];
  const { contract } = summary;

  const codeMap: Record<DriftViolationType, string> = {
    "unknown-surface": "surface.unknown",
    "descriptor-missing": "descriptor.missing",
    "descriptor-unused": "descriptor.unused",
    "missing-section": "section.missing",
    "unknown-section": "section.unexpected",
    "font-not-allowed": "font.disallowed",
    "color-not-allowed": "color.disallowed",
    "icon-source-not-allowed": "icon.source-disallowed",
    "layout-width-exceeded": "layout.width-exceeded",
    "layout-width-undetermined": "layout.width-undetermined",
    "layout-container-missing": "layout.container-missing",
    "layout-pageframe-container-not-found": "layout.pageframe.container-not-found",
    "layout-pageframe-maxwidth-mismatch": "layout.pageframe.maxwidth-mismatch",
    "layout-pageframe-minwidth-mismatch": "layout.pageframe.minwidth-mismatch",
    "layout-pageframe-padding-mismatch": "layout.pageframe.padding-mismatch",
    "layout-pageframe-selector-unsupported": "layout.pageframe.selector-unsupported",
    "layout-pageframe-non-deterministic-value": "layout.pageframe.non-deterministic-value",
    "layout-pageframe-unextractable-value": "layout.pageframe.unextractable-value",
    "landing-pattern-signal-missing": "landing.pattern.signal-missing",
    "landing-pattern-top-level-missing": "landing.pattern.top-level-missing",
    "landing-pattern-section-order": "landing.pattern.section-order",
    "landing-pattern-section-nested": "landing.pattern.section-nested",
    "landing-pattern-background-mode": "landing.pattern.background-mode",
    "motion-duration-not-allowed": "motion.duration",
    "motion-timing-not-allowed": "motion.timing",
    "descriptor-flows-missing": "descriptor.flows.missing",
    "flow-required-missing": "flow.required.missing",
    "flow-steps-min": "flow.steps.min",
    "flow-steps-required": "flow.steps.required",
    "flow-transition-required": "flow.transition.required",
    "flow-terminal-invalid": "flow.terminal.invalid",
    "shell-owned-primitive-emitted": "shell.primitive.disallowed",
  };

  for (const report of summary.surfaceReports) {
    for (const violation of report.violations) {
      const details = (violation.details ?? {}) as Record<string, unknown>;

      const category = classifyViolationType(violation.type);
      const finding: JsonFinding = {
        code: codeMap[violation.type] ?? violation.type,
        severity: "error",
        category,
        surface: violation.surfaceId,
        message: violation.message,
      };

      if (typeof details.source === "string") {
        finding.location = details.source as string;
      }

      switch (violation.type) {
        case "missing-section": {
          finding.expected = details.sectionId ?? details.requiredSections;
          finding.found = null;
          break;
        }
        case "unknown-section": {
          finding.expected = contract.sections.map((section) => section.id);
          finding.found = details.sectionId;
          break;
        }
        case "font-not-allowed": {
          finding.expected = Array.isArray(details.allowedFonts)
            ? details.allowedFonts
            : undefined;
          finding.found = details.font;
          break;
        }
        case "color-not-allowed": {
          finding.expected = Array.isArray(details.allowedValues)
            ? details.allowedValues
            : undefined;
          finding.found = details.color;
          if (details.policy === "warn") {
            finding.severity = "warning";
          }
          break;
        }
        case "icon-source-not-allowed": {
          finding.expected = Array.isArray(details.allowedSources)
            ? details.allowedSources
            : undefined;
          finding.found = details.iconSource;
          if (details.policy === "warn") {
            finding.severity = "warning";
          }
          break;
        }
        case "descriptor-flows-missing": {
          finding.expected = details.requiredFlowIds;
          finding.found = null;
          if (details.policy === "warn") {
            finding.severity = "warning";
          }
          break;
        }
        case "flow-required-missing": {
          finding.expected = details.flowId;
          finding.found = null;
          if (details.policy === "warn") {
            finding.severity = "warning";
          }
          break;
        }
        case "flow-steps-min": {
          finding.expected = details.minSteps;
          finding.found = details.actualStepCount;
          if (details.policy === "warn") {
            finding.severity = "warning";
          }
          break;
        }
        case "flow-steps-required": {
          finding.expected = details.requiredSteps;
          finding.found = details.missingRequiredSteps;
          if (details.policy === "warn") {
            finding.severity = "warning";
          }
          break;
        }
        case "flow-transition-required": {
          finding.expected = details.requiredTransitions;
          finding.found = details.missingRequiredTransitions;
          if (details.policy === "warn") {
            finding.severity = "warning";
          }
          break;
        }
        case "flow-terminal-invalid": {
          finding.expected = details.terminalSteps;
          finding.found = details.invalidTransitions;
          if (details.policy === "warn") {
            finding.severity = "warning";
          }
          break;
        }
        case "layout-width-undetermined": {
          finding.expected = details.expectedMaxWidth;
          finding.found = null;
          break;
        }
        case "layout-width-exceeded": {
          finding.expected = details.allowedWidth;
          finding.found = details.reportedWidth;
          break;
        }
        case "layout-container-missing": {
          finding.expected =
            details.requiredContainers ?? details.requiredContainer;
          finding.found =
            details.missingContainers ?? details.containerSources;
          break;
        }
        case "layout-pageframe-selector-unsupported": {
          finding.expected = details.supportedSelectors;
          finding.found = details.selector;
          break;
        }
        case "layout-pageframe-container-not-found": {
          finding.expected = details.selector;
          finding.found = null;
          break;
        }
        case "layout-pageframe-maxwidth-mismatch": {
          finding.expected = details.expected;
          finding.found = details.actual;
          break;
        }
        case "layout-pageframe-minwidth-mismatch": {
          finding.expected = details.expected;
          finding.found = details.actual;
          break;
        }
        case "layout-pageframe-padding-mismatch": {
          finding.expected = details.expected;
          finding.found = {
            left: details.actualLeft,
            right: details.actualRight,
          };
          break;
        }
        case "layout-pageframe-non-deterministic-value": {
          finding.expected = details.expected;
          finding.found = details.actual ?? {
            left: details.actualLeft,
            right: details.actualRight,
          };
          break;
        }
        case "layout-pageframe-unextractable-value": {
          finding.expected = details.expected;
          finding.found = details.actual ?? {
            left: details.actualLeft,
            right: details.actualRight,
          };
          break;
        }
        case "landing-pattern-signal-missing": {
          finding.expected = "landing pattern signals";
          finding.found = null;
          if (details.policy === "warn") {
            finding.severity = "warning";
          }
          break;
        }
        case "landing-pattern-top-level-missing": {
          finding.expected = details.expectedTopLevelSections;
          finding.found = details.missingTopLevelSections;
          if (details.policy === "warn") {
            finding.severity = "warning";
          }
          break;
        }
        case "landing-pattern-section-order": {
          finding.expected = details.expectedSectionOrder;
          finding.found = details.foundSectionOrder;
          if (details.policy === "warn") {
            finding.severity = "warning";
          }
          break;
        }
        case "landing-pattern-section-nested": {
          finding.expected = [];
          finding.found = details.nestedSections;
          if (details.policy === "warn") {
            finding.severity = "warning";
          }
          break;
        }
        case "landing-pattern-background-mode": {
          finding.expected = details.expectedBackgroundMode;
          finding.found = details.actualBackgroundMode;
          if (details.policy === "warn") {
            finding.severity = "warning";
          }
          break;
        }
        case "motion-duration-not-allowed": {
          finding.expected = details.allowedDurations;
          finding.found = details.durationMs;
          break;
        }
        case "motion-timing-not-allowed": {
          finding.expected = details.allowedTimingFunctions;
          finding.found = details.timingFunction;
          break;
        }
        case "unknown-surface": {
          finding.expected = contract.surfaces.map((surface) => surface.id);
          finding.found = violation.surfaceId;
          break;
        }
        case "descriptor-missing": {
          finding.expected = details.requiredSections;
          finding.found = null;
          break;
        }
        case "descriptor-unused": {
          finding.expected = contract.surfaces.map((surface) => surface.id);
          finding.found = violation.surfaceId;
          break;
        }
        default:
          break;
      }

      findings.push(finding);
    }
  }

  return findings;
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
    if (surface.flows?.policy === "off" || !surface.flows) {
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

type ConfigLoadResult =
  | { ok: true; config: InterfacectlConfig }
  | { ok: false; reason: "missing" | "invalid"; error: string };

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

function createTextReporter(options: {
  capture: boolean;
  print: boolean;
}): TextReporter {
  const lines: string[] = [];

  const record = (line: string) => {
    if (options.capture) {
      lines.push(line);
    }
  };

  return {
    lines,
    log(line = "") {
      record(line);
      if (options.print) {
        console.log(line);
      }
    },
    warn(line: string) {
      record(line);
      if (options.print) {
        console.warn(line);
      }
    },
    error(line: string) {
      record(line);
      if (options.print) {
        console.error(line);
      }
    },
  };
}

function extractContractVersion(value: unknown): string | null {
  if (
    value &&
    typeof value === "object" &&
    "version" in (value as Record<string, unknown>)
  ) {
    const candidate = (value as { version?: unknown }).version;
    return typeof candidate === "string" ? candidate : null;
  }
  return null;
}

function printSummary(
  summary: ValidationSummary,
  output: TextReporter,
): void {
  const violations = summary.surfaceReports.flatMap((report) => report.violations);

  if (violations.length === 0) {
    printHeader(pc.green("✔ All surfaces comply with the contract"), output);
    for (const report of summary.surfaceReports) {
      output.log(pc.green(`  • ${report.surfaceId} ✅`));
    }
    return;
  }

  printHeader(pc.red("✖ Surface compliance violations detected"), output);
  output.log(
    pc.dim("Compliance violations indicate surfaces do not match the contract requirements."),
  );

  for (const report of summary.surfaceReports) {
    if (report.violations.length === 0) {
      output.log(pc.green(`  • ${report.surfaceId}: OK`));
      continue;
    }

    output.log(pc.red(`  • ${report.surfaceId}:`));
    for (const violation of report.violations) {
      output.log(pc.red(`      - ${violation.message}`));
      if (violation.details) {
        output.log(
          pc.dim(
            `        details: ${JSON.stringify(
              violation.details,
              null,
              2,
            ).replaceAll("\n", "\n        ")}`,
          ),
        );
      }
    }
  }
}

function printHeader(message: string, output: TextReporter): void {
  output.log();
  output.log(message);
}
