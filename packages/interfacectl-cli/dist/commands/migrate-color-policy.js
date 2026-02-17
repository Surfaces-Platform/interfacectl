import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { stableStringify } from "@surfaces/interfacectl-extractor";
import { getBundledContractSchema, normalizeColorValues, validateContractStructure, } from "@surfaces/interfacectl-validator";
import { seedColorPolicyFromObservedDescriptors } from "../utils/color-policy-seeding.js";
export async function runMigrateColorPolicyCommand(options) {
    const workspaceRoot = path.resolve(options.root ?? process.cwd());
    const contractPath = path.resolve(workspaceRoot, options.contractPath);
    const outPath = path.resolve(workspaceRoot, options.outPath ?? options.contractPath);
    let rawContract;
    try {
        rawContract = await readFile(contractPath, "utf8");
    }
    catch (error) {
        console.error(`Failed to read contract ${contractPath}: ${error.message}`);
        return 1;
    }
    let parsed;
    try {
        parsed = JSON.parse(rawContract);
    }
    catch (error) {
        console.error(`Invalid JSON in ${contractPath}: ${error.message}`);
        return 1;
    }
    const migrated = migrateContractShape(parsed);
    const warnings = [];
    if (options.includeObserved) {
        const appRoot = options.appRoot
            ? path.resolve(workspaceRoot, options.appRoot)
            : undefined;
        const surfaceId = options.surfaceId ?? migrated.surfaces[0]?.id;
        if (!appRoot || !surfaceId) {
            console.error("--include-observed requires --app-root and either --surface or a contract with at least one surface.");
            return 1;
        }
        const seeded = await seedColorPolicyFromObservedDescriptors({
            workspaceRoot,
            appRoot,
            surfaceId,
            contract: migrated,
        });
        migrated.color.allowedValues = normalizeColorValues([
            ...migrated.color.allowedValues,
            ...seeded.contract.color.allowedValues,
        ]);
        for (const warning of seeded.warnings) {
            warnings.push(`[${warning.code}] ${warning.message}`);
        }
    }
    const schema = getBundledContractSchema();
    const validated = validateContractStructure(migrated, schema);
    if (!validated.ok) {
        console.error("Migrated contract failed schema validation:");
        for (const issue of validated.errors) {
            console.error(`  • ${issue}`);
        }
        return 1;
    }
    try {
        await writeFile(outPath, `${stableStringify(migrated)}\n`, "utf8");
    }
    catch (error) {
        console.error(`Failed to write migrated contract ${outPath}: ${error.message}`);
        return 1;
    }
    console.log(`Migrated color policy contract written to ${outPath}`);
    if (warnings.length > 0) {
        console.log(`Warnings (${warnings.length}):`);
        for (const warning of warnings) {
            console.log(`  ${warning}`);
        }
    }
    return 0;
}
function migrateContractShape(contract) {
    const legacyColor = contract.color ?? {};
    const legacyRawValues = isRecord(legacyColor.rawValues)
        ? legacyColor.rawValues
        : {};
    const legacyPolicy = normalizePolicy(legacyRawValues.policy);
    const modernPolicy = normalizePolicy(legacyColor.policy);
    const policy = modernPolicy ?? legacyPolicy ?? "warn";
    const legacyAllowlist = asStringArray(legacyRawValues.allowlist);
    const topLevelAllowedValues = asStringArray(legacyColor.allowedValues);
    const surfaceAllowedColors = contract.surfaces.flatMap((surface) => asStringArray(surface.allowedColors));
    const allowedValues = normalizeColorValues([
        ...topLevelAllowedValues,
        ...legacyAllowlist,
        ...surfaceAllowedColors,
    ]);
    return {
        ...contract,
        surfaces: contract.surfaces.map(({ allowedColors: _ignored, ...surface }) => ({
            ...surface,
        })),
        color: {
            policy,
            allowedValues,
        },
    };
}
function isRecord(value) {
    return typeof value === "object" && value !== null;
}
function asStringArray(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter((entry) => typeof entry === "string");
}
function normalizePolicy(value) {
    if (value === "off" || value === "warn" || value === "strict") {
        return value;
    }
    return null;
}
