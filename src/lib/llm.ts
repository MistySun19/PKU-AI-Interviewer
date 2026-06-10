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
  AnswerEvaluation,
  DimensionDigest,
  ExamPoint,
  InterviewQuestion,
  InterviewSummary,
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
    parseModelJson(planSchema, await chatJson(messages, 180_000, "research"), "plan")
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
  "askPoints": ["该维度最值得深挖的设计决策或风险点，写成'为什么这么做 / 有什么取舍 / 什么时候会失败'式的思路追问，不要写'由哪些部分组成'这类复述点"],
  "openQuestions": ["看完现有文件仍回答不了的问题"],
  "requestedFiles": ["需要补读的文件路径，必须出现在目录结构中，最多 3 个"]
}

要求：
- findings 3-7 条，每条必须有 evidence；没有证据的猜测不要写。
- askPoints 3-6 条，每条聚焦一个值得深挖的设计选择 / 取舍 / 失败风险（用于后续出"为什么这么设计"式的思路题，不是"由哪些部分组成"这种复述点）。
- 不需要补读文件时 requestedFiles 返回 []。`
      }
    ];
  return withRetry(`digest:${args.dimensionKey}`, async () =>
    parseModelJson(digestSchema, await chatJson(messages, 180_000, "research"), `digest:${args.dimensionKey}`)
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
- paperSignals 的 paperLinks/venues/citationFound 优先依据 repo map 中的「README 论文信号行」提取：paperLinks 写完整 URL，venues 写会议/期刊名，存在 bibtex 即 citationFound=true。
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
- 仅当高频题与本仓库相关时，把它改写成针对本仓库的口语追问（同样遵守出题铁律：思路题、面试官口语、题面不报文件路径，证据只进 evidence 字段），该题输出 "source":"kaomian"。
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

任务：模拟一位资深面试官，当面拷打候选人这个项目。生成考核点和分层面试题。

## 出题铁律（最重要，违反即废题）

【铁律一·只出思路题，禁止复述题】
绝不出"X 包含哪几部分 / 有哪些字段 / 由什么组成 / 分哪几个步骤"这种照着文件就能抄答案的清单题。
每道题必须落在以下八类深度追问之一：
- 设计动机：为什么这样设计，而不是更直接的替代方案
- 权衡取舍：这个设计牺牲了什么、换来了什么，什么场景下不划算
- 反事实：如果换一种实现（用 B 代替 A），会引入什么新问题
- 本质抽象：这个设计本质上解决了什么根本问题，代价是什么
- 失败边界：什么样的输入 / 规模 / 数据分布下，这个方案会退化或崩掉
- 批判改进：现有实现最大的可靠性弱点在哪，你会怎么改
- 扩展应用：要加某个新功能，现有架构哪里必须改、为什么
- 横向对比：和业界类似方案的本质区别，各自适合什么场景
（若是论文项目：把"方法为什么成立、实验是否真的支撑结论、baseline/消融/指标选择是否合理、有没有数据泄漏"也按上面八类的追问方式提出，而不是让候选人复述实验设置。）

【铁律二·用面试官口语，不是书面考题】
- 第二人称直接对候选人说话，自然口语、带一点压迫感，像真人面试当面发问。
- 严禁在 question 文本里出现任何文件路径、函数签名、"请基于 xxx.md 说明"、"在 xxx 文件中"这类书面引用。文件证据是面试官的底牌，只写进 evidence 字段，候选人看不到，绝不写进题面。
- 严禁考试腔（"请阐述""试分析""……包含哪些"）。

正例 ✅："你把它拆成两层而不是一层——为什么？这么拆换来了什么、又牺牲了什么？"
       "如果数据量涨十倍，你这套方案会先从哪儿开始扛不住？"
反例 ❌（禁止）："X 的定义格式包含哪些核心部分？请基于 xxx.md 说明。"
              "forward 方法的参数有哪些？"

## 字段与数量
- examPoints 5-8 个：面试官视角"该往哪儿挖"，title 写追问主题（如"两层结构的取舍与失效场景"），evidence 写文件路径。
- questions 8-12 道，难度 warmup→medium→hard 递进；即使是 warmup 也必须是思路题（最浅可用"本质抽象"类，让候选人一句话讲清项目到底解决了什么）。
- 每道 question 的 evidence 字段必须填真实文件路径（系统据此验证答案）；但重申：路径只进 evidence，不进 question 文本。
- whyAsk 写这道题考察候选人哪种能力；expectedAnswer 写好回答该命中的点；redFlags 写什么回答暴露了没真懂。
- 不要输出 employability score、code quality score、部署能力评分。`;
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
}

最后再强调一次：每道 question 都是面试官当面说的一句口语追问（八类思路题之一），evidence 字段里才放文件路径，题面里绝不出现文件路径、函数签名或"请基于 xxx 说明"。`
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
{"kind":"question","question":"...","difficulty":"warmup|medium|hard","evidence":["路径"],"whyAsk":"...","expectedAnswer":["..."],"redFlags":["..."],"followUps":["..."],"source":"repo|kaomian"}

最后再强调一次：每道 question 都是面试官当面说的一句口语追问（八类思路题之一），evidence 字段里才放文件路径，题面里绝不出现文件路径、函数签名或"请基于 xxx 说明"。`
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

