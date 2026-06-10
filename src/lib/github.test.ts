import { describe, expect, it } from "vitest";
import {
  classifyResearchArtifact,
  parseGitHubUrl,
  scoreFilePath,
  selectCandidateFiles,
  shouldExcludePath
} from "./github";

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
  it("prioritizes README, training, method, config, and eval files", () => {
    expect(scoreFilePath("README.md").score).toBeGreaterThan(scoreFilePath("misc/note.md").score);
    expect(scoreFilePath("train.py").score).toBeGreaterThan(scoreFilePath("src/util.py").score);
    expect(scoreFilePath("models/diffusion/loss.py").score).toBeGreaterThan(scoreFilePath("src/util.py").score);
    expect(scoreFilePath("configs/experiment.yaml").score).toBeGreaterThan(scoreFilePath("src/util.py").score);
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

  it("caps data-heavy benchmark files so method files survive", () => {
    const selected = selectCandidateFiles([
      ...Array.from({ length: 12 }, (_, index) => ({ path: `benchmark/labels_${index}.csv`, size: 100 })),
      { path: "models/diffusion.py", size: 100 },
      { path: "losses/contrastive_loss.py", size: 100 },
      { path: "train.py", size: 100 },
      { path: "eval/metric.py", size: 100 },
      { path: "configs/iclr.yaml", size: 100 }
    ]);

    expect(selected.some((file) => file.path === "models/diffusion.py")).toBe(true);
    expect(selected.some((file) => file.path === "losses/contrastive_loss.py")).toBe(true);
    const selectedLabels = selected.filter((file) => file.path.startsWith("benchmark/labels_"));
    expect(selectedLabels.length).toBeGreaterThan(0);
    expect(selectedLabels.length).toBeLessThanOrEqual(6);
  });
});

describe("paper-code repo detection", () => {
  it("classifies research artifact paths", () => {
    expect(classifyResearchArtifact("README.md")).toBe("paperDocs");
    expect(classifyResearchArtifact("configs/train.yaml")).toBe("configFiles");
    expect(classifyResearchArtifact("scripts/train.sh")).toBe("trainingFiles");
    expect(classifyResearchArtifact("eval/benchmark.py")).toBe("evaluationFiles");
    expect(classifyResearchArtifact("datasets/loader.py")).toBe("dataFiles");
    expect(classifyResearchArtifact("models/transformer.py")).toBe("methodFiles");
  });

  it("does not need deterministic paper-signal parsing for artifact classification", () => {
    const selected = selectCandidateFiles([
      { path: "README.md", size: 100 },
      { path: "configs/iclr.yaml", size: 100 },
      { path: "train.py", size: 100 },
      { path: "eval/benchmark.py", size: 100 },
      { path: "models/method.py", size: 100 }
    ]);

    expect(selected.map((file) => file.category)).toContain("paperDocs");
    expect(selected.map((file) => file.category)).toContain("configFiles");
    expect(selected.map((file) => file.category)).toContain("trainingFiles");
    expect(selected.map((file) => file.category)).toContain("evaluationFiles");
    expect(selected.map((file) => file.category)).toContain("methodFiles");
  });
});
