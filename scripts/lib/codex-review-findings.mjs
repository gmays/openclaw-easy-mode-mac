#!/usr/bin/env node

import crypto from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";

const SEVERITY_RANK = {
  none: 0,
  minor: 1,
  major: 2,
  blocker: 3,
};

function stableValue(value) {
  return String(value ?? "").trim();
}

function clampConfidence(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return 0;
  }
  if (numeric > 1) {
    return 1;
  }
  return numeric;
}

export function normalizeEvidence(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return { file: "", lines: "", reason: "" };
  }

  return {
    file: stableValue(item.file),
    lines: stableValue(item.lines),
    reason: stableValue(item.reason || item.why),
  };
}

function stableFindingPayload(item) {
  return {
    severity: stableValue(item?.severity).toLowerCase(),
    confidence: clampConfidence(item?.confidence),
    title: stableValue(item?.title),
    finding_id: stableValue(item?.finding_id),
    hypothesis: stableValue(item?.hypothesis),
    impact: stableValue(item?.impact),
    recommended_direction: stableValue(item?.recommended_direction),
    evidence: Array.isArray(item?.evidence)
      ? item.evidence
          .map((entry) => normalizeEvidence(entry))
          .toSorted((left, right) =>
            `${left.file}:${left.lines}:${left.reason}`.localeCompare(
              `${right.file}:${right.lines}:${right.reason}`,
            ),
          )
      : [],
  };
}

export function findingIdFor(item) {
  const raw = JSON.stringify({
    severity: stableValue(item?.severity).toLowerCase(),
    title: stableValue(item?.title),
    hypothesis: stableValue(item?.hypothesis),
    impact: stableValue(item?.impact),
    recommended_direction: stableValue(item?.recommended_direction),
    evidence: Array.isArray(item?.evidence)
      ? item.evidence.map((entry) => normalizeEvidence(entry))
      : [],
  });
  return `F-${crypto.createHash("sha1").update(raw, "utf8").digest("hex").slice(0, 10)}`;
}

export function normalizeFinding(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return null;
  }

  let severity = stableValue(item.severity).toLowerCase();
  if (!["minor", "major", "blocker"].includes(severity)) {
    severity = "minor";
  }

  const title = stableValue(item.title) || "Review finding";
  const hypothesis = stableValue(item.hypothesis);
  const impact = stableValue(item.impact);
  const recommendedDirection = stableValue(item.recommended_direction);
  const evidence = Array.isArray(item.evidence)
    ? item.evidence
        .map((entry) => normalizeEvidence(entry))
        .filter(
          (entry) => entry.file.length > 0 || entry.lines.length > 0 || entry.reason.length > 0,
        )
    : [];

  const normalized = {
    severity,
    confidence: clampConfidence(item.confidence),
    title,
    finding_id: stableValue(item.finding_id || item.id),
    hypothesis,
    impact,
    evidence,
    recommended_direction: recommendedDirection,
  };

  if (!normalized.finding_id) {
    normalized.finding_id = findingIdFor(normalized);
  }

  return normalized;
}

export function normalizeModelOutput(parsed) {
  const summary =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? stableValue(parsed.summary)
      : "";
  const findings = Array.isArray(parsed?.findings)
    ? parsed.findings.map((item) => normalizeFinding(item)).filter(Boolean)
    : [];

  const seen = new Set();
  const deduped = [];
  for (const finding of findings) {
    const signature = findingSignature(finding);
    if (seen.has(signature)) {
      continue;
    }
    seen.add(signature);
    deduped.push(finding);
  }

  return {
    schema_version: 2,
    summary,
    findings: deduped,
  };
}

export function severityRank(value) {
  return SEVERITY_RANK[stableValue(value).toLowerCase()] ?? 0;
}

export function summarizeFindings(findings) {
  let worstSeverity = "none";
  const normalized = Array.isArray(findings) ? findings : [];
  for (const finding of normalized) {
    const severity = stableValue(finding?.severity).toLowerCase();
    if (severityRank(severity) > severityRank(worstSeverity)) {
      worstSeverity = severity;
    }
  }
  return {
    count: normalized.length,
    worstSeverity,
  };
}

