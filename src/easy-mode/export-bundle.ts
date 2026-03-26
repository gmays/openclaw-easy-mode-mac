import { EASY_MODE_PRODUCT_MODE } from "./policy.js";

export type EasyModeExportBundle = {
  version: 1;
  productMode: typeof EASY_MODE_PRODUCT_MODE;
  exportedAt: string;
  workspaceDir: string;
  settings: Record<string, unknown>;
  allowedRootsManifest: {
    workspaceDir: string;
    allowedRoots: string[];
  };
  connectors: {
    telegram?: Record<string, unknown>;
    whatsapp?: Record<string, unknown>;
  };
};

export function isEasyModeExportBundle(value: unknown): value is EasyModeExportBundle {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || record.productMode !== EASY_MODE_PRODUCT_MODE) {
    return false;
  }
  if (typeof record.exportedAt !== "string" || typeof record.workspaceDir !== "string") {
    return false;
  }
  if (!record.settings || typeof record.settings !== "object" || Array.isArray(record.settings)) {
    return false;
  }
  const allowedRootsManifest = record.allowedRootsManifest;
  if (
    !allowedRootsManifest ||
    typeof allowedRootsManifest !== "object" ||
    Array.isArray(allowedRootsManifest)
  ) {
    return false;
  }
  const allowedRootsRecord = allowedRootsManifest as Record<string, unknown>;
  return (
    typeof allowedRootsRecord.workspaceDir === "string" &&
    Array.isArray(allowedRootsRecord.allowedRoots)
  );
}
