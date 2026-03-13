import fs from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { stableStringify } from "@surfaces/interfacectl-extractor";
export function stringifyDeterministicJson(value) {
    return `${stableStringify(value)}\n`;
}
export function writeDeterministicJsonSync(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, stringifyDeterministicJson(value), "utf8");
}
export async function writeDeterministicJson(filePath, value) {
    await mkdir(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.tmp`;
    await writeFile(tempPath, stringifyDeterministicJson(value), "utf8");
    await rename(tempPath, filePath);
}