const scoreSchema = z.preprocess((value) => {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? Math.min(5, Math.max(1, Math.round(num))) : 3;
}, z.number());

const evaluationSchema = z.object({
  score: scoreSchema,
  verdict: lenientEnum(["strong", "ok", "weak"], "ok"),
  feedback: z.string().default(""),
  gaps: stringArraySchema,
  followUpQuestion: z.string().optional().default("")
});

const interviewSummarySchema = z.object({
  overall: z.string().default(""),
  strengths: stringArraySchema,
  weaknesses: stringArraySchema,
  reviewPlan: stringArraySchema,
  scores: z.preprocess(
    (value) => (Array.isArray(value) ? value : []),
    z.array(z.object({ question: z.string(), score: scoreSchema }))
  )
});

export async function evaluateAnswer(args: {
  repoFullName: string;
  understanding: Understanding;
  question: InterviewQuestion;
  questionText: string;
  answer: string;
}): Promise<AnswerEvaluation> {
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `仓库：${args.repoFullName}
项目理解摘要：${args.understanding.summary}
核心模块：${args.understanding.coreModules.map((module) => module.name).join("、") || "未识别"}

主考题元数据：
${JSON.stringify(
  {
    question: args.question.question,
    evidence: args.question.evidence,
    expectedAnswer: args.question.expectedAnswer,
    redFlags: args.question.redFlags,
    followUps: args.question.followUps
  },
  null,
  2
)}

实际提问（可能是该主考题下的追问）：${args.questionText}

候选人回答：
"""
${args.answer.slice(0, 4000)}
"""

任务：作为面试官评估这个回答。返回 JSON：
{"score": 1到5的整数, "verdict": "strong|ok|weak", "feedback": "对候选人说的 2-3 句中文反馈，先肯定可取之处，再点出最关键缺口", "gaps": ["缺失的关键要点"], "followUpQuestion": "verdict 为 weak 时，用面试官当面说话的口语给一个追问（第二人称、往设计动机/取舍/失败场景方向挖、绝不出现文件路径或'请基于xxx说明'），否则给空字符串"}

评分标准：
- 5/strong：覆盖期望要点，能落到仓库具体文件/实现，无红旗回答。
- 3-4/ok：方向正确但深度不足或漏了关键点。
- 1-2/weak：踩中红旗、答非所问、只有空泛套话，或回答过短/直接说不知道。`
    }
  ];
  return withRetry("evaluate", async () =>
    parseModelJson(evaluationSchema, await chatJson(messages, 120_000), "evaluate")
  );
}

export async function summarizeInterview(args: {
  repoFullName: string;
  understanding: Understanding;
  rounds: Array<{ question: string; answer: string; score: number; verdict: string; gaps: string[] }>;
}): Promise<InterviewSummary> {
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `仓库：${args.repoFullName}
项目理解摘要：${args.understanding.summary}

完整面试记录（按时间顺序）：
${JSON.stringify(args.rounds, null, 2)}

任务：生成面试总结。返回 JSON：
{"overall": "3-5 句总体评价，中文，直接对候选人说", "strengths": ["表现好的点"], "weaknesses": ["薄弱点"], "reviewPlan": ["面试前补坑动作，必须具体可执行，结合本仓库"], "scores": [{"question": "题目", "score": 1到5}]}

要求：
- weaknesses 和 reviewPlan 要落到具体题目和仓库模块，不要空泛建议。
- scores 覆盖每道主考题。`
    }
  ];
  return withRetry("summary", async () =>
    parseModelJson(interviewSummarySchema, await chatJson(messages, 180_000), "summary")
  );
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
type ModelRole = "research" | "final";
const DEFAULT_TOKENDANCE_MODEL = "deepseek-v4-pro";
const DEFAULT_TOKENDANCE_RESEARCH_MODEL = "DeepSeek-V4-Flash";

async function chatJson(messages: ChatMessage[], timeoutMs = 240_000, role: ModelRole = "final"): Promise<string> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("未配置 OPENAI_API_KEY 或 TOKENDANCE_API_KEY。");

  const chatCompletionsUrl =
    process.env.TOKENDANCE_CHAT_COMPLETIONS_URL ??
    `${(process.env.OPENAI_BASE_URL ?? process.env.TOKENDANCE_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "")}/chat/completions`;
  const model = getModelName(role);
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

function getModelName(role: ModelRole = "final"): string {
  if (process.env.OPENAI_MODEL) return process.env.OPENAI_MODEL;
  // 调研阶段（plan/digest）默认走更快的 Flash；可用环境变量覆盖。
  if (role === "research" && process.env.TOKENDANCE_RESEARCH_MODEL) return process.env.TOKENDANCE_RESEARCH_MODEL;
  if (role === "research" && process.env.TOKENDANCE_API_KEY) return DEFAULT_TOKENDANCE_RESEARCH_MODEL;
  if (process.env.TOKENDANCE_MODEL) return process.env.TOKENDANCE_MODEL;
  if (process.env.TOKENDANCE_API_KEY) return DEFAULT_TOKENDANCE_MODEL;
  return "gpt-4o-mini";
}
