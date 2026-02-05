import path from "node:path";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { extractContractFromNextApp, stableStringify, } from "@surfaces/interfacectl-extractor";
import { validateContractStructure, getBundledContractSchema } from "@surfaces/interfacectl-validator";
const DEFAULT_OUT_DIR = "contracts/generated";
export async function runGenerateContractCommand(options) {
    const cwd = process.cwd();
    const appRoot = path.resolve(cwd, options.appRoot);
    const surfaceId = options.surfaceId;
    const outDir = options.outPath
        ? path.dirname(path.resolve(cwd, options.outPath))
        : path.resolve(cwd, DEFAULT_OUT_DIR);
    const contractPath = options.outPath ?
        path.resolve(cwd, options.outPath)
        : path.join(outDir, `${surfaceId}.contract.json`);
    const reportPath = options.reportOutPath ?
        path.resolve(cwd, options.reportOutPath)
        : path.join(outDir, `${surfaceId}.extraction.json`);
    const { contract, report } = await extractContractFromNextApp({
        appRoot,
        surfaceId,
    });
    let schema;
    if (options.schemaPath) {
        const resolved = path.resolve(cwd, options.schemaPath);
        const raw = await readFile(resolved, "utf-8");
        schema = JSON.parse(raw);
    }
    else {
        schema = getBundledContractSchema();
    }
    const structureResult = validateContractStructure(contract, schema);
    if (!structureResult.ok) {
        console.error("Generated contract failed schema validation:");
        for (const err of structureResult.errors) {
            console.error(`  ${err}`);
        }
        return 1;
    }
    await mkdir(path.dirname(contractPath), { recursive: true });
    await mkdir(path.dirname(reportPath), { recursive: true });
    const contractJson = stableStringify(contract);
    const reportJson = stableStringify(report);
    await writeFile(contractPath, `${contractJson}\n`, "utf-8");
    await writeFile(reportPath, `${reportJson}\n`, "utf-8");
    console.log(`Wrote contract: ${contractPath}`);
    console.log(`Wrote report:   ${reportPath}`);
    if (report.warnings.length > 0) {
        console.log(`Warnings (${report.warnings.length}):`);
        for (const w of report.warnings) {
            console.log(`  [${w.code}] ${w.message}`);
        }
    }
    return 0;
}
