import { z } from "zod";
import {
  currentQuestionText,
  getInterviewSession,
  restoreInterviewSession
} from "@/lib/interview";
import { formatModelError, generatePracticeHelp } from "@/lib/llm";
import type { InterviewSession } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const requestSchema = z.object({
  sessionId: z.string().min(1),
  kind: z.enum(["hint", "answer"]),
  restoreSession: z.custom<InterviewSession>().optional()
});

export async function POST(request: Request) {
  let body: z.infer<typeof requestSchema>;
  try {
    body = requestSchema.parse(await request.json());
  } catch {
    return Response.json({ error: "请求体需要包含 sessionId 和 kind。" }, { status: 400 });
  }

  let session = getInterviewSession(body.sessionId);
  if (!session && body.restoreSession?.id === body.sessionId) {
    session = restoreInterviewSession(body.restoreSession);
  }
  if (!session) {
    return Response.json({ error: "会话不存在或已过期，请重新开始练习。" }, { status: 404 });
  }

  const question = session.questions[session.currentIndex];
  if (!question) {
    return Response.json({ error: "当前没有可练习的问题。" }, { status: 409 });
  }

  try {
    const text = await generatePracticeHelp({
      repoFullName: session.repoFullName,
      understanding: session.understanding,
      question,
      questionText: currentQuestionText(session),
      kind: body.kind
    });
    return Response.json({ text });
  } catch (error) {
    return Response.json({ error: `AI 生成失败：${formatModelError(error)}` }, { status: 500 });
  }
}
