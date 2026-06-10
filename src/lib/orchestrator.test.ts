import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DimensionDigest, RepoContext, RepoFileContent, SseEvent } from "./types";

// 在 orchestrator 模块加载前启用 2 轮，覆盖默认 1 轮，以便测试 gap 追读的第二轮
vi.hoisted(() => {
  process.env.RESEARCH_MAX_ROUNDS = "2";
});

vi.mock("./github", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./github")>();
  return { ...actual, fetchRepoContext: vi.fn(), fetchSingleFile: vi.fn() };
});

vi.mock("./llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./llm")>();
  return {
    ...actual,
    getApiKey: vi.fn(),
    generateResearchPlan: vi.fn(),
    generateDimensionDigest: vi.fn(),
    synthesizeUnderstanding: vi.fn(),
    generateExamAndQuestions: vi.fn(),
    streamExamAndQuestions: vi.fn()
  };
});

import { fetchRepoContext, fetchSingleFile } from "./github";
import {
  generateDimensionDigest,
  generateResearchPlan,
  getApiKey,
  streamExamAndQuestions,
  synthesizeUnderstanding
} from "./llm";
import { runAnalysisPipeline } from "./orchestrator";
import { fallbackUnderstanding } from "./report";

function fakeContext(extraTreeFiles: string[] = []): RepoContext {
  const files: RepoFileContent[] = [
    {
      path: "README.md",
      size: 10,
      score: 120,
      category: "paperDocs",
      reason: "README/paper overview",
      truncated: false,
      content: "# Demo project"
    },
    {
      path: "train.py",
      size: 10,
      score: 100,
      category: "trainingFiles",
      reason: "training entry",
      truncated: false,
      content: "import torch"
    }
  ];
  return {
    repo: {
      owner: "o",
      name: "r",
      fullName: "o/r",
      defaultBranch: "main",
      htmlUrl: "https://github.com/o/r",
      description: null,
      language: "Python",
      stars: 1,
      fileCount: files.length + extraTreeFiles.length
    },
    readme: "# Demo project",
    files,
    treeFiles: [...files.map((file) => ({ path: file.path, size: file.size })), ...extraTreeFiles.map((path) => ({ path, size: 10 }))],
    analysisMode: "unknown",
    paperSignals: {
      venues: [],
      paperLinks: [],
      citationFound: false,
      officialImplementation: false,
      benchmarkSignals: [],
      trainingSignals: [],
      evaluationSignals: [],
      methodSignals: []
    },
    researchArtifacts: {
      paperDocs: ["README.md"],
      methodFiles: [],
      trainingFiles: ["train.py"],
      evaluationFiles: [],
      configFiles: [],
      dataFiles: [],
      demoFiles: [],
      scripts: []
    },
    warnings: []
  };
}

function digestFor(dimension: DimensionDigest["dimension"], overrides: Partial<DimensionDigest> = {}): DimensionDigest {
  return {
    dimension,
    summary: "总结",
    findings: [{ claim: "核心方法在 train.py", evidence: ["train.py"], confidence: "high" }],
    claimCodeLinks: [],
    askPoints: ["为什么用这个训练循环"],
    openQuestions: [],
    requestedFiles: [],
    ...overrides
  };
}

async function collectEvents(repositoryUrl: string): Promise<SseEvent[]> {
  const events: SseEvent[] = [];
  for await (const event of runAnalysisPipeline(repositoryUrl, "survey")) events.push(event);
  return events;
}

