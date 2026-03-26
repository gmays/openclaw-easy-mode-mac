import { describe, expect, it } from "vitest";
import { isEasyModeExportBundle } from "./export-bundle.js";
import { EASY_MODE_PRODUCT_MODE } from "./policy.js";

describe("easy mode export bundle", () => {
  it("accepts a valid export bundle", () => {
    expect(
      isEasyModeExportBundle({
        version: 1,
        productMode: EASY_MODE_PRODUCT_MODE,
        exportedAt: "2026-03-26T00:00:00Z",
        workspaceDir: "/tmp/workspace",
        settings: {
          meta: {
            productMode: EASY_MODE_PRODUCT_MODE,
          },
        },
        allowedRootsManifest: {
          workspaceDir: "/tmp/workspace",
          allowedRoots: ["/tmp/granted"],
        },
        connectors: {
          telegram: {
            botToken: "abc123",
          },
        },
      }),
    ).toBe(true);
  });

  it("rejects incomplete or tampered bundles", () => {
    expect(
      isEasyModeExportBundle({
        version: 2,
        productMode: EASY_MODE_PRODUCT_MODE,
        exportedAt: "2026-03-26T00:00:00Z",
        workspaceDir: "/tmp/workspace",
        settings: {},
        allowedRootsManifest: {
          workspaceDir: "/tmp/workspace",
          allowedRoots: [],
        },
      }),
    ).toBe(false);

    expect(
      isEasyModeExportBundle({
        version: 1,
        productMode: EASY_MODE_PRODUCT_MODE,
        exportedAt: "2026-03-26T00:00:00Z",
        workspaceDir: "/tmp/workspace",
        settings: {},
        allowedRootsManifest: {
          workspaceDir: "/tmp/workspace",
          allowedRoots: [],
        },
      }),
    ).toBe(false);

    expect(
      isEasyModeExportBundle({
        version: 1,
        productMode: EASY_MODE_PRODUCT_MODE,
        exportedAt: "2026-03-26T00:00:00Z",
        workspaceDir: "/tmp/workspace",
        settings: [],
        allowedRootsManifest: {
          workspaceDir: "/tmp/workspace",
          allowedRoots: [],
        },
      }),
    ).toBe(false);

    expect(
      isEasyModeExportBundle({
        version: 1,
        productMode: EASY_MODE_PRODUCT_MODE,
        exportedAt: "2026-03-26T00:00:00Z",
        workspaceDir: "/tmp/workspace",
        settings: {},
        allowedRootsManifest: {
          workspaceDir: 42,
          allowedRoots: [],
        },
      }),
    ).toBe(false);

    expect(
      isEasyModeExportBundle({
        version: 1,
        productMode: EASY_MODE_PRODUCT_MODE,
        exportedAt: "2026-03-26T00:00:00Z",
        workspaceDir: "/tmp/workspace",
        settings: {},
        allowedRootsManifest: {
          workspaceDir: "/tmp/workspace",
          allowedRoots: ["/tmp/granted", 42],
        },
        connectors: {},
      }),
    ).toBe(false);

    expect(
      isEasyModeExportBundle({
        version: 1,
        productMode: EASY_MODE_PRODUCT_MODE,
        exportedAt: "2026-03-26T00:00:00Z",
        workspaceDir: "/tmp/workspace",
        settings: {},
        allowedRootsManifest: {
          workspaceDir: "/tmp/workspace",
          allowedRoots: [],
        },
        connectors: {
          telegram: "bot-token",
        },
      }),
    ).toBe(false);

    expect(
      isEasyModeExportBundle({
        version: 1,
        productMode: EASY_MODE_PRODUCT_MODE,
        exportedAt: "2026-03-26T00:00:00Z",
        workspaceDir: "/tmp/workspace",
        settings: {},
        allowedRootsManifest: {
          workspaceDir: "/tmp/workspace",
          allowedRoots: [],
        },
        connectors: [],
      }),
    ).toBe(false);
  });
});
