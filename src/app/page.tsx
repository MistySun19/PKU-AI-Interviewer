"use client";

import { useRef, useState } from "react";
import type { AnalyzeResponse, ExamPoint, InterviewQuestion, SseEvent } from "@/lib/types";

type Status = "idle" | "loading" | "done" | "error";

type FeedItem = {
  id: number;
  kind: "stage" | "file" | "warning" | "finding";
  text: string;
};

export default function Home() {
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [stageLabel, setStageLabel] = useState("");
  const [reportDraft, setReportDraft] = useState("");
  const [examPoints, setExamPoints] = useState<ExamPoint[]>([]);
  const [questions, setQuestions] = useState<InterviewQuestion[]>([]);
  const feedSeq = useRef(0);

  function pushFeed(kind: FeedItem["kind"], text: string) {
    feedSeq.current += 1;
    const item = { id: feedSeq.current, kind, text };
    setFeed((prev) => [item, ...prev].slice(0, 120));
  }

  function handleEvent(event: SseEvent) {
    switch (event.type) {
      case "stage":
        setStageLabel(event.detail ?? event.stage);
        pushFeed("stage", event.detail ?? event.stage);
        break;
      case "file_read":
        pushFeed("file", `读取 ${event.path}${event.dimension ? `（${event.dimension} 补读）` : ""}`);
        break;
      case "plan":
        pushFeed(
          "stage",
          `研究计划（${event.plan.analysisMode}）：${event.plan.dimensions
            .map((dimension) => `${dimension.key}×${dimension.files.length}文件`)
            .join("，")}`
        );
        break;
      case "finding":
        pushFeed("finding", `[${event.dimension}] ${event.claim}（${event.evidence.join("、") || "无证据"}）`);
        break;
      case "report_delta":
        setReportDraft((prev) => prev + event.delta);
        break;
      case "exam_point":
        setExamPoints((prev) => [...prev, event.point]);
        break;
      case "question":
        setQuestions((prev) => [...prev, event.question]);
        break;
      case "warning":
        pushFeed("warning", event.message);
        break;
      case "result":
        setResult(event.result);
        break;
      case "error":
        setError(event.message);
        setStatus("error");
        break;
      case "done":
        setStatus("done");
        break;
      default:
        break;
    }
  }

  async function submit() {
    if (!repositoryUrl.trim() || status === "loading") return;
    setStatus("loading");
    setError("");
    setResult(null);
    setCopied(false);
    setFeed([]);
    setReportDraft("");
    setExamPoints([]);
    setQuestions([]);
    setStageLabel("连接分析服务");

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repositoryUrl: repositoryUrl.trim(), mode: "survey" })
      });

      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error ?? `分析失败 (${response.status})。`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let frameEnd = buffer.indexOf("\n\n");
        while (frameEnd !== -1) {
          const frame = buffer.slice(0, frameEnd);
          buffer = buffer.slice(frameEnd + 2);
          const dataLine = frame.split("\n").find((line) => line.startsWith("data: "));
          if (dataLine) handleEvent(JSON.parse(dataLine.slice(6)) as SseEvent);
          frameEnd = buffer.indexOf("\n\n");
        }
      }
      setStatus((prev) => (prev === "loading" ? "done" : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : "分析失败。");
      setStatus("error");
    }
  }

  async function copyReport() {
    if (!result) return;
    await navigator.clipboard.writeText(result.markdownReport);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <main className="shell">
      <section className="workspace">
        <div className="intro">
          <p className="eyebrow">v1.0.0-alpha.1</p>
          <h1>GitHub Repo 项目考核面试生成器</h1>
          <p className="lede">
            读取公开仓库，优先按论文/AI 项目制代码库理解方法、训练、评测、配置和复现证据，再生成有证据来源的算法岗项目追问计划。
          </p>
        </div>

        <div className="inputRow" role="search">
          <input
            aria-label="GitHub 仓库链接"
            value={repositoryUrl}
            onChange={(event) => setRepositoryUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) void submit();
            }}
            placeholder="https://github.com/owner/repo"
          />
          <button disabled={status === "loading" || !repositoryUrl.trim()} onClick={() => void submit()}>
            {status === "loading" ? "分析中" : "生成报告"}
          </button>
        </div>

        {status === "loading" && feed.length === 0 && (
          <div className="progress" aria-live="polite">
            <span />
            正在连接仓库分析服务。
          </div>
        )}

        {feed.length > 0 && status !== "idle" && (
          <div className="feedPanel" aria-live="polite">
            <div className="feedHead">
              <span className={status === "loading" ? "dot" : "dot idle"} />
              {status === "loading" ? stageLabel : "分析完成"}
            </div>
            <ul className="feedList">
              {feed.map((item) => (
                <li key={item.id} className={`feedItem ${item.kind}`}>
                  {item.text}
                </li>
              ))}
            </ul>
          </div>
        )}

        {status === "error" && <div className="error">{error}</div>}

        {!result && reportDraft && (
          <section className="report streamingReport" aria-label="理解报告生成中" aria-live="polite">
            <div className="reportHead">
              <div>
                <p className="eyebrow">Streaming</p>
                <h2>仓库理解报告（生成中）</h2>
              </div>
            </div>
            <pre>{reportDraft}</pre>
          </section>
        )}

        {examPoints.length > 0 && (
          <section className="examPoints" aria-label="项目考核点">
            <h2>
              项目考核点 <span className="count">{examPoints.length}</span>
            </h2>
            <ul>
              {examPoints.map((point, index) => (
                <li key={index}>
                  <span className={`chip risk-${point.riskLevel}`}>{point.riskLevel}</span>
                  <div>
                    <strong>{point.title}</strong>
                    {point.whyAsk && <p>{point.whyAsk}</p>}
                    <p className="cardEvidence">证据：{point.evidence.join("、") || "—"}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {questions.length > 0 && (
          <section className="questionsPanel" aria-label="分层面试题">
            <h2>
              分层面试题 <span className="count">{questions.length}</span>
            </h2>
            <div className="questionGrid">
              {questions.map((question, index) => (
                <article className="questionCard" key={index}>
                  <header>
                    <span className={`chip diff-${question.difficulty}`}>{question.difficulty}</span>
                    {question.source === "kaomian" && <span className="chip kaomian">高频题改写</span>}
                    <span className="qIndex">Q{String(index + 1).padStart(2, "0")}</span>
                  </header>
                  <p className="qText">{question.question}</p>
                  {question.whyAsk && <p className="qWhy">{question.whyAsk}</p>}
                  <p className="cardEvidence">证据：{question.evidence.join("、") || "—"}</p>
                  <details>
                    <summary>期望要点 / 红旗 / 追问</summary>
                    {question.expectedAnswer.length > 0 && (
                      <div className="qBlock">
                        <h3>期望要点</h3>
                        <ul>
                          {question.expectedAnswer.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {question.redFlags.length > 0 && (
                      <div className="qBlock">
                        <h3>红旗回答</h3>
                        <ul>
                          {question.redFlags.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {question.followUps.length > 0 && (
                      <div className="qBlock">
                        <h3>后续追问</h3>
                        <ul>
                          {question.followUps.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </details>
                </article>
              ))}
            </div>
          </section>
        )}

        {result && (
          <section className="resultGrid">
            <aside className="sidebar" aria-label="仓库分析摘要">
              <div className="metric">
                <span>Mode</span>
                <strong>{result.analysisMode}</strong>
              </div>
              <div className="metric">
                <span>Repository</span>
                <strong>{result.repo.fullName}</strong>
              </div>
              <div className="metric">
                <span>Language</span>
                <strong>{result.repo.language ?? "Unknown"}</strong>
              </div>
              <div className="metric">
                <span>Evidence</span>
                <strong>{result.evidenceFiles.length} files</strong>
              </div>
              <div className="metric">
                <span>Questions</span>
                <strong>{result.questions.length}</strong>
              </div>

              <div className="sideBlock">
                <h2>证据文件</h2>
                <ul>
                  {result.evidenceFiles.slice(0, 12).map((file) => (
                    <li key={file.path}>
                      {file.path}
                      <span> {file.category}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {result.warnings.length > 0 && (
                <div className="sideBlock warning">
                  <h2>Warnings</h2>
                  <ul>
                    {result.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </div>
              )}
            </aside>

            <article className="report" aria-label="项目考核面试计划">
              <div className="reportHead">
                <div>
                  <p className="eyebrow">Markdown Report</p>
                  <h2>项目考核面试计划</h2>
                </div>
                <button className="copy" onClick={() => void copyReport()}>
                  {copied ? "已复制" : "复制"}
                </button>
              </div>
              <pre>{result.markdownReport}</pre>
            </article>
          </section>
        )}
      </section>
    </main>
  );
}