async function collectEventsForMode(repositoryUrl: string, mode: "survey" | "interview" | "practice"): Promise<SseEvent[]> {
  const events: SseEvent[] = [];
  for await (const event of runAnalysisPipeline(repositoryUrl, mode)) events.push(event);
  return events;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runAnalysisPipeline", () => {
  it("falls back to degraded report when no api key is configured", async () => {
    vi.mocked(fetchRepoContext).mockResolvedValue(fakeContext());
    vi.mocked(getApiKey).mockReturnValue(undefined);

    const events = await collectEvents("https://github.com/o/r");
    const types = events.map((event) => event.type);
    expect(types).toEqual(["stage", "result", "done"]);
    expect(generateResearchPlan).not.toHaveBeenCalled();

    const result = events.find((event) => event.type === "result");
    expect(result && result.type === "result" && result.result.warnings.join()).toContain("降级");
  });

  it("emits plan, findings, report deltas and final result on the happy path", async () => {
    const context = fakeContext();
    vi.mocked(fetchRepoContext).mockImplementation(async (_url, options) => {
      options?.onFileFetched?.("README.md");
      return context;
    });
    vi.mocked(getApiKey).mockReturnValue("key");
    vi.mocked(generateResearchPlan).mockResolvedValue({
      analysisMode: "paper-code",
      techTags: ["rag"],
      dimensions: [{ key: "overview", goal: "项目目标", files: ["README.md", "train.py"] }]
    });
    vi.mocked(generateDimensionDigest).mockResolvedValue(digestFor("overview"));
    const understanding = { ...fallbackUnderstanding(context), analysisMode: "paper-code" as const };
    vi.mocked(synthesizeUnderstanding).mockResolvedValue({ understanding, paperCodeMap: [] });
    vi.mocked(streamExamAndQuestions).mockImplementation(async (_args, handlers) => {
      const examPoints = [
        { title: "考核点", riskLevel: "medium" as const, evidence: ["train.py"], whyAsk: "原因", followUps: [] }
      ];
      const questions = [
        {
          question: "训练入口在哪",
          difficulty: "warmup" as const,
          evidence: ["train.py"],
          whyAsk: "确认理解",
          expectedAnswer: ["train.py"],
          redFlags: [],
          followUps: []
        }
      ];
      handlers?.onExamPoint?.(examPoints[0], 0);
      handlers?.onQuestion?.(questions[0], 0);
      return { examPoints, questions };
    });

    const events = await collectEvents("https://github.com/o/r");
    const types = events.map((event) => event.type);

    expect(types.slice(0, 2)).toEqual(["stage", "file_read"]);
    expect(types).toContain("plan");
    expect(types).toContain("finding");
    expect(types.filter((type) => type === "report_delta").length).toBeGreaterThan(1);
    expect(types).toContain("exam_point");
    expect(types).toContain("question");
    expect(types.slice(-2)).toEqual(["result", "done"]);

    const result = events.find((event) => event.type === "result");
    expect(result && result.type === "result" && result.result.analysisMode).toBe("paper-code");
  });

  it("creates an interview session for practice mode", async () => {
    const context = fakeContext();
    vi.mocked(fetchRepoContext).mockResolvedValue(context);
    vi.mocked(getApiKey).mockReturnValue("key");
    vi.mocked(generateResearchPlan).mockResolvedValue({
      analysisMode: "general-code",
      techTags: [],
      dimensions: [{ key: "overview", goal: "项目目标", files: ["README.md"] }]
    });
    vi.mocked(generateDimensionDigest).mockResolvedValue(digestFor("overview"));
    vi.mocked(synthesizeUnderstanding).mockResolvedValue({
      understanding: fallbackUnderstanding(context),
      paperCodeMap: []
    });
    vi.mocked(streamExamAndQuestions).mockResolvedValue({
      examPoints: [{ title: "t", riskLevel: "medium", evidence: ["README.md"], whyAsk: "w", followUps: [] }],
      questions: [
        {
          question: "q",
          difficulty: "warmup",
          evidence: ["README.md"],
          whyAsk: "w",
          expectedAnswer: ["a"],
          redFlags: [],
          followUps: []
        }
      ]
    });

    const events = await collectEventsForMode("https://github.com/o/r", "practice");

    expect(events.some((event) => event.type === "session")).toBe(true);
  });

  it("grants requested files and runs a second research round", async () => {
    const context = fakeContext(["configs/exp.yaml"]);
    vi.mocked(fetchRepoContext).mockResolvedValue(context);
    vi.mocked(fetchSingleFile).mockResolvedValue({ content: "lr: 1e-4", truncated: false });
    vi.mocked(getApiKey).mockReturnValue("key");
    vi.mocked(generateResearchPlan).mockResolvedValue({
      analysisMode: "paper-code",
      techTags: [],
      dimensions: [{ key: "training", goal: "训练配置", files: ["train.py"] }]
    });
    vi.mocked(generateDimensionDigest)
      .mockResolvedValueOnce(
        digestFor("training", {
          openQuestions: ["学习率是多少"],
          requestedFiles: ["configs/exp.yaml"]
        })
      )
      .mockResolvedValueOnce(digestFor("training"));
    vi.mocked(synthesizeUnderstanding).mockResolvedValue({
      understanding: fallbackUnderstanding(context),
      paperCodeMap: []
    });
    vi.mocked(streamExamAndQuestions).mockResolvedValue({
      examPoints: [{ title: "t", riskLevel: "high", evidence: ["train.py"], whyAsk: "w", followUps: [] }],
      questions: [
        {
          question: "q",
          difficulty: "hard",
          evidence: ["train.py"],
          whyAsk: "w",
          expectedAnswer: [],
          redFlags: [],
          followUps: []
        }
      ]
    });

    const events = await collectEvents("https://github.com/o/r");

    expect(vi.mocked(generateDimensionDigest)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetchSingleFile)).toHaveBeenCalledWith("o", "r", "main", "configs/exp.yaml");
    const secondCall = vi.mocked(generateDimensionDigest).mock.calls[1][0];
    expect(secondCall.openQuestions).toEqual(["学习率是多少"]);
    expect(secondCall.filesBlock).toContain("configs/exp.yaml");

    const fileReads = events.filter((event) => event.type === "file_read");
    expect(fileReads.some((event) => event.type === "file_read" && event.path === "configs/exp.yaml")).toBe(true);

    const result = events.find((event) => event.type === "result");
    expect(
      result && result.type === "result" && result.result.evidenceFiles.some((file) => file.path === "configs/exp.yaml")
    ).toBe(true);
  });
});
