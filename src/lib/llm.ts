import { z } from "zod";
import {
  buildMarkdownReport,
  fallbackExamPoints,
  fallbackPaperCodeMap,
  fallbackQuestions,
  fallbackUnderstanding
} from "./report";
import type {
  AnalysisMode,
  AnalyzeResponse,
  DimensionDigest,
  ExamPoint,
  InterviewQuestion,
  PaperCodeMapItem,
  RepoContext,
  ResearchPlanSummary,
  Understanding
} from "./types";

const SYSTEM_PROMPT =
  "你是 AI 算法岗项目考核面试官。你的工作：深入理解论文/AI 项目制 GitHub 仓库（方法、训练、评测、数据、配置、复现证据），并基于仓库证据生成项目考核计划。所有结论必须能落到具体文件证据，不要编造没有证据的内容，不要按通用软件工程评分。你只返回 JSON 对象，不要 Markdown，不要解释。";

const stringArraySchema = z.preprocess((value) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object") {
        const record = item as Record<string, unknown>;
        const candidate = record.path ?? record.file ?? record.evidence ?? record.claim;
        if (typeof candidate === "string") return candidate;
        return JSON.stringify(item);
      }
      return item == null ? null : String(item);
    })
    .filter((item): item is string => typeof item === "string" && item.length > 0);
}, z.array(z.string()));

function lenientEnum<const T extends readonly [string, ...string[]]>(values: T, fallback: T[number]) {
  return z.preprocess(
    (value) => (typeof value === "string" && (values as readonly string[]).includes(value) ? value : fallback),
    z.enum(values)
  );
}

function lenientBoolean(fallback: boolean) {
  return z.preprocess((value) => {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      if (/^(true|yes|是|有)$/i.test(value.trim())) return true;
      if (/^(false|no|否|无|未识别)$/i.test(value.trim())) return false;
    }
    return fallback;
  }, z.boolean());
}

const analysisModeSchema = lenientEnum(["paper-code", "general-code", "unknown"], "unknown");

const dimensionKeyValues = ["overview", "method", "training", "evaluation", "data"] as const;
const dimensionKeySchema = z.enum(dimensionKeyValues);

const planSchema = z.object({
  analysisMode: analysisModeSchema,
  techTags: stringArraySchema,
  dimensions: z.preprocess(
    (value) => {
      if (!Array.isArray(value)) return [];
      return value.filter(
        (item) =>
          item &&
          typeof item === "object" &&
          (dimensionKeyValues as readonly string[]).includes((item as Record<string, unknown>).key as string)
      );
    },
    z
      .array(
        z.object({
          key: dimensionKeySchema,
          goal: z.string().default(""),
          files: stringArraySchema
        })
      )
      .min(1)
      .max(5)
  )
});

const digestSchema = z.object({
  dimension: dimensionKeySchema.default("overview"),
  summary: z.string().default(""),
  findings: z.preprocess(
    (value) => (Array.isArray(value) ? value : []),
    z.array(
      z.object({
        claim: z.string(),
        evidence: stringArraySchema,
        confidence: lenientEnum(["high", "medium", "low"], "medium")
      })
    )
  ),
  claimCodeLinks: z.preprocess(
    (value) => (Array.isArray(value) ? value : []),
    z.array(
      z.object({
        claim: z.string(),
        code: stringArraySchema,
        experiments: stringArraySchema
      })
    )
  ),
  askPoints: stringArraySchema,
  openQuestions: stringArraySchema,
  requestedFiles: stringArraySchema
});

const understandingSchema = z.object({
  analysisMode: analysisModeSchema,
  paperSignals: z
    .object({
      venues: stringArraySchema,
      paperLinks: stringArraySchema,
      citationFound: lenientBoolean(false),
      officialImplementation: lenientBoolean(false),
      benchmarkSignals: stringArraySchema,
      trainingSignals: stringArraySchema,
      evaluationSignals: stringArraySchema,
      methodSignals: stringArraySchema
    })
    .default({
      venues: [],
      paperLinks: [],
      citationFound: false,
      officialImplementation: false,
      benchmarkSignals: [],
      trainingSignals: [],
      evaluationSignals: [],
      methodSignals: []
    }),
  summary: z.string().default(""),
  problemSetting: z.string().default("未明确识别"),
  paperClaims: stringArraySchema,
  techStack: stringArraySchema,
  entryPoints: stringArraySchema,
  coreModules: z.preprocess(
    (value) => (Array.isArray(value) ? value : []),
    z.array(
      z.object({
        name: z.string(),
        responsibility: z.string(),
        evidence: stringArraySchema
      })
    )
  ),
  mainFlow: stringArraySchema,
  dataFlow: stringArraySchema,
  evaluationSignals: stringArraySchema,
  reproductionRecipe: stringArraySchema,
  methodCodeMap: stringArraySchema,
  experimentEvidence: stringArraySchema,
  keyHyperparameters: stringArraySchema,
  deploymentNotes: stringArraySchema,
  contributionHypotheses: stringArraySchema
});

