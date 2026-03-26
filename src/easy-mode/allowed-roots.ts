import fs from "node:fs/promises";
import path from "node:path";
import { OPENCLAW_PRODUCT_MODE_ENV, EASY_MODE_PRODUCT_MODE } from "./policy.js";

export const OPENCLAW_ALLOWED_ROOTS_FILE_ENV = "OPENCLAW_ALLOWED_ROOTS_FILE";
export const OPENCLAW_ALLOWED_ROOTS_JSON_ENV = "OPENCLAW_ALLOWED_ROOTS_JSON";

export type EasyModeAllowedRootsManifest = {
  version: 1;
  productMode: typeof EASY_MODE_PRODUCT_MODE;
  workspaceDir: string;
  allowedRoots: string[];
};

function isEasyModeRuntime(env: NodeJS.ProcessEnv): boolean {
  return env[OPENCLAW_PRODUCT_MODE_ENV]?.trim() === EASY_MODE_PRODUCT_MODE;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

function normalizeRoot(root: string): string | undefined {
  const trimmed = root.trim();
  if (!trimmed) {
    return undefined;
  }
  const resolved = path.resolve(trimmed);
  return resolved === path.parse(resolved).root ? undefined : resolved;
}

function normalizeManifest(raw: unknown): EasyModeAllowedRootsManifest | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  if (record.version !== 1 || record.productMode !== EASY_MODE_PRODUCT_MODE) {
    return undefined;
  }
  const workspaceDir =
    typeof record.workspaceDir === "string" ? normalizeRoot(record.workspaceDir) : undefined;
  if (!workspaceDir) {
    return undefined;
  }
  const allowedRoots = Array.from(
    new Set(
      asStringArray(record.allowedRoots)
        .map((entry) => normalizeRoot(entry))
        .filter((entry): entry is string => !!entry),
    ),
  ).filter((entry) => entry !== workspaceDir);
  return {
    version: 1,
    productMode: EASY_MODE_PRODUCT_MODE,
    workspaceDir,
    allowedRoots,
  };
}

async function readManifestFromFile(
  filePath: string,
): Promise<EasyModeAllowedRootsManifest | undefined> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return normalizeManifest(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

export async function loadEasyModeAllowedRootsManifest(
  env: NodeJS.ProcessEnv = process.env,
): Promise<EasyModeAllowedRootsManifest | undefined> {
  if (!isEasyModeRuntime(env)) {
    return undefined;
  }
  const manifestJson = env[OPENCLAW_ALLOWED_ROOTS_JSON_ENV]?.trim();
  if (manifestJson) {
    try {
      return normalizeManifest(JSON.parse(manifestJson));
    } catch {
      return undefined;
    }
  }
  const manifestPath = env[OPENCLAW_ALLOWED_ROOTS_FILE_ENV]?.trim();
  if (!manifestPath) {
    return undefined;
  }
  return await readManifestFromFile(manifestPath);
}

async function resolveRealPath(filePath: string): Promise<string> {
  try {
    return await fs.realpath(filePath);
  } catch {
    const resolved = path.resolve(filePath);
    try {
      const realParent = await fs.realpath(path.dirname(resolved));
      return path.join(realParent, path.basename(resolved));
    } catch {
      return resolved;
    }
  }
}

export async function assertEasyModeAllowedRoot(
  filePath: string,
  params?: {
    env?: NodeJS.ProcessEnv;
    label?: string;
  },
): Promise<void> {
  const env = params?.env ?? process.env;
  if (!isEasyModeRuntime(env)) {
    return;
  }
  const manifest = await loadEasyModeAllowedRootsManifest(env);
  if (!manifest) {
    throw new Error("Easy Mode allowed-roots manifest is missing.");
  }

  const candidate = await resolveRealPath(filePath);
  const roots = [manifest.workspaceDir, ...manifest.allowedRoots];
  for (const root of roots) {
    const resolvedRoot = await resolveRealPath(root);
    if (candidate === resolvedRoot || candidate.startsWith(resolvedRoot + path.sep)) {
      return;
    }
  }

  const label = params?.label ?? "Path";
  throw new Error(`${label} is outside Easy Mode allowed roots: ${filePath}`);
}
