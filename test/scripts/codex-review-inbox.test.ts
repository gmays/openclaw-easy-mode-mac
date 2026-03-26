import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  collectReports,
  readAckState,
  resolveReviewsDir,
  runCatchup,
} from "../../scripts/codex-review-inbox-lib.mjs";

const tempDirs: string[] = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-codex-review-inbox-"));
  tempDirs.push(dir);
  return dir;
}

function writeJson(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("scripts/codex-review-inbox-lib collectReports", () => {
  it("treats a missing markdown sidecar as resolved", async () => {
    const reviewsDir = makeTempDir();
    writeJson(path.join(reviewsDir, "abc.json"), {
      schema_version: 2,
      sha: "abc",
      review_status: "ok",
      summary: "found issue",
      findings: [
        {
          severity: "major",
          confidence: 0.9,
          title: "Bug",
          finding_id: "F-1",
          hypothesis: "bug",
          impact: "breakage",
          evidence: [],
          recommended_direction: "fix",
        },
      ],
    });

    const reports = await collectReports({ reviewsDir });
    expect(reports).toHaveLength(1);
    expect(reports[0]?.actionable).toBe(false);
  });

  it("resolves relative review dirs from the repo root", async () => {
    const repoRoot = makeTempDir();

    const resolved = await resolveReviewsDir(repoRoot, "custom-reviews");

    expect(resolved).toBe(path.join(repoRoot, "custom-reviews"));
    expect(fs.existsSync(path.join(repoRoot, "custom-reviews", "logs"))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, "nested", "workdir", "custom-reviews"))).toBe(false);
  });
});

describe("scripts/codex-review-inbox-lib runCatchup", () => {
  it("opens pending actionable reports and updates the ack store", async () => {
    const reviewsDir = makeTempDir();
    const ackPath = path.join(reviewsDir, ".ack.json");
    writeJson(path.join(reviewsDir, "abc.json"), {
      schema_version: 2,
      sha: "abc",
      review_status: "ok",
      last_reviewed: "2026-03-26T00:00:00.000Z",
      summary: "action needed",
      findings: [
        {
          severity: "major",
          confidence: 0.9,
          title: "Bug",
          finding_id: "F-1",
          hypothesis: "bug",
          impact: "breakage",
          evidence: [],
          recommended_direction: "fix",
        },
      ],
    });
    fs.writeFileSync(path.join(reviewsDir, "abc.md"), "# report\n", "utf8");

    const openReport = vi.fn(() => true);
    const result = await runCatchup({
      reviewsDir,
      ackPath,
      openReport,
      maxOpens: 1,
    });

    expect(result.opened).toBe(1);
    expect(openReport).toHaveBeenCalledTimes(1);

    const ackState = await readAckState(ackPath);
    expect(ackState.acks["abc"]?.version_token).toBeTruthy();

    const second = await runCatchup({
      reviewsDir,
      ackPath,
      openReport,
      maxOpens: 1,
    });
    expect(second.opened).toBe(0);
    expect(openReport).toHaveBeenCalledTimes(1);
  });
});

describe("scripts/codex-review-inbox", () => {
  it("does not open reports when catch-up is disabled by env", () => {
    const reviewsDir = makeTempDir();
    writeJson(path.join(reviewsDir, "abc.json"), {
      schema_version: 2,
      sha: "abc",
      review_status: "ok",
      last_reviewed: "2026-03-26T00:00:00.000Z",
      summary: "action needed",
      findings: [
        {
          severity: "major",
          confidence: 0.9,
          title: "Bug",
          finding_id: "F-1",
          hypothesis: "bug",
          impact: "breakage",
          evidence: [],
          recommended_direction: "fix",
        },
      ],
    });
    fs.writeFileSync(path.join(reviewsDir, "abc.md"), "# report\n", "utf8");

    const stdout = execFileSync(
      process.execPath,
      [path.join(process.cwd(), "scripts", "codex-review-inbox"), "--mode", "catch-up"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          CODEX_REVIEW_DIR: reviewsDir,
          CODEX_REVIEW_OPEN_ON_FINDINGS: "0",
        },
      },
    );

    expect(stdout).toContain("catch-up disabled");
    expect(fs.existsSync(path.join(reviewsDir, ".ack.json"))).toBe(false);
  });
});
