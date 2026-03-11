import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { getExitCodeVersion } from "../utils/exit-codes.js";
const AUTH_ROUTES = ["/auth/login", "/auth/callback", "/auth/session", "/auth/logout"];
function normalizeExtracted(raw) {
    if (!raw || typeof raw !== "object")
        return null;
    const o = raw;
    return {
        routes: Array.isArray(o.routes) ? o.routes.slice().sort() : [],
        hasShell: Boolean(o.hasShell),
        designSystemComponents: Array.isArray(o.designSystemComponents)
            ? o.designSystemComponents.slice().sort()
            : [],
        authAware: Boolean(o.authAware),
    };
}
/**
 * Load extracted reality from extraction report or generated contract.
 * Requires surfaceId from report, or from contract surfaces[0].id, or from --surface.
 */
async function loadExtracted(extractedPath, cwd, explicitSurfaceId) {
    const resolved = path.resolve(cwd, extractedPath);
    const raw = await readFile(resolved, "utf-8");
    const data = JSON.parse(raw);
    if (typeof data.surfaceId === "string" && data.extracted && typeof data.extracted === "object") {
        const extracted = normalizeExtracted(data.extracted);
        if (extracted)
            return { surfaceId: data.surfaceId, extracted };
    }
    const x = data.x_extracted;
    const surfaces = data.surfaces;
    if (x && typeof x === "object") {
        let surfaceId;
        if (Array.isArray(surfaces) && surfaces.length > 0 && typeof surfaces[0].id === "string") {
            surfaceId = surfaces[0].id;
        }
        else if (explicitSurfaceId) {
            surfaceId = explicitSurfaceId;
        }
        if (surfaceId) {
            const extracted = normalizeExtracted(x);
            if (extracted)
                return { surfaceId, extracted };
        }
    }
    return null;
}
function getPhase0ForSurface(contract, surfaceId) {
    const surfaces = contract.surfaces;
    if (!Array.isArray(surfaces))
        return null;
    const surface = surfaces.find((s) => s.id === surfaceId);
    const phase0 = surface?.phase0;
    if (!phase0 || typeof phase0 !== "object")
        return null;
    const p = phase0;
    return {
        authPosture: p.authPosture,
        requiresShell: p.requiresShell,
        expectsAuthRoutes: p.expectsAuthRoutes,
        expectsDesignSystem: p.expectsDesignSystem,
    };
}
function compare(surfaceId, phase0, extracted) {
    const findings = [];
    const routesSet = new Set(extracted.routes);
    const hasAllAuthRoutes = AUTH_ROUTES.every((r) => routesSet.has(r));
    if (phase0.authPosture === "auth-first") {
        if (!extracted.authAware) {
            findings.push({
                surfaceId,
                code: "phase0.authPosture.mismatch",
                category: "E2",
                message: "Contract expects auth-first but extracted authAware is false.",
                expected: "authAware true",
                found: extracted.authAware,
            });
        }
        else if (!hasAllAuthRoutes) {
            findings.push({
                surfaceId,
                code: "phase0.authRoutes.missing",
                category: "E2",
                message: "Contract expects auth-first but extraction is missing one or more auth routes.",
                expected: AUTH_ROUTES,
                found: extracted.routes.filter((r) => AUTH_ROUTES.includes(r)),
            });
        }
    }
    else if (phase0.authPosture === "auth-aware") {
        if (!extracted.authAware) {
            findings.push({
                surfaceId,
                code: "phase0.authPosture.mismatch",
                category: "E2",
                message: "Contract expects auth-aware but extracted authAware is false.",
                expected: "authAware true",
                found: extracted.authAware,
            });
        }
    }
    if (phase0.requiresShell === true && !extracted.hasShell) {
        findings.push({
            surfaceId,
            code: "phase0.shell.mismatch",
            category: "E2",
            message: "Contract requires shell but extraction has hasShell false.",
            expected: true,
            found: extracted.hasShell,
        });
    }
    if (phase0.expectsAuthRoutes === true && !hasAllAuthRoutes) {
        const missing = AUTH_ROUTES.filter((r) => !routesSet.has(r));
        findings.push({
            surfaceId,
            code: "phase0.authRoutes.missing",
            category: "E2",
            message: `Contract expects auth routes; missing: ${missing.join(", ")}.`,
            expected: AUTH_ROUTES,
            found: extracted.routes.filter((r) => AUTH_ROUTES.includes(r)),
        });
    }
    if (phase0.expectsDesignSystem === true && extracted.designSystemComponents.length === 0) {
        findings.push({
            surfaceId,
            code: "phase0.designSystem.missing",
            category: "E2",
            message: "Contract expects design-system usage but extraction found none.",
            expected: "at least one component",
            found: extracted.designSystemComponents,
        });
    }
    return findings;
}
/** Sort findings by surfaceId then code (deterministic). */
function sortFindings(findings) {
    return [...findings].sort((a, b) => {
        const s = a.surfaceId.localeCompare(b.surfaceId);
        return s !== 0 ? s : a.code.localeCompare(b.code);
    });
}
export async function runValidateExtractedCommand(options) {
    const cwd = process.cwd();
    const exitCodeVersion = getExitCodeVersion({ exitCodes: options.exitCodes });
    const format = (options.format ?? "text").toLowerCase() === "json" ? "json" : "text";
    const outputPath = options.outputPath
        ? path.resolve(cwd, options.outputPath)
        : undefined;
    const emit = async (contents, stream = "stdout") => {
        if (outputPath) {
            await mkdir(path.dirname(outputPath), { recursive: true });
            await writeFile(outputPath, contents, "utf-8");
            return;
        }
        if (stream === "stderr") {
            process.stderr.write(contents);
            return;
        }
        process.stdout.write(contents);
    };
    let contract;
    try {
        const contractResolved = path.resolve(cwd, options.contractPath);
        const contractRaw = await readFile(contractResolved, "utf-8");
        contract = JSON.parse(contractRaw);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (format === "json") {
            await emit(`${JSON.stringify({
                ok: false,
                findings: [
                    {
                        surfaceId: "",
                        code: "phase0.load.contract",
                        category: "E0",
                        message: `Failed to load contract: ${message}`,
                    },
                ],
            }, null, 2)}\n`);
        }
        else {
            console.error(`Failed to load contract: ${message}`);
        }
        return exitCodeVersion === "v2" ? 10 : 2;
    }
    let extractedData;
    try {
        extractedData = await loadExtracted(options.extractedPath, cwd, options.surfaceId);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (format === "json") {
            await emit(`${JSON.stringify({
                ok: false,
                findings: [
                    {
                        surfaceId: options.surfaceId ?? "",
                        code: "phase0.load.extracted",
                        category: "E0",
                        message: `Failed to load extracted file: ${message}`,
                    },
                ],
            }, null, 2)}\n`);
        }
        else {
            console.error("Extracted file must be an extraction report (surfaceId + extracted) or a generated contract with x_extracted. Use --surface <id> when surfaceId cannot be inferred.");
            console.error(message);
        }
        return exitCodeVersion === "v2" ? 10 : 2;
    }
    if (!extractedData) {
        if (format === "json") {
            await emit(`${JSON.stringify({
                ok: false,
                findings: [
                    {
                        surfaceId: options.surfaceId ?? "",
                        code: "phase0.load.extracted",
                        category: "E0",
                        message: "Could not parse extracted file or infer surfaceId; provide --surface if using generated contract without surfaces[0].id.",
                    },
                ],
            }, null, 2)}\n`);
        }
        else {
            console.error("Could not parse extracted file or infer surfaceId; provide --surface if using generated contract without surfaces[0].id.");
        }
        return exitCodeVersion === "v2" ? 10 : 2;
    }
    const phase0 = getPhase0ForSurface(contract, extractedData.surfaceId);
    if (!phase0) {
        if (format === "json") {
            await emit(`${JSON.stringify({ ok: true, findings: [], message: "No phase0 block for surface; nothing to compare." }, null, 2)}\n`);
        }
        else {
            console.log(`No phase0 block for surface ${extractedData.surfaceId}; nothing to compare.`);
        }
        return 0;
    }
    const findings = compare(extractedData.surfaceId, phase0, extractedData.extracted);
    const sorted = sortFindings(findings);
    const ok = sorted.length === 0;
    const exitCode = ok ? 0 : exitCodeVersion === "v2" ? 30 : 1;
    if (format === "json") {
        await emit(`${JSON.stringify({ ok, findings: sorted }, null, 2)}\n`);
        return exitCode;
    }
    if (sorted.length === 0) {
        console.log(`No incompatibilities for surface ${extractedData.surfaceId}.`);
        return 0;
    }
    for (const f of sorted) {
        console.error(`[${f.surfaceId}] ${f.code} (${f.category}): ${f.message}`);
        if (f.expected !== undefined)
            console.error(`  expected: ${JSON.stringify(f.expected)}`);
        if (f.found !== undefined)
            console.error(`  found: ${JSON.stringify(f.found)}`);
    }
    if (exitCodeVersion === "v1" && exitCode !== 0) {
        process.stderr.write("Deprecation: default exit codes will change. Use --exit-codes v2 to opt in.\n");
    }
    return exitCode;
}