const paperCodeMapSchema = z.object({
  claim: z.string(),
  codeEvidence: stringArraySchema,
  experimentEvidence: stringArraySchema,
  interviewRisk: z.string()
});

const synthesisSchema = understandingSchema.extend({
  paperCodeMap: z
    .preprocess((value) => (Array.isArray(value) ? value : []), z.array(paperCodeMapSchema).max(8))
    .default([])
});

const examPointSchema = z.object({
  title: z.string(),
  riskLevel: lenientEnum(["low", "medium", "high"], "medium"),
  evidence: stringArraySchema,
  whyAsk: z.string().default(""),
  followUps: stringArraySchema
});

const questionSchema = z.object({
  question: z.string(),
  difficulty: lenientEnum(["warmup", "medium", "hard"], "medium"),
  evidence: stringArraySchema,
  whyAsk: z.string().default(""),
  expectedAnswer: stringArraySchema,
  redFlags: stringArraySchema,
  followUps: stringArraySchema,
  source: lenientEnum(["repo", "kaomian"], "repo")
});

const interrogationSchema = z.object({
  examPoints: z.preprocess(
    (value) => (Array.isArray(value) ? value : []),
    z.array(examPointSchema).min(1).max(8)
  ),
  questions: z.preprocess(
    (value) => (Array.isArray(value) ? value : []),
    z.array(questionSchema).min(1).max(12)
  )
});

export function getApiKey(): string | undefined {
  return process.env.OPENAI_API_KEY || process.env.TOKENDANCE_API_KEY;
}

export async function generateResearchPlan(
  context: RepoContext,
  repoMapText: string
): Promise<ResearchPlanSummary> {
  const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `${repoMapText}

README（截取）：
${context.readme.slice(0, 12_000)}

任务：为这个仓库制定深度研究计划。返回 JSON：
{
  "analysisMode": "paper-code|general-code|unknown",
  "techTags": ["..."],
  "dimensions": [
    {"key": "overview|method|training|evaluation|data", "goal": "该维度要回答的问题", "files": ["路径"]}
  ]
}

要求：
- dimensions 按仓库实际形态取舍，2-5 个；overview 必须存在，负责项目目标、主流程和贡献定位；纯工程库可以没有 training/evaluation。
- 每个维度的 files 只能从"已读取的证据文件"清单中选 3-8 个路径，按相关性排序，不要发明路径。
- analysisMode：存在论文/复现/benchmark/citation 信号选 paper-code。
- techTags 8-15 个，用于检索高频面试题库，写具体技术点（如 RAG、PPO、diffusion、attention、对比学习、数据增强），不要写宽泛词（如 Python、深度学习）。`
      }
    ];
  const parsed = await withRetry("plan", async () =>
    parseModelJson(planSchema, await chatJson(messages, 180_000), "plan")
  );

  const known = new Set(context.files.map((file) => file.path));
  const dimensions = parsed.dimensions
    .map((dimension) => ({ ...dimension, files: dimension.files.filter((path) => known.has(path)) }))
    .filter((dimension) => dimension.files.length > 0);
  if (dimensions.length === 0) {
    throw new Error("研究计划没有给出可用的文件分配。");
  }
  return { analysisMode: parsed.analysisMode, techTags: parsed.techTags, dimensions };
}

