import { access } from "node:fs/promises";
import path from "node:path";

/**
 * Detect presence of /auth routes (app/auth/ directory with any route).
 */
export async function detectAuthAware(appRoot: string): Promise<boolean> {
  const authDir = path.join(appRoot, "app", "auth");
  try {
    await access(authDir);
  } catch {
    return false;
  }
  return true;
}
