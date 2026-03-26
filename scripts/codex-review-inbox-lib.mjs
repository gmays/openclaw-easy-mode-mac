#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { isActionableReport, versionTokenForReport } from "./lib/codex-review-findings.mjs";

function stableValue(value) {
  return String(value ?? "").trim();
}

function hasNonWhitespaceText(value) {
  return /[^\s]/.test(String(value ?? ""));
}

export function defaultReviewsDir(repoRoot) {
  return path.join(repoRoot, ".code-reviews");
}

export function resolveRepoRoot(cwd = process.cwd()) {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status !== 0) {
    return path.resolve(cwd);
  }
  return stableValue(result.stdout) || path.resolve(cwd);
}

export async function resolveReviewsDir(repoRoot, preferredDir = "") {
  const override = stableValue(preferredDir || process.env.CODEX_REVIEW_DIR);
  const resolved = override ? path.resolve(repoRoot, override) : defaultReviewsDir(repoRoot);
  try {
    await mkdir(path.join(resolved, "logs"), { recursive: true, mode: 0o700 });
    return resolved;
  } catch {
    const repoHash = crypto.createHash("sha1").update(repoRoot, "utf8").digest("hex").slice(0, 12);
    const fallback = path.join(tmpdir(), `openclaw-code-reviews-${repoHash}`);
    await mkdir(path.join(fallback, "logs"), { recursive: true, mode: 0o700 });
    return fallback;
  }
}

export function ackPathForLane(reviewsDir) {
  return path.join(reviewsDir, ".ack.json");
}

export async function readAckState(ackPath) {
  try {
    const parsed = JSON.parse(await readFile(ackPath, "utf8"));
    const rawAcks =
      parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed.acks : {};
    const acks = {};
    if (rawAcks && typeof rawAcks === "object" && !Array.isArray(rawAcks)) {
      for (const [sha, entry] of Object.entries(rawAcks)) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
          continue;
        }
        const versionToken = stableValue(entry.version_token);
        if (!versionToken) {
          continue;
        }
        acks[stableValue(sha).toLowerCase()] = {
          version_token: versionToken,
          acked_at: stableValue(entry.acked_at),
          reason: stableValue(entry.reason),
          source: stableValue(entry.source),
        };
      }
    }
    return {
      schema_version: 1,
      updated_at: stableValue(parsed?.updated_at),
      acks,
    };
  } catch {
    return {
      schema_version: 1,
      updated_at: "",
      acks: {},
    };
  }
}

export async function writeAckStateAtomic(ackPath, state, now) {
  await mkdir(path.dirname(ackPath), { recursive: true, mode: 0o700 });
  const tempPath = `${ackPath}.tmp.${process.pid}.${Date.now()}`;
  await writeFile(
    tempPath,
    `${JSON.stringify(
      {
        schema_version: 1,
        updated_at: now,
        acks: state.acks,
      },
      null,
      2,
    )}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  await rename(tempPath, ackPath);
}

export function defaultOpenReport(mdPath) {
  const attempts = [
    ["cursor", [mdPath]],
    ["code", ["-r", mdPath]],
    ["open", ["-a", "Cursor", mdPath]],
    ["open", [mdPath]],
  ];
  for (const [command, args] of attempts) {
    const result = spawnSync(command, args, { stdio: "ignore" });
    if (result.status === 0) {
      return true;
    }
  }
  return false;
}

export async function collectReports({ reviewsDir }) {
  const entries = await readdir(reviewsDir, { withFileTypes: true }).catch(() => []);
  const reports = [];

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    if (!entry.name.endsWith(".json") || entry.name === ".ack.json") {
      continue;
    }
    const sha = entry.name.slice(0, -".json".length).toLowerCase();
    const jsonPath = path.join(reviewsDir, entry.name);
    const mdPath = path.join(reviewsDir, `${sha}.md`);

    let parsed;
    try {
      parsed = JSON.parse(await readFile(jsonPath, "utf8"));
    } catch {
      continue;
    }

    let mdText = "";
    try {
      mdText = await readFile(mdPath, "utf8");
    } catch {
      mdText = "";
    }

    const actionable = hasNonWhitespaceText(mdText) && isActionableReport(parsed);
    reports.push({
      sha,
      jsonPath,
      mdPath,
      parsed,
      actionable,
      versionToken: versionTokenForReport(sha, parsed),
    });
  }

  reports.sort((left, right) => {
    const leftMs = Date.parse(stableValue(left.parsed?.last_reviewed));
    const rightMs = Date.parse(stableValue(right.parsed?.last_reviewed));
    return (Number.isNaN(rightMs) ? 0 : rightMs) - (Number.isNaN(leftMs) ? 0 : leftMs);
  });
  return reports;
}

export async function runCatchup({
  reviewsDir,
  ackPath = ackPathForLane(reviewsDir),
  maxOpens = 1,
  shaFilter = null,
  dryRun = false,
  openReport = defaultOpenReport,
}) {
  const ackState = await readAckState(ackPath);
  const reports = await collectReports({ reviewsDir });
  const normalizedShaFilter =
    shaFilter instanceof Set
      ? new Set([...shaFilter].map((sha) => stableValue(sha).toLowerCase()).filter(Boolean))
      : null;
  const filtered = normalizedShaFilter?.size
    ? reports.filter((report) => normalizedShaFilter.has(report.sha))
    : reports;
  const actionable = filtered.filter((report) => report.actionable);
  const pending = actionable.filter(
    (report) => ackState.acks[report.sha]?.version_token !== report.versionToken,
  );

  let opened = 0;
  const now = new Date().toISOString();
  for (const report of pending) {
    if (opened >= maxOpens) {
      break;
    }
    const ok = dryRun ? true : openReport(report.mdPath);
    if (!ok) {
      continue;
    }
    opened += 1;
    if (!dryRun) {
      ackState.acks[report.sha] = {
        version_token: report.versionToken,
        acked_at: now,
        reason: "opened",
        source: "inbox",
      };
    }
  }

  if (!dryRun && opened > 0) {
    await writeAckStateAtomic(ackPath, ackState, now);
  }

  return {
    actionable,
    pending,
    opened,
  };
}
