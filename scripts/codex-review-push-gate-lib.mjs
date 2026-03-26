#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { findingSignature, severityRank, summarizeFindings } from "./lib/codex-review-findings.mjs";

export const ZERO_SHA = "0000000000000000000000000000000000000000";

function stableValue(value) {
  return String(value ?? "").trim();
}

function parseLines(raw) {
  return stableValue(raw)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function parseMinSeverity(value) {
  const normalized = stableValue(value).toLowerCase();
  if (["none", "minor", "major", "blocker"].includes(normalized)) {
    return normalized;
  }
  return "major";
}

export function defaultGitExec(args, repoRoot) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function parseRefUpdates(text) {
  return parseLines(text)
    .map((line) => line.split(/\s+/))
    .filter((parts) => parts.length >= 4)
    .map(([localRef, localSha, remoteRef, remoteSha]) => ({
      localRef,
      localSha,
      remoteRef,
      remoteSha,
    }));
}

function branchNameFromLocalRef(localRef) {
  const ref = stableValue(localRef);
  if (!ref.startsWith("refs/heads/")) {
    return "";
  }
  return ref.slice("refs/heads/".length);
}

function collectOutgoingByUpdate({ updates, remoteName = "", gitExec }) {
  const orderedShas = [];
  const seen = new Set();
  const shaBranches = new Map();

  const remoteRefs =
    stableValue(remoteName).length > 0
      ? parseLines(
          gitExec([
            "for-each-ref",
            "--format=%(refname)",
            `refs/remotes/${stableValue(remoteName)}/*`,
          ]),
        )
      : [];

  for (const update of updates) {
    if (!stableValue(update.localRef).startsWith("refs/heads/")) {
      continue;
    }
    if (stableValue(update.localSha) === ZERO_SHA) {
      continue;
    }

    const branchName = branchNameFromLocalRef(update.localRef);
    let revArgs;
    if (stableValue(update.remoteSha) === ZERO_SHA) {
      if (remoteRefs.length > 0) {
        revArgs = ["rev-list", "--reverse", stableValue(update.localSha), "--not", ...remoteRefs];
      } else {
        const localRefs = parseLines(
          gitExec(["for-each-ref", "--format=%(refname)", "refs/heads"]),
        ).filter((ref) => ref !== stableValue(update.localRef));
        revArgs = ["rev-list", "--reverse", stableValue(update.localSha)];
        if (localRefs.length > 0) {
          revArgs.push("--not", ...localRefs);
        }
      }
    } else {
      revArgs = [
        "rev-list",
        "--reverse",
        `${stableValue(update.remoteSha)}..${stableValue(update.localSha)}`,
      ];
    }

    for (const sha of parseLines(gitExec(revArgs))) {
      if (!seen.has(sha)) {
        seen.add(sha);
        orderedShas.push(sha);
      }
      if (!branchName) {
        continue;
      }
      const branches = shaBranches.get(sha) ?? new Set();
      branches.add(branchName);
      shaBranches.set(sha, branches);
    }
  }

  return { orderedShas, shaBranches };
}

export function computeOutgoingShas({ updates, remoteName = "", gitExec }) {
  return collectOutgoingByUpdate({ updates, remoteName, gitExec }).orderedShas;
}

function lockPathForSha(reviewsDir, sha) {
  return path.join(reviewsDir, `${sha}.review.lock`, "owner.json");
}

function isPidAlive(pidRaw) {
  const pid = Number.parseInt(stableValue(pidRaw), 10);
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function hasActiveReviewLockForSha(reviewsDir, sha) {
  try {
    const raw = JSON.parse(await readFile(lockPathForSha(reviewsDir, sha), "utf8"));
    return isPidAlive(raw?.pid);
  } catch {
    return false;
  }
}

function hasNonWhitespaceText(value) {
  return /[^\s]/.test(String(value ?? ""));
}

export async function readReviewGateState({
  reviewsDir,
  sha,
  minSeverity = "major",
  dismissedSignatures = new Set(),
}) {
  const jsonPath = path.join(reviewsDir, `${sha}.json`);
  const mdPath = path.join(reviewsDir, `${sha}.md`);

  let parsed;
  try {
    parsed = JSON.parse(await readFile(jsonPath, "utf8"));
  } catch {
    return {
      sha,
      status: "absent",
      actionable: false,
      blocking: false,
      findingsCount: 0,
      worstSeverity: "none",
      reason: "review-report-missing",
      hasReportArtifact: false,
    };
  }

  let mdText = "";
  try {
    mdText = await readFile(mdPath, "utf8");
  } catch {
    mdText = "";
  }

  if (!hasNonWhitespaceText(mdText)) {
    return {
      sha,
      status: "present",
      actionable: false,
      blocking: false,
      findingsCount: 0,
      worstSeverity: "none",
      reason: "resolved",
      hasReportArtifact: true,
    };
  }

  const allFindings = Array.isArray(parsed?.findings) ? parsed.findings : [];
  const unresolvedFindings = allFindings.filter(
    (finding) => !dismissedSignatures.has(findingSignature(finding)),
  );
  const { count, worstSeverity } = summarizeFindings(unresolvedFindings);
  const reviewStatus = stableValue(parsed?.review_status).toLowerCase();
  const failed = reviewStatus !== "ok";
  const actionable = failed || count > 0;
  const blocking =
    failed ||
    (parseMinSeverity(minSeverity) !== "none" &&
      severityRank(worstSeverity) >= severityRank(parseMinSeverity(minSeverity)));

  return {
    sha,
    status: "present",
    actionable,
    blocking,
    findingsCount: count,
    worstSeverity,
    reason: failed
      ? stableValue(parsed?.failure_reason || "review-status-failed")
      : count > 0
        ? `severity-threshold-${parseMinSeverity(minSeverity)}`
        : "clean",
    hasReportArtifact: true,
    parsed,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeBranchName(branchName) {
  const value = stableValue(branchName).replaceAll("/", "_").replaceAll("\\", "_");
  return value.replace(/[^A-Za-z0-9._-]/g, "_") || "detached-head";
}

export function resolveGitDir(repoRoot) {
  const output = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-dir"], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  return output || path.join(repoRoot, ".git");
}

export function resolveDismissalsPath(repoRoot, branchName, gitDir = resolveGitDir(repoRoot)) {
  return path.join(gitDir, "codex-review", "dismissals", `${sanitizeBranchName(branchName)}.json`);
}

async function loadDismissalsForBranch(repoRoot, branchName) {
  const dismissalsPath = resolveDismissalsPath(repoRoot, branchName);
  try {
    const parsed = JSON.parse(await readFile(dismissalsPath, "utf8"));
    const dismissed = Array.isArray(parsed?.dismissed) ? parsed.dismissed : [];
    const bySha = new Map();
    for (const entry of dismissed) {
      const sha = stableValue(entry?.sha).toLowerCase();
      const signature = stableValue(entry?.signature);
      if (!sha || !signature) {
        continue;
      }
      const signatures = bySha.get(sha) ?? new Set();
      signatures.add(signature);
      bySha.set(sha, signatures);
    }
    return bySha;
  } catch {
    return new Map();
  }
}

export async function loadDismissedFindingSignatures({ repoRoot, shaBranches }) {
  const dismissedBySha = new Map();
  const branches = new Set();
  for (const values of shaBranches.values()) {
    for (const branchName of values) {
      branches.add(branchName);
    }
  }

  for (const branchName of branches) {
    const branchDismissals = await loadDismissalsForBranch(repoRoot, branchName);
    for (const [sha, signatures] of branchDismissals.entries()) {
      const next = dismissedBySha.get(sha) ?? new Set();
      for (const signature of signatures) {
        next.add(signature);
      }
      dismissedBySha.set(sha, next);
    }
  }

  return dismissedBySha;
}

async function runSynchronousReview({ repoRoot, sha, timeoutMs }) {
  const scriptPath = path.join(repoRoot, "scripts", "codex-review-commit");
  const result = spawnSync(scriptPath, ["--sha", sha, "--trigger", "manual"], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: timeoutMs,
    env: {
      ...process.env,
      CODEX_REVIEW_OPEN_ON_FINDINGS: "0",
    },
  });
  return {
    status: result.status ?? 1,
    stdout: stableValue(result.stdout),
    stderr: stableValue(result.stderr),
    timedOut: result.error?.code === "ETIMEDOUT",
  };
}

export async function executePushGate({
  repoRoot,
  reviewsDir,
  stdinText,
  remoteName = "",
  minSeverity = "major",
  timeoutMs = 300_000,
  shouldContinue = () => true,
  gitExec = (args) => defaultGitExec(args, repoRoot),
}) {
  const updates = parseRefUpdates(stdinText);
  const { orderedShas, shaBranches } = collectOutgoingByUpdate({
    updates,
    remoteName,
    gitExec,
  });
  const dismissedBySha = await loadDismissedFindingSignatures({ repoRoot, shaBranches });
  const blocked = [];
  let actionable = 0;
  let syncReruns = 0;
  let runningWaited = 0;

  for (const sha of orderedShas) {
    let state = await readReviewGateState({
      reviewsDir,
      sha,
      minSeverity,
      dismissedSignatures: dismissedBySha.get(sha) ?? new Set(),
    });

    const deadline = Date.now() + timeoutMs;
    while (state.status === "absent" && (await hasActiveReviewLockForSha(reviewsDir, sha))) {
      if (!shouldContinue() || Date.now() >= deadline) {
        blocked.push({
          sha,
          status: "missing",
          severity: "none",
          findings: 0,
          reason: "review-in-progress",
        });
        break;
      }
      runningWaited += 1;
      await sleep(500);
      state = await readReviewGateState({
        reviewsDir,
        sha,
        minSeverity,
        dismissedSignatures: dismissedBySha.get(sha) ?? new Set(),
      });
    }

    if (blocked.some((entry) => entry.sha === sha)) {
      continue;
    }

    if (state.status === "absent") {
      syncReruns += 1;
      const syncResult = await runSynchronousReview({
        repoRoot,
        sha,
        timeoutMs,
      });
      state = await readReviewGateState({
        reviewsDir,
        sha,
        minSeverity,
        dismissedSignatures: dismissedBySha.get(sha) ?? new Set(),
      });
      if (state.status === "absent") {
        blocked.push({
          sha,
          status: "missing",
          severity: "none",
          findings: 0,
          reason: syncResult.timedOut ? "sync-review-timed-out" : "sync-review-failed",
        });
        continue;
      }
    }

    if (state.actionable) {
      actionable += 1;
    }
    if (state.blocking) {
      blocked.push({
        sha,
        status: state.status,
        severity: state.worstSeverity,
        findings: state.findingsCount,
        reason: state.reason,
      });
    }
  }

  return {
    blocked,
    summary: {
      shas: orderedShas.length,
      actionable,
      blocked: blocked.length,
      sync_reruns: syncReruns,
      running_waited: runningWaited,
    },
  };
}

export async function appendDismissal({ repoRoot, branchName, sha, signature }) {
  const dismissalsPath = resolveDismissalsPath(repoRoot, branchName);
  await mkdir(path.dirname(dismissalsPath), { recursive: true, mode: 0o700 });
  let parsed;
  try {
    parsed = JSON.parse(await readFile(dismissalsPath, "utf8"));
  } catch {
    parsed = { schema_version: 1, dismissed: [] };
  }
  const dismissed = Array.isArray(parsed.dismissed) ? parsed.dismissed : [];
  const alreadyExists = dismissed.some(
    (entry) =>
      stableValue(entry?.sha).toLowerCase() === stableValue(sha).toLowerCase() &&
      stableValue(entry?.signature) === stableValue(signature),
  );
  if (!alreadyExists) {
    dismissed.push({
      sha: stableValue(sha).toLowerCase(),
      signature: stableValue(signature),
      dismissed_at: new Date().toISOString(),
    });
  }
  await writeFile(
    dismissalsPath,
    `${JSON.stringify({ schema_version: 1, dismissed }, null, 2)}\n`,
    {
      encoding: "utf8",
      mode: 0o600,
    },
  );
  return dismissalsPath;
}
