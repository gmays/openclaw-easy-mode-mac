import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertEasyModeAllowedRoot, type EasyModeAllowedRootsManifest } from "./allowed-roots.js";
import { EASY_MODE_PRODUCT_MODE } from "./policy.js";

describe("easy mode allowed roots", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("allows workspace and granted roots from the manifest file", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-easy-mode-roots-"));
    const workspaceDir = path.join(root, "workspace");
    const grantedDir = path.join(root, "granted");
    const manifestPath = path.join(root, "allowed-roots.json");
    await fs.mkdir(workspaceDir, { recursive: true });
    await fs.mkdir(grantedDir, { recursive: true });

    const manifest: EasyModeAllowedRootsManifest = {
      version: 1,
      productMode: EASY_MODE_PRODUCT_MODE,
      workspaceDir,
      allowedRoots: [grantedDir],
    };
    await fs.writeFile(manifestPath, JSON.stringify(manifest), "utf8");

    vi.stubEnv("OPENCLAW_PRODUCT_MODE", EASY_MODE_PRODUCT_MODE);
    vi.stubEnv("OPENCLAW_ALLOWED_ROOTS_FILE", manifestPath);

    await expect(
      assertEasyModeAllowedRoot(path.join(workspaceDir, "note.txt")),
    ).resolves.toBeUndefined();
    await expect(
      assertEasyModeAllowedRoot(path.join(grantedDir, "photo.png")),
    ).resolves.toBeUndefined();
    await expect(assertEasyModeAllowedRoot(path.join(root, "outside.txt"))).rejects.toThrow(
      /outside Easy Mode allowed roots/i,
    );
  });
});
