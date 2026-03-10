import path from "node:path";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import {
  extractContractFromNextApp,
  stableStringify,
} from "@surfaces/interfacectl-extractor";
import {
  type InterfaceContract,
  getBundledContractSchema,
  validateContractStructure,
} from "@surfaces/interfacectl-validator";
import { seedColorPolicyFromObservedDescriptors } from "../utils/color-policy-seeding.js";
import { seedChromePolicyFromObservedDescriptors } from "../utils/chrome-policy-seeding.js";
import { seedIconPolicyFromObservedDescriptors } from "../utils/icon-policy-seeding.js";

export interface GenerateContractOptions {
  appRoot: string;
  surfaceId: string;
  outPath?: string;
  reportOutPath?: string;
  schemaPath?: string;
}

const DEFAULT_OUT_DIR = "contracts/generated";

export async function runGenerateContractCommand(
  options: GenerateContractOptions,
): Promise<number> {
  const cwd = process.cwd();
  const appRoot = path.resolve(cwd, options.appRoot);
  const surfaceId = options.surfaceId;

  const outDir = options.outPath
    ? path.dirname(path.resolve(cwd, options.outPath))
    : path.resolve(cwd, DEFAULT_OUT_DIR);
  const contractPath =
    options.outPath ?
      path.resolve(cwd, options.outPath)
    : path.join(outDir, `${surfaceId}.contract.json`);
  const reportPath =
    options.reportOutPath ?
      path.resolve(cwd, options.reportOutPath)
    : path.join(outDir, `${surfaceId}.extraction.json`);

  const { contract: extractedContract, report } = await extractContractFromNextApp({
    appRoot,
    surfaceId,
  });

  const seeded = await seedColorPolicyFromObservedDescriptors({
    workspaceRoot: cwd,
    appRoot,
    surfaceId,
    contract: extractedContract as unknown as InterfaceContract,
  });
  const iconSeeded = await seedIconPolicyFromObservedDescriptors({
    workspaceRoot: cwd,
    appRoot,
    surfaceId,
    contract: seeded.contract,
  });
  const chromeSeeded = await seedChromePolicyFromObservedDescriptors({
    workspaceRoot: cwd,
    appRoot,
    surfaceId,
    contract: iconSeeded.contract,
  });
  const contract = chromeSeeded.contract;
  const reportWithSeedWarnings = {
    ...report,
    warnings: [
      ...report.warnings,
      ...seeded.warnings,
      ...iconSeeded.warnings,
      ...chromeSeeded.warnings,
    ],
  };

  let schema: object;
  if (options.schemaPath) {
    const resolved = path.resolve(cwd, options.schemaPath);
    const raw = await readFile(resolved, "utf-8");
    schema = JSON.parse(raw) as object;
  } else {
    schema = getBundledContractSchema() as object;
  }
  const structureResult = validateContractStructure(
    contract,
    schema,
  );
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
  const reportForOutput = {
    ...reportWithSeedWarnings,
    appRoot: path.relative(cwd, report.appRoot),
  };
  const reportJson = stableStringify(reportForOutput);
  await writeFile(contractPath, `${contractJson}\n`, "utf-8");
  await writeFile(reportPath, `${reportJson}\n`, "utf-8");

  console.log(`Wrote contract: ${contractPath}`);
  console.log(`Wrote report:   ${reportPath}`);
  if (reportWithSeedWarnings.warnings.length > 0) {
    console.log(`Warnings (${reportWithSeedWarnings.warnings.length}):`);
    for (const w of reportWithSeedWarnings.warnings) {
      console.log(`  [${w.code}] ${w.message}`);
    }
  }
  return 0;
}
