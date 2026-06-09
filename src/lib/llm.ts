import { z } from "zod";
import { buildCodeContext } from "./github";
import {
  buildMarkdownReport,
  fallbackExamPoints,
  fallbackQuestions,
  fallbackUnderstanding
} from "./report";
import type { AnalyzeResponse, ExamPoint, InterviewQuestion, RepoContext, Understanding } from "./types";

const understandingSchema = z.object({
  summary: z.string(),
  techStack: z.array(z.string()).default([]),
  entryPoints: z.array(z.string()).default([]),
  coreModules: z
    .array(
      z.object({
        name: z.string(),
        responsibility: z.string(),
        evidence: z.array(z.string()).default([])
      })
    )
    .default([]),
  mainFlow: z.array(z.string()).default([]),
  dataFlow: z.array(z.string()).default([]),
  evaluationSignals: z.array(z.string()).default([]),
  deploymentNotes: z.array(z.string()).default([]),
  contributionHypotheses: z.array(z.string()).default([])
});

const examPointSchema = z.object({
  title: z.string(),
  riskLevel: z.enum(["low", "medium", "high"]).default("medium"),
  evidence: z.array(z.string()).default([]),
  whyAsk: z.string(),
  followUps: z.array(z.string()).default([])
});

const questionSchema = z.object({
  question: z.string(),
  difficulty: z.enum(["warmup", "medium", "hard"]).default("medium"),
  evidence: z.array(z.string()).default([]),
  whyAsk: z.string(),
  expectedAnswer: z.array(z.string()).default([]),
  redFlags: z.array(z.string()).default([]),
  followUps: z.array(z.string()).default([])
});

const reviewSchema = z.object({
  examPoints: z.array(examPointSchema).min(1).max(8),
  questions: z.array(questionSchema).min(1).max(12)
});

export async function analyzeRepoWithLlm(context: RepoContext): Promise<AnalyzeResponse> {
  const { context: codeContext, warnings: contextWarnings } = buildCodeContext(context.files);
  const warnings = [...context.warnings, ...contextWarnings];

  let understanding: Understanding;
  let examPoints: ExamPoint[];
  let questions: InterviewQuestion[];

  if (!process.env.OPENAI_API_KEY) {
    warnings.push("未配置 OPENAI_API_KEY，已使用仓库结构生成降级报告。");
    understanding = fallbackUnderstanding(context);
    examPoints = fallbackExamPoints(understanding);
    questions = fallbackQuestions(examPoints);
  } else {
    try {
      understanding = await generateUnderstanding(context, codeContext);
      const review = await generateInterviewReview(context, understanding, codeContext);
      examPoints = review.examPoints;
      questions = review.questions;
    } catch (error) {
      warnings.push(`模型分析失败，已使用降级报告：${error instanceof Error ? error.message : "未知错误"}`);
      understanding = fallbackUnderstanding(context);
      examPoints = fallbackExamPoints(understanding);
      questions = fallbackQuestions(examPoints);
    }
  }

  const repaired = ensureEvidence(context, examPoints, questions);
  examPoints = repaired.examPoints;
  questions = repaired.questions;
  if (repaired.repairedCount > 0) {
    warnings.push(`有 ${repaired.repairedCount} 个问题缺少证据，已回退绑定到已读取的仓库文件。`);
  }

  const base = {
    repo: context.repo,
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
  examPoints: ExamPoint[],
  questions: InterviewQuestion[]
): { examPoints: ExamPoint[]; questions: InterviewQuestion[]; repairedCount: number } {
  const fallback = context.files[0]?.path ?? "README";
  let repairedCount = 0;
  const repair = <T extends { evidence: string[] }>(item: T): T => {
    if (item.evidence.length > 0) return item;
    repairedCount += 1;
    return { ...item, evidence: [fallback] };
  };
  return {
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
      content: "你是项目考核面试官，任务是读懂 GitHub 仓库。只返回 JSON，不要 Markdown。"
    },
    {
      role: "user",
      content: `请基于仓库证据生成仓库理解 JSON。不要编造没有证据的模块。

仓库：${context.repo.fullName}
描述：${context.repo.description ?? "无"}
README：
${context.readme.slice(0, 30_000)}

代码上下文：
${codeContext}

返回字段：
summary, techStack, entryPoints, coreModules[{name,responsibility,evidence}], mainFlow, dataFlow, evaluationSignals, deploymentNotes, contributionHypotheses`
    }
  ]);
  return understandingSchema.parse(extractJsonObject(content));
}

async function generateInterviewReview(
  context: RepoContext,
  understanding: Understanding,
  codeContext: string
): Promise<{ examPoints: ExamPoint[]; questions: InterviewQuestion[] }> {
  const content = await chatJson([
    {
      role: "system",
      content: "你是严厉但公平的项目考核面试官。目标是生成面试导向追问，不是代码质量评分。只返回 JSON。"
    },
    {
      role: "user",
      content: `请基于仓库理解和代码证据生成项目考核点与面试题。每个主问题必须绑定 evidence 文件路径。

仓库：${context.repo.fullName}
仓库理解：
${JSON.stringify(understanding, null, 2)}

代码证据：
${codeContext}

返回 JSON：
{
  "examPoints": [
    {"title": "...", "riskLevel": "low|medium|high", "evidence": ["path"], "whyAsk": "...", "followUps": ["..."]}
  ],
  "questions": [
    {"question": "...", "difficulty": "warmup|medium|hard", "evidence": ["path"], "whyAsk": "...", "expectedAnswer": ["..."], "redFlags": ["..."], "followUps": ["..."]}
  ]
}

约束：examPoints 5-8 个，questions 8-12 道。不要输出 employability score 或 code quality score。`
    }
  ]);
  return reviewSchema.parse(extractJsonObject(content));
}

async function chatJson(messages: Array<{ role: "system" | "user"; content: string }>): Promise<string> {
  const baseUrl = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
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
