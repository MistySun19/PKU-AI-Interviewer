import { createEventChannel } from "./events";
import { fetchRepoContext } from "./github";
import { analyzeRepoWithLlm } from "./llm";
import type { AnalyzeMode, SseEvent } from "./types";

export function runAnalysisPipeline(repositoryUrl: string, _mode: AnalyzeMode): AsyncGenerator<SseEvent> {
  const channel = createEventChannel();

  void (async () => {
    try {
      channel.emit({ type: "stage", stage: "scout", detail: "读取仓库元数据、文件树并筛选证据文件" });
      const context = await fetchRepoContext(repositoryUrl, {
        onFileFetched: (path) => channel.emit({ type: "file_read", path })
      });

      channel.emit({ type: "stage", stage: "research", detail: "理解仓库并生成考核点与面试题" });
      const result = await analyzeRepoWithLlm(context);

      channel.emit({ type: "result", result });
      channel.emit({ type: "done" });
      channel.close();
    } catch (error) {
      channel.emit({ type: "error", message: error instanceof Error ? error.message : "分析失败。" });
      channel.close();
    }
  })();

  return channel.iterate();
}
