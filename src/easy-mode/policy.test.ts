import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EASY_MODE_PRODUCT_MODE,
  filterEasyModeChannels,
  filterEasyModeTools,
  validateEasyModeConfig,
} from "./policy.js";

describe("easy mode policy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("filters channels and tools to the Easy Mode allowlists", () => {
    vi.stubEnv("OPENCLAW_PRODUCT_MODE", EASY_MODE_PRODUCT_MODE);

    expect(
      filterEasyModeChannels([{ id: "telegram" }, { id: "discord" }, { id: "whatsapp" }]).map(
        (entry) => entry.id,
      ),
    ).toEqual(["telegram", "whatsapp"]);

    expect(
      filterEasyModeTools([{ name: "read" }, { name: "exec" }, { name: "message" }]).map(
        (entry) => entry.name,
      ),
    ).toEqual(["read", "message"]);
  });

  it("rejects remote, plugin, and browser-heavy config in Easy Mode", () => {
    vi.stubEnv("OPENCLAW_PRODUCT_MODE", EASY_MODE_PRODUCT_MODE);

    const issues = validateEasyModeConfig({
      gateway: {
        mode: "remote",
        bind: "lan",
        remote: { url: "wss://example.test" },
      },
      browser: { enabled: true } as never,
      channels: {
        telegram: { botToken: "token" },
        discord: { token: "nope" },
      },
      plugins: {
        allow: ["matrix"],
      },
      tools: {
        exec: { host: "gateway" },
      },
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "gateway.mode" }),
        expect.objectContaining({ path: "gateway.bind" }),
        expect.objectContaining({ path: "gateway.remote" }),
        expect.objectContaining({ path: "browser.enabled" }),
        expect.objectContaining({ path: "channels.discord" }),
        expect.objectContaining({ path: "plugins.allow" }),
        expect.objectContaining({ path: "tools.exec" }),
      ]),
    );
  });
});
