import { z } from "zod";
import { buildCodeContext } from "./github";
import {
  buildMarkdownReport,
  fallbackPaperCodeMap,
  fallbackExamPoints,
  fallbackQuestions,
  fallbackUnderstanding
} from "./report";
import type { AnalyzeResponse, ExamPoint, InterviewQuestion, PaperCodeMapItem, RepoContext, Understanding } from "./types";

const stringArraySchema = z.preprocess(
  (value) => (Array.isArray(value) ? value : []),
  z.array(z.string())
);

const understandingSchema = z.object({
  analysisMode: z.enum(["paper-code", "general-code", "unknown"]).default("unknown"),
  paperSignals: z
    .object({
      venues: stringArraySchema,
      paperLinks: stringArraySchema,
      citationFound: z.boolean().default(false),
      officialImplementation: z.boolean().default(false),
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
  summary: z.string(),
  problemSetting: z.string().default("未明确识别"),
  paperClaims: stringArraySchema,
  techStack: stringArraySchema,
  entryPoints: stringArraySchema,
  coreModules: z
    .preprocess((value) => (Array.isArray(value) ? value : []), z
    .array(
      z.object({
        name: z.string(),
        responsibility: z.string(),
        evidence: stringArraySchema
      })
    )),
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

const examPointSchema = z.object({
  title: z.string(),
  riskLevel: z.enum(["low", "medium", "high"]).default("medium"),
  evidence: stringArraySchema,
  whyAsk: z.string(),
  followUps: stringArraySchema
});

const questionSchema = z.object({
  question: z.string(),
  difficulty: z.enum(["warmup", "medium", "hard"]).default("medium"),
  evidence: stringArraySchema,
  whyAsk: z.string(),
  expectedAnswer: stringArraySchema,
  redFlags: stringArraySchema,
  followUps: stringArraySchema
});

const paperCodeMapSchema = z.object({
  claim: z.string(),
  codeEvidence: stringArraySchema,
  experimentEvidence: stringArraySchema,
  interviewRisk: z.string()
});

const reviewSchema = z.object({
  paperCodeMap: z.preprocess(
    (value) => (Array.isArray(value) ? value : []),
    z.array(paperCodeMapSchema).max(8)
  ),
  examPoints: z.preprocess((value) => (Array.isArray(value) ? value : []), z.array(examPointSchema).min(1).max(8)),
  questions: z.preprocess((value) => (Array.isArray(value) ? value : []), z.array(questionSchema).min(1).max(12))
});

export async function analyzeRepoWithLlm(context: RepoContext): Promise<AnalyzeResponse> {
  const { context: codeContext, warnings: contextWarnings } = buildCodeContext(context.files);
  const warnings = [...context.warnings, ...contextWarnings];

  let understanding: Understanding;
  let paperCodeMap: PaperCodeMapItem[];
  let examPoints: ExamPoint[];
  let questions: InterviewQuestion[];

  if (!getApiKey()) {
    warnings.push("未配置 OPENAI_API_KEY 或 TOKENDANCE_API_KEY，已使用仓库结构生成降级报告。");
    understanding = fallbackUnderstanding(context);
    paperCodeMap = fallbackPaperCodeMap(context, understanding);
    examPoints = fallbackExamPoints(understanding);
    questions = fallbackQuestions(examPoints);
  } else {
    try {
      understanding = await generateUnderstanding(context, codeContext);
      const review = await generateInterviewReview(context, understanding, codeContext);
      paperCodeMap = review.paperCodeMap.length > 0 ? review.paperCodeMap : fallbackPaperCodeMap(context, understanding);
      examPoints = review.examPoints;
      questions = review.questions;
    } catch (error) {
      warnings.push(`模型分析失败，已使用降级报告：${formatModelError(error)}`);
      understanding = fallbackUnderstanding(context);
      paperCodeMap = fallbackPaperCodeMap(context, understanding);
      examPoints = fallbackExamPoints(understanding);
      questions = fallbackQuestions(examPoints);
    }
  }

  const repaired = ensureEvidence(context, paperCodeMap, examPoints, questions);
  paperCodeMap = repaired.paperCodeMap;
  examPoints = repaired.examPoints;
  questions = repaired.questions;
  if (repaired.repairedCount > 0) {
    warnings.push(`有 ${repaired.repairedCount} 个问题缺少证据，已回退绑定到已读取的仓库文件。`);
  }

  const base = {
    repo: context.repo,
    analysisMode: understanding.analysisMode,
    paperSignals: understanding.paperSignals,
    researchArtifacts: context.researchArtifacts,
    paperCodeMap,
    understanding,
    examPoints,
    questions,
    evidenceFiles: context.files.map(({ content: _content, ...file }) => file),
    warnings
  };

  return {
    ...base,
    markdownReport: buildMarkdownReport(base)
  };
}

function ensureEvidence(
  context: RepoContext,
  paperCodeMap: PaperCodeMapItem[],
  examPoints: ExamPoint[],
  questions: InterviewQuestion[]
): { paperCodeMap: PaperCodeMapItem[]; examPoints: ExamPoint[]; questions: InterviewQuestion[]; repairedCount: number } {
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

async function generateUnderstanding(context: RepoContext, codeContext: string): Promise<Understanding> {
  const content = await chatJson([
    {
      role: "system",
      content:
        "你是 AI 算法岗项目考核面试官，任务是读懂论文/AI 项目制 GitHub 仓库。优先理解方法、训练、评测、配置和复现证据。只返回 JSON，不要 Markdown。"
    },
    {
      role: "user",
      content: `请基于仓库证据生成“论文/AI 项目理解” JSON。不要编造没有证据的模块，也不要按通用软件工程评分。

先在脑中选择一个或多个轻量理解 skill：benchmark-skill、training-skill、inference-skill、method-skill、data-skill、reproduce-skill、paper-code-general-skill。skill 只影响你如何读仓库：benchmark 重评测协议，training 重训练配置，inference 重推理链路，method 重算法实现，data 重数据处理，reproduce 重命令链和环境。不要单独输出 skill 字段，直接把理解结果落到下面 JSON 字段里。

仓库：${context.repo.fullName}
描述：${context.repo.description ?? "无"}
当前系统不预先判断分析模式或 paper signals。请你基于 README、链接、文件树和代码证据自行判断 analysisMode 和 paperSignals。
Research artifacts：
${JSON.stringify(context.researchArtifacts, null, 2)}
README：
${context.readme}

代码上下文：
${codeContext}

返回字段：
analysisMode, paperSignals{venues,paperLinks,citationFound,officialImplementation,benchmarkSignals,trainingSignals,evaluationSignals,methodSignals}, summary, problemSetting, paperClaims, techStack, entryPoints, coreModules[{name,responsibility,evidence}], mainFlow, dataFlow, evaluationSignals, reproductionRecipe, methodCodeMap, experimentEvidence, keyHyperparameters, deploymentNotes, contributionHypotheses

字段要求：
- analysisMode 必须由你判断为 paper-code、general-code 或 unknown。
- paperSignals 必须由你从 README、website、Hugging Face、arXiv/OpenReview、citation、文件树和代码证据中判断，不要依赖系统预处理。
- paperClaims 写论文/README/项目页面声称解决了什么、贡献是什么。
- methodCodeMap 写“方法概念 -> 代码文件”的映射。
- experimentEvidence 写训练、评测、benchmark、ablation、metric 证据。
- deploymentNotes 只记录推理/demo/运行约束，不要把部署生产化作为主线。`
    }
  ]);
  return understandingSchema.parse(extractJsonObject(content));
}

async function generateInterviewReview(
  context: RepoContext,
  understanding: Understanding,
  codeContext: string
): Promise<{ paperCodeMap: PaperCodeMapItem[]; examPoints: ExamPoint[]; questions: InterviewQuestion[] }> {
  const content = await chatJson([
    {
      role: "system",
      content:
        "你是严厉但公平的 AI 算法岗项目考核面试官。目标是围绕论文主张、方法代码、训练评测和复现风险生成追问，不是代码质量评分。只返回 JSON。"
    },
    {
      role: "user",
      content: `请基于仓库理解和代码证据生成 AI 算法岗项目考核点与面试题。每个主问题必须绑定 evidence 文件路径。

仓库：${context.repo.fullName}
分析模式：${context.analysisMode}
Paper signals：
${JSON.stringify(context.paperSignals, null, 2)}
Research artifacts：
${JSON.stringify(context.researchArtifacts, null, 2)}
仓库理解：
${JSON.stringify(understanding, null, 2)}

代码证据：
${codeContext}

返回 JSON：
{
  "paperCodeMap": [
    {"claim": "...", "codeEvidence": ["path"], "experimentEvidence": ["path"], "interviewRisk": "..."}
  ],
  "examPoints": [
    {"title": "...", "riskLevel": "low|medium|high", "evidence": ["path"], "whyAsk": "...", "followUps": ["..."]}
  ],
  "questions": [
    {"question": "...", "difficulty": "warmup|medium|hard", "evidence": ["path"], "whyAsk": "...", "expectedAnswer": ["..."], "redFlags": ["..."], "followUps": ["..."]}
  ]
}

约束：
- examPoints 5-8 个，questions 8-12 道。
- 追问优先覆盖 method validity、baseline/ablation、data leakage、metric choice、config/hyperparameter、reproducibility、failure cases、论文主张和代码是否一致。
- 不要输出 employability score、code quality score、部署能力评分。
- 不要泛问“这个项目用了什么技术栈”，必须落到具体文件证据。`
    }
  ]);
  return reviewSchema.parse(extractJsonObject(content));
}

async function chatJson(messages: Array<{ role: "system" | "user"; content: string }>): Promise<string> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("未配置 OPENAI_API_KEY 或 TOKENDANCE_API_KEY。");

  const chatCompletionsUrl =
    process.env.TOKENDANCE_CHAT_COMPLETIONS_URL ??
    `${(process.env.OPENAI_BASE_URL ?? process.env.TOKENDANCE_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "")}/chat/completions`;
  const model = getModelName();
  const response = await fetch(chatCompletionsUrl, {
    method: "POST",
    signal: AbortSignal.timeout(20 * 60 * 1000),
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

function getApiKey(): string | undefined {
  return process.env.OPENAI_API_KEY || process.env.TOKENDANCE_API_KEY;
}

function getModelName(): string {
  if (process.env.OPENAI_MODEL) return process.env.OPENAI_MODEL;
  if (process.env.TOKENDANCE_MODEL) return process.env.TOKENDANCE_MODEL;
  if (process.env.TOKENDANCE_API_KEY) return "deepseek-v4-pro";
  return "gpt-4o-mini";
}

function formatModelError(error: unknown): string {
  if (error instanceof z.ZodError) return "模型 JSON 字段不完整或格式不稳定。";
  return error instanceof Error ? error.message : "未知错误";
}
