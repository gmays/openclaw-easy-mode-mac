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

  it("fails closed when the allowed-roots manifest is missing or invalid", async () => {
    vi.stubEnv("OPENCLAW_PRODUCT_MODE", EASY_MODE_PRODUCT_MODE);
    vi.stubEnv("OPENCLAW_ALLOWED_ROOTS_FILE", path.join(os.tmpdir(), `missing-${Date.now()}.json`));

    await expect(assertEasyModeAllowedRoot("/tmp/example.txt")).rejects.toThrow(
      /allowed-roots manifest is missing/i,
    );

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-easy-mode-roots-invalid-"));
    const manifestPath = path.join(root, "allowed-roots.json");
    await fs.writeFile(manifestPath, '{"version":1,"productMode":"wrong"}', "utf8");
    vi.stubEnv("OPENCLAW_ALLOWED_ROOTS_FILE", manifestPath);

    await expect(
      assertEasyModeAllowedRoot(path.join(root, "workspace", "note.txt")),
    ).rejects.toThrow(/allowed-roots manifest is missing/i);
  });

  it("rejects symlink escapes outside granted roots", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-easy-mode-roots-symlink-"));
    const workspaceDir = path.join(root, "workspace");
    const grantedDir = path.join(root, "granted");
    const outsideDir = path.join(root, "outside");
    const manifestPath = path.join(root, "allowed-roots.json");
    await fs.mkdir(workspaceDir, { recursive: true });
    await fs.mkdir(grantedDir, { recursive: true });
    await fs.mkdir(outsideDir, { recursive: true });
    const outsideFile = path.join(outsideDir, "secret.txt");
    const symlinkPath = path.join(grantedDir, "escape.txt");
    await fs.writeFile(outsideFile, "secret", "utf8");
    await fs.symlink(outsideFile, symlinkPath);

    const manifest: EasyModeAllowedRootsManifest = {
      version: 1,
      productMode: EASY_MODE_PRODUCT_MODE,
      workspaceDir,
      allowedRoots: [grantedDir],
    };
    await fs.writeFile(manifestPath, JSON.stringify(manifest), "utf8");

    vi.stubEnv("OPENCLAW_PRODUCT_MODE", EASY_MODE_PRODUCT_MODE);
    vi.stubEnv("OPENCLAW_ALLOWED_ROOTS_FILE", manifestPath);

    await expect(assertEasyModeAllowedRoot(symlinkPath)).rejects.toThrow(
      /outside Easy Mode allowed roots/i,
    );
  });
});
