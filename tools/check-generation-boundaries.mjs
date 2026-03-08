#!/usr/bin/env node
/**
 * Pre-emit guardrail: blocks generation when shell-owned primitives are emitted.
 *
 * Inputs:
 *  --contract <path>   (required) contract JSON
 *  --descriptor <path> (required) generated descriptor JSON array
 *  --format <text|json> (optional, default: text)
 *
 * Exit codes:
 *  0 = pass
 *  1 = invalid input (missing files/fields)
 *  2 = violation detected
 */
import fs from "node:fs";
import path from "node:path";

const RAW_COLOR_REGEX = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

function normalizeRole(role) {
  if (!role) return undefined;
  const r = String(role).toLowerCase();
  if (r === "nav") return "navigation";
  if (r === "navigation") return "navigation";
  if (r === "auth" || r === "auth-shell" || r === "authwrapper") return "auth-shell";
  if (r === "header") return "header";
  if (r === "footer") return "footer";
  if (r === "sidebar") return "sidebar";
  return r;
}

function wildcardToRegex(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const regexSource = escaped
    .replace(/\*\*/g, "::DOUBLE_STAR::")
    .replace(/\*/g, "[^/]*")
    .replace(/::DOUBLE_STAR::/g, ".*");
  return new RegExp(`^${regexSource}$`);
}

function sourceMatchesPattern(source, pattern) {
  if (!pattern.includes("*")) return source === pattern;
  return wildcardToRegex(pattern).test(source);
}

function sourceAllowed(source, allowPatterns) {
  return allowPatterns.some((pattern) => sourceMatchesPattern(source, pattern));
}

