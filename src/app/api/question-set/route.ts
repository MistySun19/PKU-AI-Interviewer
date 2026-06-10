import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createInterviewSession } from "@/lib/interview";
import { formatModelError, generateModeQuestionSet, getApiKey } from "@/lib/llm";
import type { AnalyzeResponse, InteractiveMode, InterviewQuestion, QuestionSet } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const requestSchema = z.object({
  mode: z.enum(["practice", "interview"]),
  result: z.custom<AnalyzeResponse>((value) => Boolean(value && typeof value === "object")),
  questionSet: z.custom<QuestionSet>().optional()
});

export async function POST(request: Request) {
  let body: z.infer<typeof requestSchema>;
  try {
    body = requestSchema.parse(await request.json());
  } catch {
    return Response.json({ error: "请求体需要包含 mode 和分析结果。" }, { status: 400 });
  }
  if (body.mode !== "interview") {
    return Response.json({ error: "当前 MVP 只保留 Survey 和可看提示的 Test。" }, { status: 400 });
  }

  const baseQuestions = Array.isArray(body.result.questions) ? body.result.questions : [];
  if (baseQuestions.length === 0) {
    return Response.json({ error: "当前分析结果没有可用追问点，请重新分析仓库。" }, { status: 400 });
  }

  const warnings: string[] = [];
  let questions: InterviewQuestion[];
  if (body.questionSet?.questions?.length) {
    warnings.push("已复用当前测试题集。");
    questions = body.questionSet.questions;
  } else if (!getApiKey()) {
    warnings.push("未配置模型 API key，已使用 Survey 候选追问点创建 Test。");
    questions = baseQuestions;
  } else {
    try {
      questions = await generateModeQuestionSet({
        repoFullName: body.result.repo.fullName,
        mode: body.mode,
        understanding: body.result.understanding,
        examPoints: body.result.examPoints,
        seedQuestions: baseQuestions
      });
    } catch (error) {
      warnings.push(`Test 生成失败，已使用 Survey 候选追问点：${formatModelError(error)}`);
      questions = baseQuestions;
    }
  }

  const questionSet = buildQuestionSet(body.result.repo.fullName, body.mode, normalizeTestQuestions(questions), Boolean(body.questionSet));
  const session = createInterviewSession({
    repoFullName: body.result.repo.fullName,
    understanding: body.result.understanding,
    questions: questionSet.questions
  });
  if (session.questions.length === 0) {
    return Response.json({ error: "追问点为空，无法开始 Test。" }, { status: 400 });
  }

  return Response.json({
    questionSet: { ...questionSet, questions: session.questions },
    sessionId: session.id,
    session,
    question: session.questions[0],
    total: session.questions.length,
    warnings
  });
}

function buildQuestionSet(
  repoFullName: string,
  mode: InteractiveMode,
  questions: InterviewQuestion[],
  reused: boolean
): QuestionSet {
  const createdAt = Date.now();
  const label = `${reused ? "复用" : "新"}真实面经 Test`;
  return {
    id: randomUUID(),
    repoFullName,
    mode,
    createdAt,
    title: `${repoFullName} · ${label}`,
    questions,
    source: mode === "practice" ? "practice" : "test"
  };
}

function normalizeTestQuestions(questions: InterviewQuestion[]): InterviewQuestion[] {
  const seen = new Set<string>();
  const normalized: InterviewQuestion[] = [];
  for (const question of questions) {
    const key = question.question.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    normalized.push({
      ...question,
      question: stripEvidenceFromQuestion(question.question, question.evidence),
      hint: question.hint?.trim() || buildFallbackHint(question)
    });
    if (normalized.length >= 8) break;
  }
  return normalized;
}

function stripEvidenceFromQuestion(question: string, evidence: string[]): string {
  let cleaned = question;
  for (const path of evidence) {
    if (!path || !path.includes(".")) continue;
    const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    cleaned = cleaned
      .replace(new RegExp(`在\\s*[\\\`"']?${escaped}[\\\`"']?\\s*(中|里)[，,]?\\s*`, "g"), "")
      .replace(new RegExp(`[\\\`"']?${escaped}[\\\`"']?\\s*(中|里)的`, "g"), "这里的")
      .replace(new RegExp(`[\\\`"']?${escaped}[\\\`"']?`, "g"), "这个模块");
  }
  return tidyQuestionText(cleaned);
}

function tidyQuestionText(question: string): string {
  return question
    .replace(/这个模块\s+(中|里)/g, "这里")
    .replace(/训练配置\s+这里的/g, "训练配置里的")
    .replace(/复现命令\s*['"]?python\s+这个模块\s+--config\s+这个模块['"]?/g, "复现命令")
    .replace(/['"]复现命令['"]/g, "复现命令")
    .replace(/\s+/g, " ")
    .trim();
}

function buildFallbackHint(question: InterviewQuestion): string {
  const evidence = question.evidence.slice(0, 2).join("、");
  const followUp = question.followUps[0];
  return [
    question.whyAsk ? `先回答它在考察什么：${question.whyAsk}` : "先把回答落到项目里的具体实现或实验上。",
    evidence ? `再主动提到相关证据：${evidence}。` : "",
    followUp ? `最后准备继续解释：${followUp}` : ""
  ]
    .filter(Boolean)
    .join("");
}
