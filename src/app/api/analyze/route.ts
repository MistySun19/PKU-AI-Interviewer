import { z } from "zod";
import { parseGitHubUrl } from "@/lib/github";
import { runAnalysisPipeline } from "@/lib/orchestrator";
import type { SseEvent } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 1200;

const requestSchema = z.object({
  repositoryUrl: z.string().min(1),
  mode: z.enum(["survey", "interview"]).default("survey")
});

export async function POST(request: Request) {
  let body: z.infer<typeof requestSchema>;
  try {
    body = requestSchema.parse(await request.json());
  } catch {
    return Response.json({ error: "请求体需要包含 repositoryUrl。" }, { status: 400 });
  }
  try {
    parseGitHubUrl(body.repositoryUrl);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "GitHub 仓库链接无法解析。" },
      { status: 400 }
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: SseEvent) => {
        controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
      };
      // 周期心跳：synthesize 等阶段是单次长 LLM 调用、事件间会静默数十秒，靠心跳避免公网链路 idle 超时掐连接
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
        for await (const event of runAnalysisPipeline(body.repositoryUrl, body.mode)) {
          send(event);
        }
      } catch (error) {
        send({ type: "error", message: error instanceof Error ? error.message : "分析失败。" });
      } finally {
        alive = false;
        clearInterval(heartbeat);
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