export async function generateDimensionDigest(args: {
  repoMapText: string;
  dimensionKey: string;
  goal: string;
  filesBlock: string;
  openQuestions?: string[];
}): Promise<DimensionDigest> {
  const followUpBlock =
    args.openQuestions && args.openQuestions.length > 0
      ? `\n上一轮未决问题（优先回答）：\n${args.openQuestions.map((q) => `- ${q}`).join("\n")}\n`
      : "";

  const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `${args.repoMapText}

你本次只负责研究维度「${args.dimensionKey}」：${args.goal}
${followUpBlock}
分配给你的文件内容：
${args.filesBlock}

返回 JSON：
{
  "dimension": "${args.dimensionKey}",
  "summary": "不超过 3 句话的维度结论",
  "findings": [{"claim": "发现", "evidence": ["文件路径，可带 :起-止行"], "confidence": "high|medium|low"}],
  "claimCodeLinks": [{"claim": "论文/README 主张", "code": ["实现文件"], "experiments": ["实验/评测/配置文件"]}],
  "askPoints": ["该维度最值得面试官追问的具体点（绑定文件）"],
  "openQuestions": ["看完现有文件仍回答不了的问题"],
  "requestedFiles": ["需要补读的文件路径，必须出现在目录结构中，最多 3 个"]
}

要求：
- findings 3-7 条，每条必须有 evidence；没有证据的猜测不要写。
- askPoints 3-6 条，写"问什么 + 为什么值得问"。
- 不需要补读文件时 requestedFiles 返回 []。`
      }
    ];
  return withRetry(`digest:${args.dimensionKey}`, async () =>
    parseModelJson(digestSchema, await chatJson(messages, 180_000), `digest:${args.dimensionKey}`)
  );
}

export async function synthesizeUnderstanding(
  repoMapText: string,
  digests: DimensionDigest[],
  analysisModeHint: AnalysisMode = "unknown"
): Promise<{ understanding: Understanding; paperCodeMap: PaperCodeMapItem[] }> {
  const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `${repoMapText}

各维度研究 digest（来自并行深读，原始代码不再提供）：
${JSON.stringify(digests, null, 2)}

研究规划阶段已把 analysisMode 判定为 ${analysisModeHint}；除非 digest 证据明显矛盾，否则沿用该值（只能取 paper-code、general-code、unknown 三者之一）。

任务：把所有 digest 合成为一份自洽的仓库理解 JSON。返回字段：
analysisMode, paperSignals{venues,paperLinks,citationFound,officialImplementation,benchmarkSignals,trainingSignals,evaluationSignals,methodSignals}, summary, problemSetting, paperClaims, techStack, entryPoints, coreModules[{name,responsibility,evidence}], mainFlow, dataFlow, evaluationSignals, reproductionRecipe, methodCodeMap, experimentEvidence, keyHyperparameters, deploymentNotes, contributionHypotheses, paperCodeMap[{claim,codeEvidence,experimentEvidence,interviewRisk}]

要求：
- 必须消解 digest 之间的冲突；不确定的地方在对应字段里写明"不确定"。
- paperClaims 写论文/README/项目页声称解决什么、贡献是什么。
- methodCodeMap 写"方法概念 -> 代码文件"的映射。
- paperCodeMap 是面试视角的"主张 -> 代码证据 -> 实验证据 -> 追问风险"，3-8 条。
- deploymentNotes 只记录推理/demo/运行约束。`
      }
    ];
  const parsed = await withRetry("synthesize", async () =>
    parseModelJson(synthesisSchema, await chatJson(messages, 240_000), "synthesize")
  );
  const { paperCodeMap, ...understanding } = parsed;
  return { understanding, paperCodeMap };
}

export type KaomianPromptItem = {
  question: string;
  category: string;
  frequency: number;
};

type InterrogationArgs = {
  repoMapText: string;
  understanding: Understanding;
  paperCodeMap: PaperCodeMapItem[];
  digests: DimensionDigest[];
  kaomianMatches?: KaomianPromptItem[];
};

function buildKaomianBlock(matches: KaomianPromptItem[] | undefined): string {
  if (!matches || matches.length === 0) {
    return "真实面经高频题：本仓库没有匹配到相关高频题，全部题目从仓库证据出发，source 一律为 repo。";
  }
  return `真实面经高频题（kaomian 题库按技术标签匹配，按出现频次排序）：
${matches.map((item) => `- [${item.frequency}帖|${item.category}] ${item.question}`).join("\n")}

高频题使用规则：
- 仅当高频题与本仓库证据相关时，把它改写成绑定本仓库具体文件/模块的追问，该题输出 "source":"kaomian"。
- 不要照抄高频题题面；与仓库无关的高频题直接忽略。
- questions 中 source=kaomian 的最多 4 道，其余必须从仓库证据出发（"source":"repo"）。`;
}

