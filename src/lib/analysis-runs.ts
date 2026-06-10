import { randomUUID } from "node:crypto";
import { createEventChannel, type EventChannel } from "./events";
import { runAnalysisPipeline } from "./orchestrator";
import type { AnalyzeMode, SseEvent } from "./types";

const RUN_TTL_MS = 3 * 60 * 60 * 1000;
const RUN_CAP = 100;

type AnalysisRun = {
  id: string;
  repositoryUrl: string;
  mode: AnalyzeMode;
  createdAt: number;
  updatedAt: number;
  status: "running" | "done" | "error";
  events: SseEvent[];
  subscribers: Set<EventChannel>;
};

const globalStore = globalThis as unknown as { __analysisRuns?: Map<string, AnalysisRun> };
const runs: Map<string, AnalysisRun> = globalStore.__analysisRuns ?? new Map();
globalStore.__analysisRuns = runs;

export function createAnalysisRun(repositoryUrl: string, mode: AnalyzeMode): AnalysisRun {
  evictStaleRuns();
  const run: AnalysisRun = {
    id: randomUUID(),
    repositoryUrl,
    mode,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: "running",
    events: [],
    subscribers: new Set()
  };
  runs.set(run.id, run);
  record(run, { type: "run", runId: run.id });

  void consumePipeline(run).catch((error) => {
    record(run, { type: "error", message: error instanceof Error ? error.message : "分析失败。" });
    closeRun(run, "error");
  });

  return run;
}

export function getAnalysisRun(id: string): AnalysisRun | undefined {
  evictStaleRuns();
  return runs.get(id);
}

export async function* subscribeAnalysisRun(run: AnalysisRun): AsyncGenerator<SseEvent> {
  const channel = createEventChannel();
  for (const event of run.events) channel.emit(event);
  if (run.status === "running") {
    run.subscribers.add(channel);
  } else {
    channel.close();
  }

  try {
    yield* channel.iterate();
  } finally {
    run.subscribers.delete(channel);
  }
}

async function consumePipeline(run: AnalysisRun): Promise<void> {
  for await (const event of runAnalysisPipeline(run.repositoryUrl, run.mode)) {
    record(run, event);
    if (event.type === "done") {
      closeRun(run, "done");
      return;
    }
    if (event.type === "error") {
      closeRun(run, "error");
      return;
    }
  }
  if (run.status === "running") {
    record(run, { type: "done" });
    closeRun(run, "done");
  }
}

function record(run: AnalysisRun, event: SseEvent): void {
  run.updatedAt = Date.now();
  run.events.push(event);
  for (const subscriber of run.subscribers) subscriber.emit(event);
}

function closeRun(run: AnalysisRun, status: "done" | "error"): void {
  run.status = status;
  run.updatedAt = Date.now();
  for (const subscriber of run.subscribers) subscriber.close();
  run.subscribers.clear();
}

function evictStaleRuns(): void {
  const now = Date.now();
  for (const [id, run] of runs) {
    if (now - run.updatedAt > RUN_TTL_MS) {
      for (const subscriber of run.subscribers) subscriber.close();
      runs.delete(id);
    }
  }
  if (runs.size >= RUN_CAP) {
    const oldest = [...runs.values()].sort((a, b) => a.updatedAt - b.updatedAt)[0];
    if (oldest) {
      for (const subscriber of oldest.subscribers) subscriber.close();
      runs.delete(oldest.id);
    }
  }
}
