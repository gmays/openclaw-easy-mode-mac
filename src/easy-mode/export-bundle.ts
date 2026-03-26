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

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function isEasyModeExportBundle(value: unknown): value is EasyModeExportBundle {
  if (!isPlainRecord(value)) {
    return false;
  }
  const record = value;
  if (record.version !== 1 || record.productMode !== EASY_MODE_PRODUCT_MODE) {
    return false;
  }
  if (typeof record.exportedAt !== "string" || typeof record.workspaceDir !== "string") {
    return false;
  }
  if (!isPlainRecord(record.settings)) {
    return false;
  }
  const allowedRootsManifest = record.allowedRootsManifest;
  if (!isPlainRecord(allowedRootsManifest)) {
    return false;
  }
  const allowedRootsRecord = allowedRootsManifest;
  const connectors = record.connectors;
  return (
    typeof allowedRootsRecord.workspaceDir === "string" &&
    Array.isArray(allowedRootsRecord.allowedRoots) &&
    allowedRootsRecord.allowedRoots.every((root) => typeof root === "string") &&
    isPlainRecord(connectors) &&
    (connectors.telegram === undefined || isPlainRecord(connectors.telegram)) &&
    (connectors.whatsapp === undefined || isPlainRecord(connectors.whatsapp))
  );
}
