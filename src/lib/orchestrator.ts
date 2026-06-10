import { createEventChannel, type EventChannel } from "./events";
import { fetchRepoContext, fetchSingleFile, mapWithConcurrency } from "./github";
import {
  assembleResponse,
  buildFallbackResponse,
  fallbackInterrogation,
  formatModelError,
  generateDimensionDigest,
  generateExamAndQuestions,
  generateResearchPlan,
  getApiKey,
  streamExamAndQuestions,
  synthesizeUnderstanding
} from "./llm";
import { createInterviewSession } from "./interview";
import { matchKaomianQuestions } from "./kaomian";
import { buildRepoMapText, computeCentrality, skeletonizeFile } from "./repomap";
import { buildUnderstandingMarkdown } from "./report";
import type {
  AnalyzeMode,
  DimensionDigest,
  PaperCodeMapItem,
  RepoContext,
  RepoFileContent,
  ResearchPlanSummary,
  SseEvent,
  Understanding
} from "./types";

// 并发深读维度数：每次 LLM 调用有 ~13s 固定网关延迟，多维度一批跑完能省批次等待
const WORKER_CONCURRENCY = clampInt(process.env.RESEARCH_CONCURRENCY, 6, 1, 16);
// digest 轮次：默认 2 轮（gap 追读补全证据，质量底线，不可降到 1）
const MAX_RESEARCH_ROUNDS = clampInt(process.env.RESEARCH_MAX_ROUNDS, 2, 2, 3);
const MAX_EXTRA_FILES = 8;
const MAX_REQUESTED_FILES_PER_DIMENSION = 3;
const WORKER_INPUT_CHAR_BUDGET = 160_000;

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

type DimensionAssignment = {
  key: ResearchPlanSummary["dimensions"][number]["key"];
  goal: string;
  files: string[];
  openQuestions?: string[];
};

export function runAnalysisPipeline(repositoryUrl: string, mode: AnalyzeMode): AsyncGenerator<SseEvent> {
  const channel = createEventChannel();
  void run(repositoryUrl, mode, channel)
    .catch((error) => {
      channel.emit({ type: "error", message: error instanceof Error ? error.message : "分析失败。" });
    })
    .finally(() => channel.close());
  return channel.iterate();
}

