import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SseEvent } from "./types";

vi.mock("./orchestrator", () => ({
  runAnalysisPipeline: vi.fn()
}));

import { runAnalysisPipeline } from "./orchestrator";
import { createAnalysisRun, subscribeAnalysisRun } from "./analysis-runs";

async function collect(run: ReturnType<typeof createAnalysisRun>): Promise<SseEvent[]> {
  const events: SseEvent[] = [];
  for await (const event of subscribeAnalysisRun(run)) events.push(event);
  return events;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("analysis runs", () => {
  it("records and replays run events for resumable subscriptions", async () => {
    vi.mocked(runAnalysisPipeline).mockImplementation(async function* () {
      yield { type: "stage", stage: "scout", detail: "抓仓库" };
      yield { type: "done" };
    });

    const run = createAnalysisRun("https://github.com/o/r", "survey");
    const events = await collect(run);

    expect(events.map((event) => event.type)).toEqual(["run", "stage", "done"]);
    expect(events[0]).toEqual({ type: "run", runId: run.id });
  });
});