function buildInterrogationContext(args: InterrogationArgs): string {
  const askPoints = args.digests.flatMap((digest) =>
    digest.askPoints.map((point) => `[${digest.dimension}] ${point}`)
  );
  return `${args.repoMapText}

仓库理解：
${JSON.stringify(args.understanding, null, 2)}

Paper claim -> 代码/实验证据映射：
${JSON.stringify(args.paperCodeMap, null, 2)}

各维度可出题点：
${askPoints.map((point) => `- ${point}`).join("\n") || "- 无"}

${buildKaomianBlock(args.kaomianMatches)}

任务：生成项目考核点与分层面试题。

内容约束：
- examPoints 5-8 个，questions 8-12 道。
- 追问优先覆盖 method validity、baseline/ablation、data leakage、metric choice、config/hyperparameter、reproducibility、failure cases、论文主张和代码是否一致。
- 不要输出 employability score、code quality score、部署能力评分。
- 不要泛问"这个项目用了什么技术栈"，每道题必须落到具体文件证据。`;
}

export async function generateExamAndQuestions(
  args: InterrogationArgs
): Promise<{ examPoints: ExamPoint[]; questions: InterviewQuestion[] }> {
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `${buildInterrogationContext(args)}

返回 JSON：
{
  "examPoints": [{"title": "...", "riskLevel": "low|medium|high", "evidence": ["路径"], "whyAsk": "...", "followUps": ["..."]}],
  "questions": [{"question": "...", "difficulty": "warmup|medium|hard", "evidence": ["路径"], "whyAsk": "...", "expectedAnswer": ["..."], "redFlags": ["..."], "followUps": ["..."], "source": "repo|kaomian"}]
}`
    }
  ];
  return withRetry("questions", async () =>
    parseModelJson(interrogationSchema, await chatJson(messages, 240_000), "questions")
  );
}

export async function streamExamAndQuestions(
  args: InterrogationArgs,
  handlers: {
    onExamPoint?: (point: ExamPoint, index: number) => void;
    onQuestion?: (question: InterviewQuestion, index: number) => void;
  } = {}
): Promise<{ examPoints: ExamPoint[]; questions: InterviewQuestion[] }> {
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `${buildInterrogationContext(args)}

输出格式：NDJSON——每行一个独立完整的 JSON 对象。不要数组包装，不要 markdown 代码块，不要任何解释文本。
先逐行输出 5-8 个考核点：
{"kind":"examPoint","title":"...","riskLevel":"low|medium|high","evidence":["路径"],"whyAsk":"...","followUps":["..."]}
再逐行输出 8-12 道面试题：
{"kind":"question","question":"...","difficulty":"warmup|medium|hard","evidence":["路径"],"whyAsk":"...","expectedAnswer":["..."],"redFlags":["..."],"followUps":["..."],"source":"repo|kaomian"}`
    }
  ];

  const examPoints: ExamPoint[] = [];
  const questions: InterviewQuestion[] = [];
  let rejectedLines = 0;

  for await (const item of chatNdjson(messages, 300_000)) {
    for (const candidate of Array.isArray(item) ? item : [item]) {
      if (!candidate || typeof candidate !== "object") continue;
      const record = candidate as Record<string, unknown>;
      if (record.kind === "question" || typeof record.question === "string") {
        const parsed = questionSchema.safeParse(record);
        if (parsed.success) {
          questions.push(parsed.data);
          handlers.onQuestion?.(parsed.data, questions.length - 1);
        } else {
          rejectedLines += 1;
        }
      } else if (record.kind === "examPoint" || typeof record.title === "string") {
        const parsed = examPointSchema.safeParse(record);
        if (parsed.success) {
          examPoints.push(parsed.data);
          handlers.onExamPoint?.(parsed.data, examPoints.length - 1);
        } else {
          rejectedLines += 1;
        }
      }
    }
  }

  if (rejectedLines > 0) {
    console.error(`[llm] 流式出题有 ${rejectedLines} 行未通过校验，已跳过。`);
  }
  if (questions.length === 0) {
    throw new Error("流式出题没有产生有效题目。");
  }
  return { examPoints, questions };
}