export function findingSignature(item) {
  const raw = JSON.stringify(stableFindingPayload(item));
  return crypto.createHash("sha1").update(raw, "utf8").digest("hex");
}

export function isActionableReport(report) {
  const findings = Array.isArray(report?.findings) ? report.findings : [];
  if (findings.length > 0) {
    return true;
  }
  return stableValue(report?.review_status).toLowerCase() !== "ok";
}

function reportContentHash(report) {
  const normalized = {
    review_status: stableValue(report?.review_status).toLowerCase(),
    failure_reason: stableValue(report?.failure_reason).toLowerCase(),
    summary: stableValue(report?.summary),
    findings: Array.isArray(report?.findings)
      ? report.findings
          .map((item) => stableFindingPayload(item))
          .toSorted((left, right) =>
            `${left.finding_id}:${left.title}:${left.severity}`.localeCompare(
              `${right.finding_id}:${right.title}:${right.severity}`,
            ),
          )
      : [],
  };
  return crypto.createHash("sha1").update(JSON.stringify(normalized), "utf8").digest("hex");
}

export function versionTokenForReport(sha, report) {
  return `v1:${stableValue(sha).toLowerCase()}:${reportContentHash(report)}`;
}

function formatEvidence(entry) {
  const file = stableValue(entry?.file);
  const lines = stableValue(entry?.lines);
  const reason = stableValue(entry?.reason);
  const location = [file, lines].filter(Boolean).join(":");
  if (location && reason) {
    return `- \`${location}\` ${reason}`;
  }
  if (location) {
    return `- \`${location}\``;
  }
  if (reason) {
    return `- ${reason}`;
  }
  return "";
}

export function formatReviewMarkdown(report) {
  const findings = Array.isArray(report?.findings) ? report.findings : [];
  const lines = [
    `# Codex Commit Review: ${stableValue(report?.sha)}`,
    "",
    `- Status: ${stableValue(report?.review_status) || "unknown"}`,
    `- Trigger: ${stableValue(report?.trigger_last) || "unknown"}`,
    `- Reviewed: ${stableValue(report?.last_reviewed) || "unknown"}`,
  ];

  if (stableValue(report?.failure_reason)) {
    lines.push(`- Failure reason: ${stableValue(report.failure_reason)}`);
  }

  lines.push("", "## Summary", "", stableValue(report?.summary) || "No summary.", "");

  if (findings.length === 0) {
    lines.push("## Findings", "", "No actionable findings were recorded.", "");
    return `${lines.join("\n").trim()}\n`;
  }

  lines.push("## Findings", "");
  for (const [index, finding] of findings.entries()) {
    lines.push(
      `${index + 1}. [${stableValue(finding.severity).toUpperCase()}] ${stableValue(finding.title)}`,
    );
    if (stableValue(finding.hypothesis)) {
      lines.push(`   - Hypothesis: ${stableValue(finding.hypothesis)}`);
    }
    if (stableValue(finding.impact)) {
      lines.push(`   - Impact: ${stableValue(finding.impact)}`);
    }
    if (stableValue(finding.recommended_direction)) {
      lines.push(`   - Direction: ${stableValue(finding.recommended_direction)}`);
    }
    const evidence = Array.isArray(finding.evidence) ? finding.evidence : [];
    if (evidence.length > 0) {
      lines.push("   - Evidence:");
      for (const entry of evidence) {
        const formatted = formatEvidence(entry);
        if (formatted) {
          lines.push(`     ${formatted.slice(2)}`);
        }
      }
    }
    lines.push("");
  }

  return `${lines.join("\n").trim()}\n`;
}

export function writeReviewArtifacts({ report, targetJson, targetMd }) {
  writeFileSync(targetJson, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });

  if (!isActionableReport(report)) {
    rmSync(targetMd, { force: true });
    return;
  }

  writeFileSync(targetMd, formatReviewMarkdown(report), {
    encoding: "utf8",
    mode: 0o600,
  });
}
