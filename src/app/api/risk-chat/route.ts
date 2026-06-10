import { z } from "zod";
import { formatModelError, generateRiskChatReply, getApiKey } from "@/lib/llm";
import type { RepoInterviewRisk, RiskChatMessage, RiskChatResponse } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const chatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string()
});

const requestSchema = z.object({
  riskId: z.string(),
  risk: z.custom<RepoInterviewRisk>((value) => Boolean(value && typeof value === "object")),
  answer: z.string().min(1),
  history: z.array(chatMessageSchema).default([]),
  evidenceRefs: z.array(z.unknown()).default([]),
  repoSummary: z.string().default("")
});

export async function POST(request: Request) {
  let body: z.infer<typeof requestSchema>;
  try {
    body = requestSchema.parse(await request.json());
  } catch {
    return Response.json({ error: "请求体需要包含 risk、answer 和 history。" }, { status: 400 });
  }

  if (!getApiKey()) {
    return Response.json(buildFallbackReply(body.risk, body.answer, body.history));
  }

  try {
    const result = await generateRiskChatReply({
      risk: body.risk,
      answer: body.answer,
      history: body.history,
      evidenceRefs: body.risk.evidenceRefs,
      repoSummary: body.repoSummary
    });
    return Response.json(result);
  } catch (error) {
    return Response.json(
      {
        ...buildFallbackReply(body.risk, body.answer, body.history),
        warning: `模型追问失败，已使用降级追问：${formatModelError(error)}`
      },
      { status: 200 }
    );
  }
}

function buildFallbackReply(
  risk: RepoInterviewRisk,
  answer: string,
  history: RiskChatMessage[]
): RiskChatResponse {
  const seed = risk.followUpSeeds[history.length % Math.max(1, risk.followUpSeeds.length)];
  const defaultFollowUp =
    seed || "如果面试官继续追问这个设计的失败边界，你会用哪个实现细节或实验结果来证明自己真的做过？";
  const evidence = risk.evidenceRefs
    .slice(0, 2)
    .map((ref) => `${ref.filePath}:${ref.startLine}-${ref.endLine}`)
    .join("、");

  return {
    reply: answer.length < 24
      ? `这版回答还太短，容易被继续追问。先把回答落到 ${evidence || "当前 reference"}，再解释设计理由和失败场景。`
      : `回答已经开始覆盖这个风险点，但还需要更明确地绑定 repo 证据。优先补上 ${evidence || "当前 reference"} 里能支撑 claim 的实现细节，并主动避开红旗回答。`,
    followUpQuestion: defaultFollowUp,
    referenceAnswer: risk.referenceAnswer
  };
}