async function* chatNdjson(messages: ChatMessage[], timeoutMs: number): AsyncGenerator<unknown> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("未配置 OPENAI_API_KEY 或 TOKENDANCE_API_KEY。");

  const chatCompletionsUrl =
    process.env.TOKENDANCE_CHAT_COMPLETIONS_URL ??
    `${(process.env.OPENAI_BASE_URL ?? process.env.TOKENDANCE_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "")}/chat/completions`;
  const response = await fetch(chatCompletionsUrl, {
    method: "POST",
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: getModelName(),
      messages,
      temperature: 0.2,
      stream: true
    })
  });

  if (!response.ok || !response.body) {
    throw new Error(`模型流式请求失败 (${response.status}): ${await response.text()}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let sseBuffer = "";
  let contentBuffer = "";

  const drainLines = function* (flush: boolean) {
    let newlineIndex = contentBuffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = contentBuffer.slice(0, newlineIndex);
      contentBuffer = contentBuffer.slice(newlineIndex + 1);
      const parsed = tryParseNdjsonLine(line);
      if (parsed !== undefined) yield parsed;
      newlineIndex = contentBuffer.indexOf("\n");
    }
    if (flush) {
      const parsed = tryParseNdjsonLine(contentBuffer);
      contentBuffer = "";
      if (parsed !== undefined) yield parsed;
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    sseBuffer += decoder.decode(value, { stream: true });

    let frameEnd = sseBuffer.indexOf("\n\n");
    while (frameEnd !== -1) {
      const frame = sseBuffer.slice(0, frameEnd);
      sseBuffer = sseBuffer.slice(frameEnd + 2);
      frameEnd = sseBuffer.indexOf("\n\n");

      for (const rawLine of frame.split("\n")) {
        if (!rawLine.startsWith("data:")) continue;
        const payload = rawLine.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const chunk = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          contentBuffer += chunk.choices?.[0]?.delta?.content ?? "";
        } catch {
          /* 忽略无法解析的 SSE 帧 */
        }
      }
      yield* drainLines(false);
    }
  }
  yield* drainLines(true);
}

function tryParseNdjsonLine(line: string): unknown {
  const trimmed = line.trim().replace(/^```(?:json)?$/, "").replace(/^```$/, "");
  if (!trimmed || !(trimmed.startsWith("{") || trimmed.startsWith("["))) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

export function assembleResponse(
  context: RepoContext,
  parts: {
    understanding: Understanding;
    paperCodeMap: PaperCodeMapItem[];
    examPoints: ExamPoint[];
    questions: InterviewQuestion[];
  },
  warnings: string[]
): AnalyzeResponse {
  const repaired = ensureEvidence(context, parts.paperCodeMap, parts.examPoints, parts.questions);
  const allWarnings = [...warnings];
  if (repaired.repairedCount > 0) {
    allWarnings.push(`有 ${repaired.repairedCount} 个问题缺少证据，已回退绑定到已读取的仓库文件。`);
  }

  const base = {
    repo: context.repo,
    analysisMode: parts.understanding.analysisMode,
    paperSignals: parts.understanding.paperSignals,
    researchArtifacts: context.researchArtifacts,
    paperCodeMap: repaired.paperCodeMap,
    understanding: parts.understanding,
    examPoints: repaired.examPoints,
    questions: repaired.questions,
    evidenceFiles: context.files.map(({ content: _content, ...file }) => file),
    warnings: allWarnings
  };

  return { ...base, markdownReport: buildMarkdownReport(base) };
}

export function buildFallbackResponse(context: RepoContext, warnings: string[]): AnalyzeResponse {
  const understanding = fallbackUnderstanding(context);
  const paperCodeMap = fallbackPaperCodeMap(context, understanding);
  const examPoints = fallbackExamPoints(understanding);
  const questions = fallbackQuestions(examPoints);
  return assembleResponse(context, { understanding, paperCodeMap, examPoints, questions }, warnings);
}

export function fallbackInterrogation(understanding: Understanding): {
  examPoints: ExamPoint[];
  questions: InterviewQuestion[];
} {
  const examPoints = fallbackExamPoints(understanding);
  return { examPoints, questions: fallbackQuestions(examPoints) };
}

function ensureEvidence(
  context: RepoContext,
  paperCodeMap: PaperCodeMapItem[],
  examPoints: ExamPoint[],
  questions: InterviewQuestion[]
): {
  paperCodeMap: PaperCodeMapItem[];
  examPoints: ExamPoint[];
  questions: InterviewQuestion[];
  repairedCount: number;
} {
  const fallback = context.files[0]?.path ?? "README";
  let repairedCount = 0;
  const repair = <T extends { evidence: string[] }>(item: T): T => {
    if (item.evidence.length > 0) return item;
    repairedCount += 1;
    return { ...item, evidence: [fallback] };
  };
  const repairMap = (item: PaperCodeMapItem): PaperCodeMapItem => {
    if (item.codeEvidence.length > 0 || item.experimentEvidence.length > 0) return item;
    repairedCount += 1;
    return { ...item, codeEvidence: [fallback] };
  };
  return {
    paperCodeMap: paperCodeMap.map(repairMap),
    examPoints: examPoints.map(repair),
    questions: questions.map(repair),
    repairedCount
  };
}

function parseModelJson<T>(schema: { parse: (input: unknown) => T }, text: string, label: string): T {
  const raw = extractJsonObject(text);
  try {
    return schema.parse(raw);
  } catch (error) {
    if (raw && typeof raw === "object") {
      const record = raw as Record<string, unknown>;
      const values = Object.values(record);
      if (values.length === 1 && values[0] && typeof values[0] === "object") {
        try {
          return schema.parse(values[0]);
        } catch {
          /* 解包后仍失败，走原始错误 */
        }
      }
      if (record.understanding && typeof record.understanding === "object") {
        try {
          return schema.parse({
            ...(record.understanding as Record<string, unknown>),
            paperCodeMap:
              record.paperCodeMap ?? (record.understanding as Record<string, unknown>).paperCodeMap ?? []
          });
        } catch {
          /* 摊平后仍失败，走原始错误 */
        }
      }
    }
    if (error instanceof z.ZodError) {
      console.error(`[llm] ${label} 字段校验失败：`, JSON.stringify(error.issues.slice(0, 5)));
    } else {
      console.error(`[llm] ${label} JSON 解析失败，原始输出前 800 字符：`, text.slice(0, 800));
    }
    throw error;
  }
}

async function withRetry<T>(label: string, attempt: () => Promise<T>, retries = 1): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      return await attempt();
    } catch (error) {
      lastError = error;
      if (i < retries) {
        console.error(`[llm] ${label} 第 ${i + 1} 次尝试失败，重试：${formatModelError(error)}`);
      }
    }
  }
  throw lastError;
}

export function extractJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced?.[1] ?? text;
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) {
    throw new Error("模型没有返回 JSON 对象。");
  }
  return JSON.parse(raw.slice(first, last + 1));
}

export function formatModelError(error: unknown): string {
  if (error instanceof z.ZodError) return "模型 JSON 字段不完整或格式不稳定。";
  return error instanceof Error ? error.message : "未知错误";
}

type ChatMessage = { role: "system" | "user"; content: string };

async function chatJson(messages: ChatMessage[], timeoutMs = 240_000): Promise<string> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("未配置 OPENAI_API_KEY 或 TOKENDANCE_API_KEY。");

  const chatCompletionsUrl =
    process.env.TOKENDANCE_CHAT_COMPLETIONS_URL ??
    `${(process.env.OPENAI_BASE_URL ?? process.env.TOKENDANCE_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "")}/chat/completions`;
  const model = getModelName();
  const response = await fetch(chatCompletionsUrl, {
    method: "POST",
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.2,
      response_format: { type: "json_object" }
    })
  });

  if (!response.ok) {
    throw new Error(`模型请求失败 (${response.status}): ${await response.text()}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("模型返回为空。");
  return content;
}

function getModelName(): string {
  if (process.env.OPENAI_MODEL) return process.env.OPENAI_MODEL;
  if (process.env.TOKENDANCE_MODEL) return process.env.TOKENDANCE_MODEL;
  if (process.env.TOKENDANCE_API_KEY) return "deepseek-v4-pro";
  return "gpt-4o-mini";
}
