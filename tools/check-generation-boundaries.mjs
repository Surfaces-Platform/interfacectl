#!/usr/bin/env node
/**
 * Pre-emit guardrail: blocks generation when shell-owned primitives are emitted.
 *
 * Inputs:
 *  --contract <path>   (required) contract JSON
 *  --descriptor <path> (required) generated descriptor JSON array
 *
 * Exit codes:
 *  0 = pass
 *  1 = invalid input (missing files/fields)
 *  2 = violation detected
 */
import fs from "node:fs";
import path from "node:path";

function fail(code, msg) {
  console.error(msg);
  process.exit(code);
}

function normalizeRole(role) {
  if (!role) return undefined;
  const r = role.toLowerCase();
  if (r === "nav") return "navigation";
  if (r === "navigation") return "navigation";
  if (r === "auth" || r === "auth-shell" || r === "authwrapper") return "auth-shell";
  if (r === "header") return "header";
  if (r === "footer") return "footer";
  if (r === "sidebar") return "sidebar";
  return r;
}

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (err) {
    fail(1, `Failed to read JSON from ${p}: ${err.message}`);
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    const val = args[i + 1];
    if (!val) fail(1, `Missing value for ${key}`);
    if (key === "--contract") opts.contract = val;
    else if (key === "--descriptor") opts.descriptor = val;
    else fail(1, `Unknown arg: ${key}`);
  }
  if (!opts.contract || !opts.descriptor) {
    fail(1, "Usage: node tools/check-generation-boundaries.mjs --contract <path> --descriptor <path>");
  }
  return opts;
}

function buildBanList(contract, surfaceId) {
  const surface = contract.surfaces.find((s) => s.id === surfaceId);
  if (!surface) return [];
  if (surface.mustNotEmit && surface.mustNotEmit.length > 0) {
    return surface.mustNotEmit.map(normalizeRole).filter(Boolean);
  }
  return (contract.shell?.owns ?? []).map(normalizeRole).filter(Boolean);
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

function main() {
  const { contract: contractPath, descriptor: descriptorPath } = parseArgs();
  const contract = readJson(path.resolve(contractPath));
  const descriptors = readJson(path.resolve(descriptorPath));

  if (!Array.isArray(contract.surfaces)) {
    fail(1, "Contract missing surfaces array.");
  }
  if (!Array.isArray(descriptors)) {
    fail(1, "Descriptor must be an array of per-surface descriptors.");
  }

  const violations = [];

  for (const desc of descriptors) {
    const surfaceId = desc.surfaceId;
    if (!surfaceId) {
      violations.push({ surfaceId: "<unknown>", role: "<unknown>", count: 0, reason: "descriptor missing surfaceId" });
      continue;
    }
    const banList = new Set(buildBanList(contract, surfaceId));
    const surface = contract.surfaces.find((s) => s.id === surfaceId);
    const allowSources = surface?.shellOwnedPrimitiveAllowSources ?? [];
    if (banList.size === 0) continue;
    const primitives = desc.primitives ?? [];
    for (const p of primitives) {
      const primitiveSources = p.sources ?? [];
      const disallowedSources = primitiveSources.filter(
        (source) => !sourceAllowed(source, allowSources),
      );
      const role = normalizeRole(p.role);
      const shouldReport =
        role &&
        banList.has(role) &&
        (p.count ?? 0) > 0 &&
        (primitiveSources.length === 0 || disallowedSources.length > 0);
      if (shouldReport) {
        violations.push({
          surfaceId,
          role,
          count: p.count,
          sources: p.sources ?? [],
          disallowedSources,
          allowSources,
        });
      }
    }
  }

  if (violations.length > 0) {
    console.error("shell-owned-primitive-emitted detected:");
    for (const v of violations) {
      console.error(
        `- surface=${v.surfaceId} role=${v.role} count=${v.count} sources=${(v.sources || []).join(",")} disallowedSources=${(v.disallowedSources || []).join(",")}`,
      );
    }
    process.exit(2);
  }

  process.exit(0);
}

main();
