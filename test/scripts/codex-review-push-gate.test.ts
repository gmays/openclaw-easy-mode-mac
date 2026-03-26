import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendDismissal,
  defaultGitExec,
  executePushGate,
  readReviewGateState,
  resolveDismissalsPath,
} from "../../scripts/codex-review-push-gate-lib.mjs";
import { findingSignature } from "../../scripts/lib/codex-review-findings.mjs";

const tempDirs: string[] = [];

function run(cwd: string, command: string, args: string[]) {
  return execFileSync(command, args, { cwd, encoding: "utf8" }).trim();
}

function git(cwd: string, ...args: string[]) {
  return run(cwd, "git", args);
}

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-codex-review-gate-"));
  tempDirs.push(dir);
  git(dir, "init", "-q", "--initial-branch=main");
  git(dir, "config", "user.email", "test@example.com");
  git(dir, "config", "user.name", "Test User");
  fs.writeFileSync(path.join(dir, "seed.txt"), "seed\n");
  git(dir, "add", "seed.txt");
  git(dir, "commit", "-qm", "seed");
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

describe("scripts/codex-review-push-gate-lib readReviewGateState", () => {
  it("treats missing markdown as resolved and non-blocking", async () => {
    const reviewsDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-codex-review-state-"));
    tempDirs.push(reviewsDir);
    writeJson(path.join(reviewsDir, "abc.json"), {
      schema_version: 2,
      sha: "abc",
      review_status: "ok",
      summary: "clean",
      findings: [],
    });

    const state = await readReviewGateState({
      reviewsDir,
      sha: "abc",
      minSeverity: "major",
    });

    expect(state.actionable).toBe(false);
    expect(state.blocking).toBe(false);
  });
});

describe("scripts/codex-review-push-gate-lib executePushGate", () => {
  it("blocks on actionable findings at or above the configured threshold", async () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, "seed.txt"), "changed\n");
    git(repo, "commit", "-am", "change");
    const sha = git(repo, "rev-parse", "HEAD");
    const previousSha = git(repo, "rev-parse", "HEAD^");
    const reviewsDir = path.join(repo, ".code-reviews");
    const finding = {
      severity: "major",
      confidence: 0.95,
      title: "Bug",
      finding_id: "F-1",
      hypothesis: "bug",
      impact: "breakage",
      evidence: [],
      recommended_direction: "fix",
    };
    writeJson(path.join(reviewsDir, `${sha}.json`), {
      schema_version: 2,
      sha,
      review_status: "ok",
      summary: "action needed",
      findings: [finding],
    });
    fs.writeFileSync(path.join(reviewsDir, `${sha}.md`), "# report\n", "utf8");

    const result = await executePushGate({
      repoRoot: repo,
      reviewsDir,
      stdinText: `refs/heads/main ${sha} refs/heads/main ${previousSha}\n`,
      minSeverity: "major",
      gitExec: (args) => defaultGitExec(args, repo),
    });

    expect(result.summary.blocked).toBe(1);
    expect(result.blocked[0]?.sha).toBe(sha);
  });

  it("does not block dismissed findings for the pushed branch", async () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, "seed.txt"), "changed\n");
    git(repo, "commit", "-am", "change");
    const sha = git(repo, "rev-parse", "HEAD");
    const previousSha = git(repo, "rev-parse", "HEAD^");
    const reviewsDir = path.join(repo, ".code-reviews");
    const finding = {
      severity: "major",
      confidence: 0.95,
      title: "Bug",
      finding_id: "F-1",
      hypothesis: "bug",
      impact: "breakage",
      evidence: [],
      recommended_direction: "fix",
    };
    writeJson(path.join(reviewsDir, `${sha}.json`), {
      schema_version: 2,
      sha,
      review_status: "ok",
      summary: "action needed",
      findings: [finding],
    });
    fs.writeFileSync(path.join(reviewsDir, `${sha}.md`), "# report\n", "utf8");

    await appendDismissal({
      repoRoot: repo,
      branchName: "main",
      sha,
      signature: findingSignature(finding),
    });

    const result = await executePushGate({
      repoRoot: repo,
      reviewsDir,
      stdinText: `refs/heads/main ${sha} refs/heads/main ${previousSha}\n`,
      minSeverity: "major",
      gitExec: (args) => defaultGitExec(args, repo),
    });

    expect(result.summary.blocked).toBe(0);
  });

  it("stores dismissals under the resolved git dir, not repoRoot/.git blindly", () => {
    const repo = makeRepo();
    const gitDir = git(repo, "rev-parse", "--path-format=absolute", "--git-dir");
    const dismissalsPath = resolveDismissalsPath(repo, "main");

    expect(dismissalsPath.startsWith(gitDir)).toBe(true);
  });
});
