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
    return surface.mustNotEmit;
  }
  return contract.shell?.owns ?? [];
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
    if (banList.size === 0) continue;
    const primitives = desc.primitives ?? [];
    for (const p of primitives) {
      if (banList.has(p.role) && (p.count ?? 0) > 0) {
        violations.push({
          surfaceId,
          role: p.role,
          count: p.count,
          sources: p.sources ?? [],
        });
      }
    }
  }

  if (violations.length > 0) {
    console.error("shell-owned-primitive-emitted detected:");
    for (const v of violations) {
      console.error(
        `- surface=${v.surfaceId} role=${v.role} count=${v.count} sources=${(v.sources || []).join(",")}`,
      );
    }
    process.exit(2);
  }

  process.exit(0);
}

main();