function isRawColorLiteral(value) {
  const trimmed = String(value ?? "").trim().toLowerCase();
  if (RAW_COLOR_REGEX.test(trimmed)) return true;
  if (/^rgba?\s*\(/.test(trimmed)) return true;
  if (/^hsla?\s*\(/.test(trimmed)) return true;
  return false;
}

function extractCssVarName(value) {
  const match = String(value ?? "").match(/var\((--[^)]+)\)/);
  return match ? match[1] : null;
}

function normalizeColorValue(value) {
  return String(value ?? "").trim().toLowerCase();
}

function buildBanList(contract, surfaceId) {
  const surface = contract.surfaces.find((s) => s.id === surfaceId);
  if (!surface) return [];
  if (surface.mustNotEmit && surface.mustNotEmit.length > 0) {
    return surface.mustNotEmit.map(normalizeRole).filter(Boolean);
  }
  return (contract.shell?.owns ?? []).map(normalizeRole).filter(Boolean);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { format: "text" };
  for (let i = 0; i < args.length; i += 1) {
    const key = args[i];
    if (key === "--contract" || key === "--descriptor" || key === "--format") {
      const val = args[i + 1];
      if (!val) {
        throw new Error(`Missing value for ${key}`);
      }
      if (key === "--contract") opts.contract = val;
      if (key === "--descriptor") opts.descriptor = val;
      if (key === "--format") opts.format = val;
      i += 1;
      continue;
    }
    throw new Error(`Unknown arg: ${key}`);
  }

  if (!opts.contract || !opts.descriptor) {
    throw new Error(
      "Usage: node tools/check-generation-boundaries.mjs --contract <path> --descriptor <path> [--format text|json]",
    );
  }

  if (opts.format !== "text" && opts.format !== "json") {
    throw new Error(`Invalid --format value "${opts.format}". Expected text|json.`);
  }
  return opts;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function makeFinding({
  code,
  severity,
  policy,
  message,
  source,
  evidence,
}) {
  return {
    code,
    severity,
    policy,
    message,
    location: {
      file: source ?? "",
      line: 0,
    },
    evidence: evidence ?? {},
  };
}

function evaluateShellBoundary(contract, descriptors) {
  const findings = [];
  for (const desc of descriptors) {
    const surfaceId = desc?.surfaceId;
    if (!surfaceId) continue;
    const banList = new Set(buildBanList(contract, surfaceId));
    if (banList.size === 0) continue;

    const surface = contract.surfaces.find((s) => s.id === surfaceId);
    const allowSources = surface?.shellOwnedPrimitiveAllowSources ?? [];
    const primitives = Array.isArray(desc?.primitives) ? desc.primitives : [];
    for (const primitive of primitives) {
      const primitiveSources = Array.isArray(primitive?.sources)
        ? primitive.sources.filter((source) => typeof source === "string")
        : [];
      const disallowedSources = primitiveSources.filter(
        (source) => !sourceAllowed(source, allowSources),
      );
      const role = normalizeRole(primitive?.role);
      const count = Number(primitive?.count ?? 0);
      const shouldReport =
        role &&
        banList.has(role) &&
        count > 0 &&
        (primitiveSources.length === 0 || disallowedSources.length > 0);
      if (!shouldReport) continue;

      findings.push(
        makeFinding({
          code: "shell-owned-primitive-emitted",
          severity: "error",
          policy: "strict",
          message: `Shell-owned primitive "${role}" emitted for surface "${surfaceId}".`,
          source: disallowedSources[0] ?? primitiveSources[0] ?? "",
          evidence: {
            source: "generationGuard",
            surfaceId,
            role,
            count,
            sources: primitiveSources,
            disallowedSources,
            allowSources,
          },
        }),
      );
    }
  }
  return findings;
}

function evaluateColorPolicyCanonical(contract, descriptors) {
  const findings = [];
  const colorPolicy = contract?.color;
  if (!colorPolicy || typeof colorPolicy !== "object") {
    return { findings, evaluated: false };
  }
  const policy = colorPolicy.policy;
  const allowedValues = Array.isArray(colorPolicy.allowedValues)
    ? colorPolicy.allowedValues
    : [];
  if ((policy !== "off" && policy !== "warn" && policy !== "strict") || allowedValues.length === 0) {
    return { findings, evaluated: false };
  }

  if (policy === "off") {
    return { findings, evaluated: true };
  }

  const allowedSet = new Set(allowedValues.map((value) => normalizeColorValue(value)));
  for (const desc of descriptors) {
    const surfaceId = desc?.surfaceId;
    if (!surfaceId) continue;
    const colors = Array.isArray(desc?.colors) ? desc.colors : [];
    for (const color of colors) {
      const value = typeof color?.value === "string" ? color.value : "";
      if (!value) continue;
      const normalized = normalizeColorValue(value);
      if (allowedSet.has(normalized)) continue;

      findings.push(
        makeFinding({
          code: "color.disallowed",
          severity: policy === "strict" ? "error" : "warning",
          policy,
          message: `Color "${value}" is not allowed for surface "${surfaceId}".`,
          source: typeof color?.source === "string" ? color.source : "",
          evidence: {
            source: "generationGuard",
            surfaceId,
            value,
            normalizedValue: normalized,
            expected: [...allowedSet],
          },
        }),
      );
    }
  }
  return { findings, evaluated: true };
}

function evaluateColorPolicyLegacy(contract, descriptors) {
  const findings = [];
  const colorPolicy = contract?.color;
  if (!colorPolicy || typeof colorPolicy !== "object") {
    return { findings, evaluated: false };
  }
  const rawPolicy = colorPolicy.rawValues?.policy ?? "off";
  const allowlist = new Set(colorPolicy.rawValues?.allowlist ?? []);
  const denylist = new Set(colorPolicy.rawValues?.denylist ?? []);
  const allowedNamespaces =
    colorPolicy.sourceOfTruth?.type === "tokens"
      ? colorPolicy.sourceOfTruth.tokenNamespaces ?? []
      : [];
  const hasLegacyShape =
    rawPolicy === "off" ||
    rawPolicy === "warn" ||
    rawPolicy === "strict" ||
    allowlist.size > 0 ||
    denylist.size > 0 ||
    allowedNamespaces.length > 0;
  if (!hasLegacyShape) {
    return { findings, evaluated: false };
  }

  for (const desc of descriptors) {
    const surfaceId = desc?.surfaceId;
    if (!surfaceId) continue;
    const colors = Array.isArray(desc?.colors) ? desc.colors : [];
    for (const color of colors) {
      const colorValue = typeof color?.value === "string" ? color.value : "";
      const source = typeof color?.source === "string" ? color.source : "";
      if (!colorValue) continue;

      if (denylist.has(colorValue)) {
        findings.push(
          makeFinding({
            code: "color.rawValues.denylist",
            severity: "error",
            policy: rawPolicy === "warn" || rawPolicy === "off" ? "warn" : "strict",
            message: `Raw color "${colorValue}" is denylisted.`,
            source,
            evidence: {
              source: "generationGuard",
              surfaceId,
              value: colorValue,
            },
          }),
        );
        continue;
      }

      const varName = extractCssVarName(colorValue);
      if (varName) {
        if (allowedNamespaces.length > 0) {
          const hasAllowedNamespace = allowedNamespaces.some((namespace) =>
            varName.startsWith(namespace),
          );
          if (!hasAllowedNamespace) {
            findings.push(
              makeFinding({
                code: "color.token.namespace",
                severity: "warning",
                policy: "warn",
                message: `Token "${varName}" does not match allowed namespaces: ${allowedNamespaces.join(", ")}.`,
                source,
                evidence: {
                  source: "generationGuard",
                  surfaceId,
                  value: varName,
                },
              }),
            );
          }
        }
        continue;
      }

      if (!isRawColorLiteral(colorValue)) continue;
      if (allowlist.has(colorValue)) continue;

      if (rawPolicy === "strict") {
        findings.push(
          makeFinding({
            code: "color.rawValues",
            severity: "error",
            policy: "strict",
            message: `Raw color "${colorValue}" violates strict rawValues policy.`,
            source,
            evidence: {
              source: "generationGuard",
              surfaceId,
              value: colorValue,
            },
          }),
        );
      } else if (rawPolicy === "warn") {
        findings.push(
          makeFinding({
            code: "color.rawValues",
            severity: "warning",
            policy: "warn",
            message: `Raw color "${colorValue}" detected (warn policy).`,
            source,
            evidence: {
              source: "generationGuard",
              surfaceId,
              value: colorValue,
            },
          }),
        );
      }
    }
  }
  return { findings, evaluated: true };
}

function evaluateIconPolicy(contract, descriptors) {
  const findings = [];
  let evaluated = false;
  const surfaces = Array.isArray(contract?.surfaces) ? contract.surfaces : [];

  for (const desc of descriptors) {
    const surfaceId = desc?.surfaceId;
    if (!surfaceId) continue;
    const surface = surfaces.find((entry) => entry.id === surfaceId);
    const iconPolicy = surface?.icons;
    if (!iconPolicy || iconPolicy.policy === "off") continue;
    if (iconPolicy.policy !== "warn" && iconPolicy.policy !== "strict") continue;
    evaluated = true;

    const descriptorHasIcons = Array.isArray(desc?.icons);
    if (!descriptorHasIcons) {
      findings.push(
        makeFinding({
          code: "descriptor.icons.missing",
          severity: iconPolicy.policy === "strict" ? "error" : "warning",
          policy: iconPolicy.policy,
          message: `Descriptor for surface "${surfaceId}" is missing icons[] while icon policy is "${iconPolicy.policy}".`,
          source: "",
          evidence: {
            source: "generationGuard",
            surfaceId,
            expected: "icons[]",
          },
        }),
      );
      continue;
    }

    const allowedSources = new Set(
      Array.isArray(iconPolicy.allowedSources)
        ? iconPolicy.allowedSources.map((value) => String(value).trim()).filter(Boolean)
        : [],
    );
    const seen = new Set();
    for (const icon of desc.icons) {
      const iconSource = typeof icon?.value === "string" ? icon.value.trim() : "";
      if (!iconSource || seen.has(iconSource)) continue;
      seen.add(iconSource);
      if (allowedSources.has(iconSource)) continue;

      findings.push(
        makeFinding({
          code: "icon.source-disallowed",
          severity: iconPolicy.policy === "strict" ? "error" : "warning",
          policy: iconPolicy.policy,
          message: `Icon source "${iconSource}" is not allowed for surface "${surfaceId}".`,
          source: typeof icon?.source === "string" ? icon.source : "",
          evidence: {
            source: "generationGuard",
            surfaceId,
            iconSource,
            expected: [...allowedSources],
          },
        }),
      );
    }
  }
  return { findings, evaluated };
}

function evaluateFlowPolicy(contract, descriptors) {
  const findings = [];
  let evaluated = false;
  const surfaces = Array.isArray(contract?.surfaces) ? contract.surfaces : [];

  for (const desc of descriptors) {
    const surfaceId = desc?.surfaceId;
    if (!surfaceId) continue;

    const surface = surfaces.find((entry) => entry.id === surfaceId);
    const flowPolicy = surface?.flows;
    if (!flowPolicy || flowPolicy.policy === "off") continue;
    if (flowPolicy.policy !== "warn" && flowPolicy.policy !== "strict") continue;
    evaluated = true;

    const requirements = Array.isArray(flowPolicy.requirements)
      ? flowPolicy.requirements
      : [];
    const flowDescriptorPath =
      typeof desc?.flowDescriptorPath === "string" ? desc.flowDescriptorPath : "";
    if (!Array.isArray(desc?.flows)) {
      findings.push(
        makeFinding({
          code: "descriptor.flows.missing",
          severity: flowPolicy.policy === "strict" ? "error" : "warning",
          policy: flowPolicy.policy,
          message: `Descriptor for surface "${surfaceId}" is missing flows[] while flow policy is "${flowPolicy.policy}".`,
          source: flowDescriptorPath,
          evidence: {
            source: "generationGuard",
            surfaceId,
            expected: "flows[]",
            flowDescriptorPath,
          },
        }),
      );
      continue;
    }

    const descriptorFlows = new Map(
      desc.flows
        .map((flow) => [
          typeof flow?.flowId === "string" ? flow.flowId.trim() : "",
          flow,
        ])
        .filter(([flowId]) => flowId.length > 0),
    );

    for (const requirement of requirements) {
      const flowId =
        typeof requirement?.flowId === "string" ? requirement.flowId.trim() : "";
      if (!flowId) continue;

      const flow = descriptorFlows.get(flowId);
      if (!flow) {
        findings.push(
          makeFinding({
            code: "flow.required.missing",
            severity: flowPolicy.policy === "strict" ? "error" : "warning",
            policy: flowPolicy.policy,
            message: `Flow "${flowId}" is required but missing for surface "${surfaceId}".`,
            source: flowDescriptorPath,
            evidence: {
              source: "generationGuard",
              surfaceId,
              flowId,
              flowDescriptorPath,
            },
          }),
        );
        continue;
      }

      const flowSource =
        typeof flow?.source === "string" && flow.source.trim().length > 0
          ? flow.source
          : flowDescriptorPath;
      const stepIds = new Set(
        (Array.isArray(flow?.steps) ? flow.steps : [])
          .map((step) =>
            typeof step?.id === "string" ? step.id.trim() : "",
          )
          .filter(Boolean),
      );
      const transitions = (Array.isArray(flow?.transitions) ? flow.transitions : [])
        .map((transition) => ({
          from: typeof transition?.from === "string" ? transition.from.trim() : "",
          to: typeof transition?.to === "string" ? transition.to.trim() : "",
        }))
        .filter((transition) => transition.from && transition.to);
      const transitionKeys = new Set(
        transitions.map((transition) => `${transition.from}->${transition.to}`),
      );

      const minSteps =
        typeof requirement?.minSteps === "number"
          ? Math.trunc(requirement.minSteps)
          : undefined;
      if (typeof minSteps === "number" && stepIds.size < minSteps) {
        findings.push(
          makeFinding({
            code: "flow.steps.min",
            severity: flowPolicy.policy === "strict" ? "error" : "warning",
            policy: flowPolicy.policy,
            message: `Flow "${flowId}" has ${stepIds.size} step(s); minimum is ${minSteps}.`,
            source: flowSource,
            evidence: {
              source: "generationGuard",
              surfaceId,
              flowId,
              minSteps,
              actualStepCount: stepIds.size,
              stepIds: [...stepIds],
            },
          }),
        );
      }

      const requiredSteps = Array.isArray(requirement?.requiredSteps)
        ? requirement.requiredSteps
            .map((step) => String(step).trim())
            .filter(Boolean)
        : [];
      const missingRequiredSteps = requiredSteps.filter(
        (step) => !stepIds.has(step),
      );
      if (missingRequiredSteps.length > 0) {
        findings.push(
          makeFinding({
            code: "flow.steps.required",
            severity: flowPolicy.policy === "strict" ? "error" : "warning",
            policy: flowPolicy.policy,
            message: `Flow "${flowId}" is missing required step(s): ${missingRequiredSteps.join(", ")}.`,
            source: flowSource,
            evidence: {
              source: "generationGuard",
              surfaceId,
              flowId,
              requiredSteps,
              missingRequiredSteps,
            },
          }),
        );
      }

      const requiredTransitions = Array.isArray(requirement?.requiredTransitions)
        ? requirement.requiredTransitions
            .map((transition) => ({
              from: String(transition?.from ?? "").trim(),
              to: String(transition?.to ?? "").trim(),
            }))
            .filter((transition) => transition.from && transition.to)
        : [];
      const missingTransitions = requiredTransitions.filter(
        (transition) =>
          !transitionKeys.has(`${transition.from}->${transition.to}`),
      );
      if (missingTransitions.length > 0) {
        findings.push(
          makeFinding({
            code: "flow.transition.required",
            severity: flowPolicy.policy === "strict" ? "error" : "warning",
            policy: flowPolicy.policy,
            message: `Flow "${flowId}" is missing required transition(s).`,
            source: flowSource,
            evidence: {
              source: "generationGuard",
              surfaceId,
              flowId,
              requiredTransitions,
              missingRequiredTransitions: missingTransitions,
            },
          }),
        );
      }

      const terminalSteps = Array.isArray(requirement?.terminalSteps)
        ? requirement.terminalSteps
            .map((step) => String(step).trim())
            .filter(Boolean)
        : [];
      const invalidTransitions = transitions.filter((transition) =>
        terminalSteps.includes(transition.from),
      );
      if (invalidTransitions.length > 0) {
        findings.push(
          makeFinding({
            code: "flow.terminal.invalid",
            severity: flowPolicy.policy === "strict" ? "error" : "warning",
            policy: flowPolicy.policy,
            message: `Flow "${flowId}" has outgoing transition(s) from terminal step(s).`,
            source: flowSource,
            evidence: {
              source: "generationGuard",
              surfaceId,
              flowId,
              terminalSteps,
              invalidTransitions,
            },
          }),
        );
      }
    }
  }

  return { findings, evaluated };
}

function summarizeFindings(findings) {
  const blocking = findings.filter((finding) => finding.severity === "error").length;
  const warnings = findings.filter((finding) => finding.severity === "warning").length;
  return {
    blocking,
    warnings,
    total: findings.length,
    status: blocking > 0 ? "block" : warnings > 0 ? "warn" : "pass",
  };
}

function printLegacyText(findings) {
  const primitiveFindings = findings.filter((finding) => finding.code === "shell-owned-primitive-emitted");
  const blockingColorFindings = findings.filter(
    (finding) =>
      finding.code === "color.rawValues.denylist" ||
      (finding.code === "color.rawValues" && finding.severity === "error"),
  );
  const warningColorFindings = findings.filter(
    (finding) =>
      finding.code === "color.token.namespace" ||
      (finding.code === "color.rawValues" && finding.severity === "warning"),
  );

  if (primitiveFindings.length > 0) {
    console.error("shell-owned-primitive-emitted detected:");
    for (const finding of primitiveFindings) {
      const evidence = finding.evidence ?? {};
      console.error(
        `- surface=${evidence.surfaceId || "<unknown>"} role=${evidence.role || "<unknown>"} count=${evidence.count || 0} sources=${(evidence.sources || []).join(",")} disallowedSources=${(evidence.disallowedSources || []).join(",")}`,
      );
    }
  }

  if (blockingColorFindings.length > 0) {
    console.error("color-policy-blocking detected:");
    for (const finding of blockingColorFindings) {
      const evidence = finding.evidence ?? {};
      const source = finding.location?.file ?? "";
      console.error(
        `- surface=${evidence.surfaceId || "<unknown>"} rule=${finding.code} value=${evidence.value || ""} policy=${finding.policy} source=${source} message=${finding.message}`,
      );
    }
  }

  if (warningColorFindings.length > 0) {
    console.error("color-policy-warning detected:");
    for (const finding of warningColorFindings) {
      const evidence = finding.evidence ?? {};
      const source = finding.location?.file ?? "";
      console.error(
        `- surface=${evidence.surfaceId || "<unknown>"} rule=${finding.code} value=${evidence.value || ""} source=${source} message=${finding.message}`,
      );
    }
  }
}

function outputJson(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function failJson(msg) {
  outputJson({
    status: "block",
    findings: [],
    summary: {
      blocking: 0,
      warnings: 0,
      total: 0,
    },
    evaluation: {
      shellBoundaryEvaluated: false,
      colorPolicyEvaluated: false,
      iconPolicyEvaluated: false,
      flowPolicyEvaluated: false,
    },
    error: {
      code: "input.invalid",
      message: msg,
    },
  });
}

function main() {
  let format = "text";
  try {
    const parsed = parseArgs();
    const contractPath = path.resolve(parsed.contract);
    const descriptorPath = path.resolve(parsed.descriptor);
    format = parsed.format;

    const contract = readJson(contractPath);
    const descriptors = readJson(descriptorPath);

    if (!Array.isArray(contract.surfaces)) {
      throw new Error("Contract missing surfaces array.");
    }
    if (!Array.isArray(descriptors)) {
      throw new Error("Descriptor must be an array of per-surface descriptors.");
    }

    const shellFindings = evaluateShellBoundary(contract, descriptors);
    const colorCanonical = evaluateColorPolicyCanonical(contract, descriptors);
    const colorLegacy = colorCanonical.evaluated
      ? { findings: [], evaluated: false }
      : evaluateColorPolicyLegacy(contract, descriptors);
    const iconPolicy = evaluateIconPolicy(contract, descriptors);
    const flowPolicy = evaluateFlowPolicy(contract, descriptors);

    if (format === "text") {
      const legacyFindings = [...shellFindings, ...colorLegacy.findings];
      const summary = summarizeFindings(legacyFindings);
      printLegacyText(legacyFindings);
      process.exit(summary.blocking > 0 ? 2 : 0);
      return;
    }

    const findings = [
      ...shellFindings,
      ...colorCanonical.findings,
      ...colorLegacy.findings,
      ...iconPolicy.findings,
      ...flowPolicy.findings,
    ];
    const summary = summarizeFindings(findings);
    outputJson({
      status: summary.status,
      findings,
      summary: {
        blocking: summary.blocking,
        warnings: summary.warnings,
        total: summary.total,
      },
      evaluation: {
        shellBoundaryEvaluated: true,
        colorPolicyEvaluated: colorCanonical.evaluated || colorLegacy.evaluated,
        iconPolicyEvaluated: iconPolicy.evaluated,
        flowPolicyEvaluated: flowPolicy.evaluated,
      },
    });
    process.exit(summary.blocking > 0 ? 2 : 0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (format === "json") {
      failJson(message);
    } else {
      console.error(message);
    }
    process.exit(1);
  }
}

main();
