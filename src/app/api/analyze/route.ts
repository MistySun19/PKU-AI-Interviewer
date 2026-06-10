import { z } from "zod";
import { createAnalysisRun, getAnalysisRun, subscribeAnalysisRun } from "@/lib/analysis-runs";
import { parseGitHubUrl } from "@/lib/github";
import demoSnapshot from "@/lib/fixtures/pku-ai-interviewer-demo.json";
import type { AnalyzeResponse, SseEvent } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 1200;

const requestSchema = z.object({
  repositoryUrl: z.string().optional(),
  repoUrl: z.string().optional(),
  runId: z.string().optional(),
  mode: z.enum(["survey", "interview", "practice"]).default("survey")
});

const DEMO_READ_PATHS = [
  "README.md",
  "docs/research/deep-research-agent-design.md",
  "src/lib/kaomian.ts",
  "scripts/build-kaomian.mjs",
  "src/lib/github.test.ts"
];

const DEMO_FINDINGS = [
  {
    claim: "Deep Research 管道是否真的先读仓库再生成风险点",
    evidence: ["docs/research/deep-research-agent-design.md", "README.md"]
  },
  {
    claim: "kaomian 面经素材是否被 repo 证据约束，而不是直接拼题",
    evidence: ["src/lib/kaomian.ts", "data/kaomian/kaomian.json"]
  },
  {
    claim: "Evidence Check 是否能阻止证据不足的问题进入最终结果",
    evidence: ["docs/research/deep-research-agent-design.md", "src/lib/github.test.ts"]
  },
  {
    claim: "风险点右侧代码证据能否支撑左侧追问",
    evidence: ["README.md", "scripts/build-kaomian.mjs"]
  },
  {
    claim: "持续追问是否只围绕单个风险点，而不是恢复旧 Test 流程",
    evidence: ["README.md", "docs/project-record.md"]
  }
];

export async function POST(request: Request) {
  let body: z.infer<typeof requestSchema>;
  try {
    body = requestSchema.parse(await request.json());
  } catch {
    return Response.json({ error: "请求体需要包含 repositoryUrl 或 runId。" }, { status: 400 });
  }

  let run = body.runId ? getAnalysisRun(body.runId) : undefined;
  if (body.runId && !run) {
    return Response.json({ error: "分析任务不存在或已过期，请重新开始。" }, { status: 404 });
  }
  if (!run) {
    const repositoryUrl = body.repositoryUrl ?? body.repoUrl;
    if (!repositoryUrl) {
      return Response.json({ error: "请求体需要包含 repositoryUrl 或 runId。" }, { status: 400 });
    }
    let parsedRepo;
    try {
      parsedRepo = parseGitHubUrl(repositoryUrl);
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "GitHub 仓库链接无法解析。" },
        { status: 400 }
      );
    }
    if (isDemoSnapshotEnabled() && isDemoSnapshotRepo(parsedRepo.owner, parsedRepo.repo)) {
      return createDemoSnapshotStream();
    }
    run = createAnalysisRun(repositoryUrl, body.mode);
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
        for await (const event of subscribeAnalysisRun(run)) {
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
      "X-Accel-Buffering": "no",
      "X-Analysis-Run-Id": run.id
    }
  });
}

function isDemoSnapshotRepo(owner: string, repo: string): boolean {
  return owner.toLowerCase() === "mistysun19" && repo.toLowerCase() === "pku-ai-interviewer";
}

function isDemoSnapshotEnabled(): boolean {
  return process.env.TRACEBACK_DEMO_SNAPSHOT === "enabled";
}

function createDemoSnapshotStream(): Response {
  const encoder = new TextEncoder();
  const snapshot = demoSnapshot as AnalyzeResponse;
  const delayScale = getDemoDelayScale();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: SseEvent) => {
        controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
      };
      const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.round(ms * delayScale)));

      send({ type: "run", runId: "traceback-demo-snapshot" });
      send({ type: "stage", stage: "scout", detail: "Demo snapshot：读取已固定的仓库证据" });
      await wait(4000);
      for (const path of DEMO_READ_PATHS) {
        send({ type: "file_read", path });
        await wait(2400);
      }
      send({ type: "stage", stage: "plan", detail: "Demo snapshot：复用已生成的研究计划" });
      await wait(8000);
      send({ type: "stage", stage: "research", detail: "Demo snapshot：复用已完成的 Deep Research 结果" });
      await wait(12000);
      for (const finding of DEMO_FINDINGS) {
        send({
          type: "finding",
          dimension: "demo",
          claim: finding.claim,
          evidence: finding.evidence,
          confidence: "high"
        });
        await wait(2800);
      }
      send({ type: "stage", stage: "synthesize", detail: "Demo snapshot：合成 Traceback 风险视图" });
      await wait(4000);
      send({
        type: "stage",
        stage: "questions",
        detail: `Demo snapshot：生成 ${snapshot.risks.length} 个会被问穿的问题`
      });
      await wait(3000);
      send({
        type: "stage",
        stage: "evidence_check",
        detail: "Demo snapshot：Evidence Check 已通过"
      });
      await wait(2500);
      send({ type: "result", result: snapshot });
      send({ type: "done" });
      controller.close();
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "X-Analysis-Run-Id": "traceback-demo-snapshot"
    }
  });
}

function getDemoDelayScale(): number {
  if (process.env.NODE_ENV === "test") return 0;
  const raw = process.env.TRACEBACK_DEMO_DELAY_SCALE;
  if (!raw) return 1;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 1;
}