async function run(repositoryUrl: string, mode: AnalyzeMode, channel: EventChannel): Promise<void> {
  channel.emit({ type: "stage", stage: "scout", detail: "读取仓库元数据、文件树并抓取证据文件" });
  const context = await fetchRepoContext(repositoryUrl, {
    onFileFetched: (path) => channel.emit({ type: "file_read", path })
  });
  const warnings: string[] = [...context.warnings];

  if (!getApiKey()) {
    warnings.push("未配置 OPENAI_API_KEY 或 TOKENDANCE_API_KEY，已使用仓库结构生成降级报告。");
    if (mode === "interview") {
      warnings.push("交互面试需要可用的模型，已降级为 survey 报告。");
    }
    finish(channel, buildFallbackResponse(context, warnings));
    return;
  }

  const centrality = computeCentrality(context.files);
  const repoMapText = buildRepoMapText(context, centrality);

  channel.emit({ type: "stage", stage: "plan", detail: "规划研究维度与文件分配" });
  let plan: ResearchPlanSummary;
  try {
    plan = await generateResearchPlan(context, repoMapText);
  } catch (error) {
    warnings.push(`研究规划失败，已使用降级报告：${formatModelError(error)}`);
    finish(channel, buildFallbackResponse(context, warnings));
    return;
  }
  channel.emit({ type: "plan", plan });

  channel.emit({
    type: "stage",
    stage: "research",
    detail: `并行深读 ${plan.dimensions.length} 个研究维度`
  });
  const digests = await runResearchRounds(channel, context, repoMapText, plan, warnings);

  if (digests.length === 0) {
    warnings.push("所有研究维度分析失败，已使用降级报告。");
    finish(channel, buildFallbackResponse(context, warnings));
    return;
  }

  channel.emit({ type: "stage", stage: "synthesize", detail: "合成自洽的仓库理解报告" });
  let understanding;
  let paperCodeMap;
  try {
    ({ understanding, paperCodeMap } = await synthesizeUnderstanding(repoMapText, digests, plan.analysisMode));
  } catch (error) {
    warnings.push(`理解合成失败，已使用降级报告：${formatModelError(error)}`);
    finish(channel, buildFallbackResponse(context, warnings));
    return;
  }

  emitUnderstandingReport(channel, context, { understanding, paperCodeMap }, warnings);

  const kaomianMatches = matchKaomianQuestions([
    ...plan.techTags,
    ...understanding.techStack,
    ...understanding.paperSignals.methodSignals
  ]);
  channel.emit({
    type: "stage",
    stage: "questions",
    detail:
      kaomianMatches.length > 0
        ? `流式生成考核点与分层面试题（匹配到 ${kaomianMatches.length} 道 kaomian 高频题）`
        : "流式生成考核点与分层面试题"
  });
  const interrogationArgs = {
    repoMapText,
    understanding,
    paperCodeMap,
    digests,
    kaomianMatches: kaomianMatches.map(({ question, category, frequency }) => ({ question, category, frequency }))
  };
  let examPoints;
  let questions;
  try {
    ({ examPoints, questions } = await streamExamAndQuestions(interrogationArgs, {
      onExamPoint: (point, index) => channel.emit({ type: "exam_point", point, index }),
      onQuestion: (question, index) =>
        channel.emit({ type: "question", question, index, source: question.source ?? "repo" })
    }));
  } catch (streamError) {
    warnings.push(`流式出题失败，改用一次性出题：${formatModelError(streamError)}`);
    try {
      ({ examPoints, questions } = await generateExamAndQuestions(interrogationArgs));
    } catch (error) {
      warnings.push(`出题失败，已使用基于理解的降级题目：${formatModelError(error)}`);
      ({ examPoints, questions } = fallbackInterrogation(understanding));
    }
    emitInterrogation(channel, examPoints, questions);
  }

  if (examPoints.length === 0) {
    examPoints = fallbackInterrogation(understanding).examPoints;
    examPoints.forEach((point, index) => channel.emit({ type: "exam_point", point, index }));
  }

  const result = assembleResponse(context, { understanding, paperCodeMap, examPoints, questions }, warnings);

  if (mode === "interview") {
    const session = createInterviewSession({
      repoFullName: context.repo.fullName,
      understanding,
      questions: result.questions
    });
    if (session.questions.length > 0) {
      channel.emit({ type: "stage", stage: "interview_ready", detail: "面试官准备完毕，开始模拟面试" });
      channel.emit({
        type: "session",
        sessionId: session.id,
        question: session.questions[0],
        index: 0,
        total: session.questions.length,
        session
      });
    }
  }

  finish(channel, result);
}

function emitInterrogation(
  channel: EventChannel,
  examPoints: ReturnType<typeof fallbackInterrogation>["examPoints"],
  questions: ReturnType<typeof fallbackInterrogation>["questions"]
): void {
  examPoints.forEach((point, index) => channel.emit({ type: "exam_point", point, index }));
  questions.forEach((question, index) =>
    channel.emit({ type: "question", question, index, total: questions.length, source: question.source ?? "repo" })
  );
}

