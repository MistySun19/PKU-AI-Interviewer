import { NextResponse } from "next/server";
import { z } from "zod";
import { fetchRepoContext } from "@/lib/github";
import { analyzeRepoWithLlm } from "@/lib/llm";

export const runtime = "nodejs";
export const maxDuration = 120;

const requestSchema = z.object({
  repositoryUrl: z.string().min(1)
});

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json());
    const context = await fetchRepoContext(body.repositoryUrl);
    const result = await analyzeRepoWithLlm(context);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "分析失败。";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
