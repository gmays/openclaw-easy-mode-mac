import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const tempRepos: string[] = [];

function run(
  cwd: string,
  command: string,
  args: string[] = [],
  extraEnv: Record<string, string> = {},
) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      ...extraEnv,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
    },
  }).trim();
}

function createRepo() {
  const repo = mkdtempSync(path.join(os.tmpdir(), "openclaw-codex-review-hooks-"));
  tempRepos.push(repo);
  run(repo, "git", ["init", "-q", "--initial-branch=main"]);
  run(repo, "git", ["config", "user.email", "test@example.com"]);
  run(repo, "git", ["config", "user.name", "Test User"]);
  writeFileSync(path.join(repo, "seed.txt"), "seed\n");
  run(repo, "git", ["add", "seed.txt"]);
  run(repo, "git", ["commit", "-qm", "seed"]);
  mkdirSync(path.join(repo, "git-hooks"), { recursive: true });
  mkdirSync(path.join(repo, "scripts"), { recursive: true });
  symlinkSync(
    path.join(process.cwd(), "git-hooks", "post-commit"),
    path.join(repo, "git-hooks", "post-commit"),
  );
  symlinkSync(
    path.join(process.cwd(), "git-hooks", "pre-push"),
    path.join(repo, "git-hooks", "pre-push"),
  );
  return repo;
}

afterEach(() => {
  while (tempRepos.length > 0) {
    const repo = tempRepos.pop();
    if (repo) {
      rmSync(repo, { recursive: true, force: true });
    }
  }
});

describe("codex review git hooks", () => {
  it("post-commit kicks off review and inbox scripts", async () => {
    const repo = createRepo();
    const logFile = path.join(repo, "hook.log");
    writeFileSync(
      path.join(repo, "scripts", "codex-review-commit"),
      `#!/usr/bin/env bash\nprintf 'commit %s %s\\n' "$2" "$4" >> ${JSON.stringify(logFile)}\n`,
      { encoding: "utf8", mode: 0o755 },
    );
    writeFileSync(
      path.join(repo, "scripts", "codex-review-inbox"),
      `#!/usr/bin/env bash\nprintf 'inbox %s %s\\n' "$1" "$2" >> ${JSON.stringify(logFile)}\n`,
      { encoding: "utf8", mode: 0o755 },
    );

    run(repo, "sh", ["git-hooks/post-commit"]);

    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline && !existsSync(logFile)) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    const output = readFileSync(logFile, "utf8");
    expect(output).toContain("post-commit");
    expect(output).toContain("inbox --mode");
  });

  it("post-commit honors CODEX_REVIEW_DIR for hook logs", async () => {
    const repo = createRepo();
    const reviewDir = path.join(repo, ".local-review-artifacts");
    writeFileSync(
      path.join(repo, "scripts", "codex-review-commit"),
      "#!/usr/bin/env bash\nexit 0\n",
      { encoding: "utf8", mode: 0o755 },
    );
    writeFileSync(
      path.join(repo, "scripts", "codex-review-inbox"),
      "#!/usr/bin/env bash\nexit 0\n",
      { encoding: "utf8", mode: 0o755 },
    );

    run(repo, "sh", ["git-hooks/post-commit"], {
      CODEX_REVIEW_DIR: reviewDir,
    });

    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline && !existsSync(path.join(reviewDir, "logs", "post-commit.log"))) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    expect(existsSync(path.join(reviewDir, "logs", "post-commit.log"))).toBe(true);
    expect(existsSync(path.join(repo, ".code-reviews"))).toBe(false);
  });

  it("pre-push blocks and runs inbox when the gate fails", () => {
    const repo = createRepo();
    const logFile = path.join(repo, "hook.log");
    writeFileSync(
      path.join(repo, "scripts", "codex-review-push-gate"),
      `#!/usr/bin/env bash\nprintf 'gate %s %s\\n' "$1" "$2" >> ${JSON.stringify(logFile)}\nexit 1\n`,
      { encoding: "utf8", mode: 0o755 },
    );
    writeFileSync(
      path.join(repo, "scripts", "codex-review-inbox"),
      `#!/usr/bin/env bash\nprintf 'inbox %s %s %s %s\\n' "$1" "$2" "$3" "$4" >> ${JSON.stringify(logFile)}\n`,
      { encoding: "utf8", mode: 0o755 },
    );

    const result = spawnSync("sh", ["git-hooks/pre-push", "origin"], {
      cwd: repo,
      encoding: "utf8",
      input: "refs/heads/main abc refs/heads/main 0000000000000000000000000000000000000000\n",
    });

    expect(result.status).toBe(1);
    const output = readFileSync(logFile, "utf8");
    expect(output).toContain("gate --stdin-file");
    expect(output).toContain("inbox --mode catch-up");
  });
});