async function runResearchRounds(
  channel: EventChannel,
  context: RepoContext,
  repoMapText: string,
  plan: ResearchPlanSummary,
  warnings: string[]
): Promise<DimensionDigest[]> {
  const contentByPath = new Map(context.files.map((file) => [file.path, file]));
  const digests: DimensionDigest[] = [];
  let extraFilesFetched = 0;

  let assignments: DimensionAssignment[] = plan.dimensions.map((dimension) => ({ ...dimension }));

  for (let round = 1; round <= MAX_RESEARCH_ROUNDS && assignments.length > 0; round++) {
    const roundResults = await mapWithConcurrency(assignments, WORKER_CONCURRENCY, async (assignment) => {
      const filesBlock = buildFilesBlock(assignment.files, contentByPath);
      try {
        const digest = await generateDimensionDigest({
          repoMapText,
          dimensionKey: assignment.key,
          goal: assignment.goal,
          filesBlock,
          openQuestions: assignment.openQuestions
        });
        digest.dimension = assignment.key;
        for (const finding of digest.findings) {
          channel.emit({
            type: "finding",
            dimension: assignment.key,
            claim: finding.claim,
            evidence: finding.evidence,
            confidence: finding.confidence
          });
        }
        return { assignment, digest };
      } catch (error) {
        warnings.push(`维度 ${assignment.key} 第 ${round} 轮分析失败：${formatModelError(error)}`);
        return null;
      }
    });

    const succeeded = roundResults.filter(
      (item): item is { assignment: DimensionAssignment; digest: DimensionDigest } => item !== null
    );
    digests.push(...succeeded.map((item) => item.digest));

    if (round === MAX_RESEARCH_ROUNDS) break;

    const nextAssignments: DimensionAssignment[] = [];
    for (const { assignment, digest } of succeeded) {
      if (digest.openQuestions.length === 0 || digest.requestedFiles.length === 0) continue;

      const grantedFiles: string[] = [];
      for (const path of digest.requestedFiles.slice(0, MAX_REQUESTED_FILES_PER_DIMENSION)) {
        if (contentByPath.has(path)) {
          grantedFiles.push(path);
          continue;
        }
        if (extraFilesFetched >= MAX_EXTRA_FILES) continue;
        if (!context.treeFiles.some((file) => file.path === path)) continue;

        const fetched = await fetchSingleFile(
          context.repo.owner,
          context.repo.name,
          context.repo.defaultBranch,
          path
        );
        if (!fetched) {
          warnings.push(`补读文件失败：${path}`);
          continue;
        }
        extraFilesFetched += 1;
        const file: RepoFileContent = {
          path,
          size: fetched.content.length,
          score: 0,
          category: "other",
          reason: `维度 ${assignment.key} 第二轮补读`,
          truncated: fetched.truncated,
          content: fetched.content
        };
        contentByPath.set(path, file);
        context.files.push(file);
        channel.emit({ type: "file_read", path, dimension: assignment.key });
        grantedFiles.push(path);
      }

      if (grantedFiles.length > 0) {
        nextAssignments.push({
          key: assignment.key,
          goal: assignment.goal,
          files: grantedFiles,
          openQuestions: digest.openQuestions
        });
      }
    }
    assignments = nextAssignments;
  }

  return digests;
}

function buildFilesBlock(paths: string[], contentByPath: Map<string, RepoFileContent>): string {
  let total = 0;
  const blocks: string[] = [];
  for (const path of paths) {
    const file = contentByPath.get(path);
    if (!file) continue;
    const { content, skeletonized } = skeletonizeFile(path, file.content);
    const header = `\n--- File: ${path}${skeletonized ? "（已骨架化）" : ""}${file.truncated ? "（已截断）" : ""} ---\n`;
    const block = header + content;
    if (total + block.length > WORKER_INPUT_CHAR_BUDGET) {
      blocks.push(`\n--- File: ${path}（超出输入预算，未包含内容）---\n`);
      continue;
    }
    total += block.length;
    blocks.push(block);
  }
  return blocks.join("\n");
}

function emitUnderstandingReport(
  channel: EventChannel,
  context: RepoContext,
  parts: { understanding: Understanding; paperCodeMap: PaperCodeMapItem[] },
  warnings: string[]
): void {
  const preliminary = {
    repo: context.repo,
    analysisMode: parts.understanding.analysisMode,
    paperSignals: parts.understanding.paperSignals,
    researchArtifacts: context.researchArtifacts,
    paperCodeMap: parts.paperCodeMap,
    understanding: parts.understanding,
    examPoints: [],
    questions: [],
    evidenceFiles: context.files.map(({ content: _content, ...file }) => file),
    warnings
  };
  const markdown = buildUnderstandingMarkdown(preliminary);
  for (const section of markdown.split(/(?=^## )/m)) {
    if (section.trim().length > 0) channel.emit({ type: "report_delta", delta: section });
  }
}

function finish(channel: EventChannel, result: ReturnType<typeof buildFallbackResponse>): void {
  channel.emit({ type: "result", result });
  channel.emit({ type: "done" });
}
