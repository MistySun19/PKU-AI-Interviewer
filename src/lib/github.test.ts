import { describe, expect, it } from "vitest";
import { parseGitHubUrl, scoreFilePath, selectCandidateFiles, shouldExcludePath } from "./github";

describe("parseGitHubUrl", () => {
  it("parses normal GitHub repo URLs", () => {
    expect(parseGitHubUrl("https://github.com/vercel/next.js")).toEqual({
      owner: "vercel",
      repo: "next.js",
      branch: undefined
    });
  });

  it("parses branch URLs", () => {
    expect(parseGitHubUrl("https://github.com/foo/bar/tree/dev")).toEqual({
      owner: "foo",
      repo: "bar",
      branch: "dev"
    });
  });
});

describe("file filtering", () => {
  it("excludes dependencies, binaries, secrets, locks, and huge files", () => {
    expect(shouldExcludePath("node_modules/pkg/index.js")).toBe(true);
    expect(shouldExcludePath("src/logo.png")).toBe(true);
    expect(shouldExcludePath(".env")).toBe(true);
    expect(shouldExcludePath("package-lock.json")).toBe(true);
    expect(shouldExcludePath("src/app.ts", 900_000)).toBe(true);
  });

  it("keeps useful source and docs", () => {
    expect(shouldExcludePath("README.md")).toBe(false);
    expect(shouldExcludePath("src/agent.ts")).toBe(false);
    expect(shouldExcludePath("eval/benchmark.py")).toBe(false);
  });
});

describe("file scoring", () => {
  it("prioritizes README, entrypoints, and eval files", () => {
    expect(scoreFilePath("README.md").score).toBeGreaterThan(scoreFilePath("misc/note.md").score);
    expect(scoreFilePath("src/main.py").score).toBeGreaterThan(scoreFilePath("src/util.py").score);
    expect(scoreFilePath("eval/benchmark.py").score).toBeGreaterThan(scoreFilePath("assets/style.css").score);
  });

  it("returns candidates in priority order", () => {
    const selected = selectCandidateFiles([
      { path: "src/util.ts", size: 10 },
      { path: "README.md", size: 10 },
      { path: "node_modules/a.js", size: 10 }
    ]);
    expect(selected.map((file) => file.path)).toEqual(["README.md", "src/util.ts"]);
  });
});
