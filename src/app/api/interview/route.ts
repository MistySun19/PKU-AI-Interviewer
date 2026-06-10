import { z } from "zod";
import {
  applyAnswer,
  currentQuestionText,
  decideNextStep,
  getInterviewSession
} from "@/lib/interview";
import { evaluateAnswer, formatModelError, summarizeInterview } from "@/lib/llm";
import type { AnswerEvaluation, InterviewSession, InterviewSummary, SseEvent } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const requestSchema = z.object({
  sessionId: z.string().min(1),
  answer: z.string().default(""),
  end: z.boolean().default(false)
});

export async function POST(request: Request) {
  let body: z.infer<typeof requestSchema>;
  try {
    body = requestSchema.parse(await request.json());
  } catch {
    return Response.json({ error: "请求体需要包含 sessionId 和 answer。" }, { status: 400 });
  }

  const session = getInterviewSession(body.sessionId);
  if (!session) {
    return Response.json({ error: "会话不存在或已过期，请重新开始面试。" }, { status: 404 });
  }
  if (session.busy) {
    return Response.json({ error: "上一轮评估还在进行中，请稍候。" }, { status: 409 });
  }
  if (session.finished) {
    return Response.json({ error: "本场面试已结束，请重新分析仓库开始新面试。" }, { status: 409 });
  }
  if (!body.end && body.answer.trim().length === 0) {
    return Response.json({ error: "回答不能为空。" }, { status: 400 });
  }

  session.busy = true;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: SseEvent) => {
        controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
      };
      // 立即占住首字节并周期心跳：评估/总结都要等 LLM 数十秒，否则公网链路会因首字节或 idle 超时掐连接返回 502
      let alive = true;
      const ping = () => {
        if (!alive) return;
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          alive = false;
        }
      };
      ping();
      const heartbeat = setInterval(ping, 5000);
      try {
        if (body.end) {
          session.finished = true;
          send({ type: "summary", summary: await safeSummarize(session) });
          send({ type: "done" });
          return;
        }

        const questionIndex = session.currentIndex;
        const question = session.questions[questionIndex];
        const questionText = currentQuestionText(session);

        let evaluation: AnswerEvaluation;
        try {
          evaluation = await evaluateAnswer({
            repoFullName: session.repoFullName,
            understanding: session.understanding,
            question,
            questionText,
            answer: body.answer
          });
        } catch (error) {
          evaluation = {
            score: 3,
            verdict: "ok",
            feedback: `自动评估暂时失败（${formatModelError(error)}），本题不计入弱项，继续下一题。`,
            gaps: []
          };
        }

        const step = decideNextStep(session, evaluation);
        applyAnswer(session, body.answer, evaluation, step);

        send({
          type: "evaluation",
          questionIndex,
          evaluation: {
            score: evaluation.score,
            verdict: evaluation.verdict,
            feedback: evaluation.feedback,
            gaps: evaluation.gaps
          }
        });

        if (step.action === "follow_up") {
          send({
            type: "interview_question",
            question: step.followUpQuestion,
            kind: "follow_up",
            index: questionIndex,
            total: session.questions.length,
            evidence: question.evidence
          });
        } else if (step.action === "next") {
          const next = session.questions[session.currentIndex];
          send({
            type: "interview_question",
            question: next.question,
            kind: "main",
            index: session.currentIndex,
            total: session.questions.length,
            evidence: next.evidence
          });
        } else {
          send({ type: "summary", summary: await safeSummarize(session) });
        }
        send({ type: "done" });
      } catch (error) {
        send({ type: "error", message: error instanceof Error ? error.message : "面试服务异常。" });
      } finally {
        alive = false;
        clearInterval(heartbeat);
        session.busy = false;
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    }
  });
}

async function safeSummarize(session: InterviewSession): Promise<InterviewSummary> {
  // 评估和候选人回答都按时间顺序追加，按位置配对；同一主问题的追问轮共享 questionIndex，不能按 index 查找
  const candidateAnswers = session.transcript.filter((turn) => turn.role === "candidate");
  const rounds = session.evaluations.map((evaluation, index) => ({
    question: session.questions[evaluation.questionIndex]?.question ?? "",
    answer: candidateAnswers[index]?.content ?? "",
    score: evaluation.score,
    verdict: evaluation.verdict,
    gaps: evaluation.gaps
  }));

  try {
    return await summarizeInterview({
      repoFullName: session.repoFullName,
      understanding: session.understanding,
      rounds
    });
  } catch {
    const average =
      rounds.length > 0 ? Math.round((rounds.reduce((sum, round) => sum + round.score, 0) / rounds.length) * 10) / 10 : 0;
    return {
      overall: `本场共回答 ${rounds.length} 题，平均得分 ${average}/5。自动总结暂时失败，以下为按评估记录生成的要点。`,
      strengths: rounds.filter((round) => round.score >= 4).map((round) => `「${round.question}」回答扎实`),
      weaknesses: rounds.filter((round) => round.score <= 2).flatMap((round) => round.gaps),
      reviewPlan: rounds
        .filter((round) => round.score <= 3)
        .map((round) => `复盘「${round.question}」，补齐：${round.gaps.join("、") || "回答深度"}`),
      scores: rounds.map((round) => ({ question: round.question, score: round.score }))
    };
  }
}
