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

  const baseQuestions = Array.isArray(body.result.questions) ? body.result.questions : [];
  if (baseQuestions.length === 0) {
    return Response.json({ error: "当前分析结果没有可用题目种子，请重新分析仓库。" }, { status: 400 });
  }

  const warnings: string[] = [];
  let questions: InterviewQuestion[];
  if (body.questionSet?.questions?.length) {
    warnings.push("已复用历史题集。");
    questions = body.questionSet.questions;
  } else if (!getApiKey()) {
    warnings.push("未配置模型 API key，已使用 Survey 题目种子创建题集。");
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
      warnings.push(`新题集生成失败，已使用 Survey 题目种子：${formatModelError(error)}`);
      questions = baseQuestions;
    }
  }

  const questionSet = buildQuestionSet(body.result.repo.fullName, body.mode, questions, Boolean(body.questionSet));
  const session = createInterviewSession({
    repoFullName: body.result.repo.fullName,
    understanding: body.result.understanding,
    questions: questionSet.questions
  });
  if (session.questions.length === 0) {
    return Response.json({ error: "题集为空，无法开始练习或测试。" }, { status: 400 });
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
  const label = `${reused ? "复用" : "新"}${mode === "practice" ? "练习题集" : "测试题集"}`;
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
