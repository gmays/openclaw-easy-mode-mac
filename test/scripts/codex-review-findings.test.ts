import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  normalizeModelOutput,
  versionTokenForReport,
  writeReviewArtifacts,
} from "../../scripts/lib/codex-review-findings.mjs";

const tempDirs: string[] = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-codex-review-findings-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("scripts/lib/codex-review-findings normalizeModelOutput", () => {
  it("normalizes and dedupes repeated findings", () => {
    const output = normalizeModelOutput({
      summary: "found issues",
      findings: [
        {
          severity: "major",
          confidence: 0.9,
          title: "Breaks push gate",
          hypothesis: "bug",
          impact: "push fails",
          evidence: [{ file: "scripts/a.mjs", lines: "10-12", reason: "bad path" }],
          recommended_direction: "fix it",
        },
        {
          severity: "major",
          confidence: 0.9,
          title: "Breaks push gate",
          hypothesis: "bug",
          impact: "push fails",
          evidence: [{ file: "scripts/a.mjs", lines: "10-12", reason: "bad path" }],
          recommended_direction: "fix it",
        },
      ],
    });

    expect(output.summary).toBe("found issues");
    expect(output.findings).toHaveLength(1);
    expect(output.findings[0]?.finding_id).toMatch(/^F-/);
  });
});

describe("scripts/lib/codex-review-findings writeReviewArtifacts", () => {
  it("writes actionable markdown and json sidecars", () => {
    const dir = makeTempDir();
    const targetJson = path.join(dir, "abc.json");
    const targetMd = path.join(dir, "abc.md");
    const report = {
      schema_version: 2,
      sha: "abc",
      trigger_last: "manual",
      review_status: "ok",
      failure_reason: "",
      last_reviewed: "2026-03-26T00:00:00.000Z",
      summary: "action needed",
      findings: [
        {
          severity: "major",
          confidence: 0.92,
          title: "Findings persist",
          finding_id: "F-1",
          hypothesis: "bug",
          impact: "breakage",
          evidence: [{ file: "scripts/test.mjs", lines: "1-2", reason: "regression" }],
          recommended_direction: "resolve it",
        },
      ],
      repository: { name: "openclaw", root: process.cwd() },
      finding_models: ["codex-cli"],
    };

    writeReviewArtifacts({ report, targetJson, targetMd });

    expect(fs.existsSync(targetJson)).toBe(true);
    expect(fs.existsSync(targetMd)).toBe(true);
    expect(fs.readFileSync(targetMd, "utf8")).toContain("Findings persist");
  });

  it("removes stale markdown when a report becomes clean", () => {
    const dir = makeTempDir();
    const targetJson = path.join(dir, "abc.json");
    const targetMd = path.join(dir, "abc.md");
    fs.writeFileSync(targetMd, "stale\n");

    const report = {
      schema_version: 2,
      sha: "abc",
      trigger_last: "manual",
      review_status: "ok",
      failure_reason: "",
      last_reviewed: "2026-03-26T00:00:00.000Z",
      summary: "clean",
      findings: [],
      repository: { name: "openclaw", root: process.cwd() },
      finding_models: ["codex-cli"],
    };

    writeReviewArtifacts({ report, targetJson, targetMd });

    expect(fs.existsSync(targetJson)).toBe(true);
    expect(fs.existsSync(targetMd)).toBe(false);
  });

  it("produces stable version tokens for identical content", () => {
    const report = {
      review_status: "ok",
      failure_reason: "",
      summary: "same",
      findings: [],
    };

    expect(versionTokenForReport("abc", report)).toBe(versionTokenForReport("abc", report));
  });
});
