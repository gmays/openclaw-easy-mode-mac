import type { ConfigValidationIssue, OpenClawConfig } from "../config/types.js";

export const EASY_MODE_PRODUCT_MODE = "easy-mode-mac";
export const OPENCLAW_PRODUCT_MODE_ENV = "OPENCLAW_PRODUCT_MODE";

const EASY_MODE_ALLOWED_CHANNEL_IDS = new Set(["telegram", "whatsapp"]);
const EASY_MODE_ALLOWED_TOOL_NAMES = new Set([
  "apply_patch",
  "edit",
  "image",
  "message",
  "pdf",
  "read",
  "web_fetch",
  "web_search",
  "write",
]);
const EASY_MODE_DENIED_TOOL_NAMES = new Set([
  "agents_list",
  "browser",
  "canvas",
  "cron",
  "exec",
  "gateway",
  "nodes",
  "process",
  "session_status",
  "sessions_history",
  "sessions_list",
  "sessions_send",
  "sessions_spawn",
  "sessions_yield",
  "subagents",
  "tts",
  "whatsapp_login",
]);
const EASY_MODE_CONFIG_CHANNEL_IDS = new Set([
  "defaults",
  "modelByChannel",
  ...EASY_MODE_ALLOWED_CHANNEL_IDS,
]);

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as UnknownRecord;
}

function isNonEmptyRecord(value: unknown): boolean {
  const record = asRecord(value);
  return !!record && Object.keys(record).length > 0;
}

function isLoopbackHost(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === "127.0.0.1" || normalized === "::1" || normalized === "localhost";
}

function pushIssue(issues: ConfigValidationIssue[], path: string, message: string) {
  issues.push({ path, message });
}

export function resolveProductMode(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const raw = env[OPENCLAW_PRODUCT_MODE_ENV];
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

export function isEasyModeProduct(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveProductMode(env) === EASY_MODE_PRODUCT_MODE;
}

export function isEasyModeChannelAllowed(
  channelId: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!isEasyModeProduct(env)) {
    return true;
  }
  return EASY_MODE_ALLOWED_CHANNEL_IDS.has(channelId.trim().toLowerCase());
}

export function filterEasyModeChannels<T extends { id: string }>(
  channels: readonly T[],
  env: NodeJS.ProcessEnv = process.env,
): T[] {
  if (!isEasyModeProduct(env)) {
    return [...channels];
  }
  return channels.filter((channel) => isEasyModeChannelAllowed(channel.id, env));
}

export function isEasyModeToolAllowed(
  toolName: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!isEasyModeProduct(env)) {
    return true;
  }
  const normalized = toolName.trim().toLowerCase();
  if (EASY_MODE_DENIED_TOOL_NAMES.has(normalized)) {
    return false;
  }
  return EASY_MODE_ALLOWED_TOOL_NAMES.has(normalized);
}

export function filterEasyModeTools<T extends { name: string }>(
  tools: readonly T[],
  env: NodeJS.ProcessEnv = process.env,
): T[] {
  if (!isEasyModeProduct(env)) {
    return [...tools];
  }
  return tools.filter((tool) => isEasyModeToolAllowed(tool.name, env));
}

export function validateEasyModeConfig(
  config: OpenClawConfig,
  env: NodeJS.ProcessEnv = process.env,
): ConfigValidationIssue[] {
  if (!isEasyModeProduct(env)) {
    return [];
  }

  const issues: ConfigValidationIssue[] = [];
  const gateway = asRecord(config.gateway);
  const remote = asRecord(gateway?.remote);
  const tailscale = asRecord(gateway?.tailscale);
  const auth = asRecord(gateway?.auth);
  const tools = asRecord(config.tools);
  const browser = asRecord((config as UnknownRecord).browser);
  const channels = asRecord(config.channels);
  const plugins = asRecord(config.plugins);

  if (typeof gateway?.mode === "string" && gateway.mode.trim().toLowerCase() === "remote") {
    pushIssue(issues, "gateway.mode", "Easy Mode does not support remote gateway mode.");
  }

  if (typeof gateway?.bind === "string" && gateway.bind.trim().toLowerCase() !== "loopback") {
    pushIssue(issues, "gateway.bind", 'Easy Mode requires gateway.bind="loopback".');
  }

  if (typeof gateway?.customBindHost === "string" && !isLoopbackHost(gateway.customBindHost)) {
    pushIssue(
      issues,
      "gateway.customBindHost",
      "Easy Mode only allows loopback custom bind hosts.",
    );
  }

  if (isNonEmptyRecord(remote)) {
    pushIssue(issues, "gateway.remote", "Easy Mode does not allow remote gateway configuration.");
  }

  if (typeof tailscale?.mode === "string" && tailscale.mode.trim().toLowerCase() !== "off") {
    pushIssue(
      issues,
      "gateway.tailscale.mode",
      "Easy Mode does not allow Tailscale gateway exposure.",
    );
  }

  if (typeof auth?.mode === "string") {
    const mode = auth.mode.trim().toLowerCase();
    if (mode === "none" || mode === "password" || mode === "trusted-proxy") {
      pushIssue(issues, "gateway.auth.mode", "Easy Mode requires token-based local gateway auth.");
    }
  }

  if (isNonEmptyRecord(asRecord(tools?.exec))) {
    pushIssue(issues, "tools.exec", "Easy Mode does not allow shell or exec tools.");
  }

  if (isNonEmptyRecord(asRecord(tools?.subagents))) {
    pushIssue(issues, "tools.subagents", "Easy Mode does not allow subagents.");
  }

  if (isNonEmptyRecord(asRecord((config as UnknownRecord).nodes))) {
    pushIssue(issues, "nodes", "Easy Mode does not allow node features.");
  }

  if (browser?.enabled === true) {
    pushIssue(issues, "browser.enabled", "Easy Mode does not allow generic browser automation.");
  }

  if (channels) {
    for (const channelId of Object.keys(channels)) {
      const normalized = channelId.trim();
      if (!normalized || EASY_MODE_CONFIG_CHANNEL_IDS.has(normalized)) {
        continue;
      }
      pushIssue(
        issues,
        `channels.${normalized}`,
        `Easy Mode does not allow the "${normalized}" channel.`,
      );
    }
  }

  if (Array.isArray(config.plugins?.allow) && config.plugins?.allow.length > 0) {
    pushIssue(
      issues,
      "plugins.allow",
      "Easy Mode does not allow plugin marketplace or plugin loading.",
    );
  }
  if (Array.isArray(config.plugins?.deny) && config.plugins?.deny.length > 0) {
    pushIssue(issues, "plugins.deny", "Easy Mode does not allow plugin policy overrides.");
  }
  if (isNonEmptyRecord(plugins?.entries)) {
    pushIssue(issues, "plugins.entries", "Easy Mode does not allow plugin entries.");
  }
  if (isNonEmptyRecord(plugins?.installs)) {
    pushIssue(issues, "plugins.installs", "Easy Mode does not allow plugin installs.");
  }
  if (isNonEmptyRecord(plugins?.slots)) {
    pushIssue(issues, "plugins.slots", "Easy Mode does not allow plugin slot overrides.");
  }

  return issues;
}
