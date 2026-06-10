"use client";

import { useRef, useState } from "react";
import type { AnalyzeMode, AnalyzeResponse, ExamPoint, InterviewQuestion, InterviewSummary, SseEvent } from "@/lib/types";

type Status = "idle" | "loading" | "done" | "error";

type FeedItem = {
  id: number;
  kind: "stage" | "file" | "warning" | "finding";
  text: string;
};

type ChatMessage =
  | { id: number; role: "interviewer"; kind: "main" | "follow_up"; text: string; meta: string }
  | { id: number; role: "candidate"; text: string }
  | { id: number; role: "evaluation"; score: number; verdict: string; feedback: string; gaps: string[] }
  | { id: number; role: "system"; text: string };

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

async function consumeSse(body: ReadableStream<Uint8Array>, onEvent: (event: SseEvent) => void): Promise<void> {
  const reader = body.getReader();
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
      if (dataLine) onEvent(JSON.parse(dataLine.slice(6)) as SseEvent);
      frameEnd = buffer.indexOf("\n\n");
    }
  }
}

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
  const [mode, setMode] = useState<AnalyzeMode>("survey");
  const [sessionId, setSessionId] = useState("");
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [interviewTotal, setInterviewTotal] = useState(0);
  const [summary, setSummary] = useState<InterviewSummary | null>(null);
  const [answerDraft, setAnswerDraft] = useState("");
  const [sending, setSending] = useState(false);
  const feedSeq = useRef(0);

  function pushFeed(kind: FeedItem["kind"], text: string) {
    feedSeq.current += 1;
    const item = { id: feedSeq.current, kind, text };
    setFeed((prev) => [item, ...prev].slice(0, 120));
  }

  function pushChat(message: DistributiveOmit<ChatMessage, "id">) {
    feedSeq.current += 1;
    setChat((prev) => [...prev, { ...message, id: feedSeq.current } as ChatMessage]);
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
      case "session":
        setSessionId(event.sessionId);
        setInterviewTotal(event.total);
        pushChat({
          role: "interviewer",
          kind: "main",
          text: event.question.question,
          meta: `Q1/${event.total}`
        });
        break;
      case "evaluation":
        pushChat({
          role: "evaluation",
          score: event.evaluation.score,
          verdict: event.evaluation.verdict,
          feedback: event.evaluation.feedback,
          gaps: event.evaluation.gaps
        });
        break;
      case "interview_question":
        pushChat({
          role: "interviewer",
          kind: event.kind,
          text: event.question,
          meta: event.kind === "follow_up" ? `Q${event.index + 1} 追问` : `Q${event.index + 1}/${event.total}`
        });
        break;
      case "summary":
        setSummary(event.summary);
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
    setSessionId("");
    setChat([]);
    setInterviewTotal(0);
    setSummary(null);
    setAnswerDraft("");
    setStageLabel("连接分析服务");

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repositoryUrl: repositoryUrl.trim(), mode })
      });

      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error ?? `分析失败 (${response.status})。`);
      }

      await consumeSse(response.body, handleEvent);
      setStatus((prev) => (prev === "loading" ? "done" : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : "分析失败。");
      setStatus("error");
    }
  }

  async function sendAnswer(end = false) {
    if (!sessionId || sending || summary) return;
    const answer = answerDraft.trim();
    if (!end && !answer) return;
    setSending(true);
    if (!end) {
      pushChat({ role: "candidate", text: answer });
      setAnswerDraft("");
    }

    try {
      const response = await fetch("/api/interview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, answer, end })
      });
      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error ?? `面试服务请求失败 (${response.status})。`);
      }
      await consumeSse(response.body, handleEvent);
    } catch (err) {
      pushChat({ role: "system", text: err instanceof Error ? err.message : "面试服务异常，请重试。" });
    } finally {
      setSending(false);
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
          <p className="eyebrow">v1.0.0-beta.1</p>
          <h1>GitHub Repo 项目考核面试生成器</h1>
          <p className="lede">
            Deep Research Agent 读懂你的仓库（方法、训练、评测、配置、复现证据），结合 kaomian
            高频题库，流式生成有证据来源的项目拷打——或者直接开始一场一问一答的模拟面试。
          </p>
        </div>

        <div className="modeRow" role="tablist" aria-label="生成模式">
          <button
            role="tab"
            aria-selected={mode === "survey"}
            className={mode === "survey" ? "modeBtn active" : "modeBtn"}
            disabled={status === "loading"}
            onClick={() => setMode("survey")}
          >
            Survey · 全量报告 + 出题
          </button>
          <button
            role="tab"
            aria-selected={mode === "interview"}
            className={mode === "interview" ? "modeBtn active" : "modeBtn"}
            disabled={status === "loading"}
            onClick={() => setMode("interview")}
          >
            Interactive · 模拟面试
          </button>
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
            {status === "loading" ? "分析中" : mode === "survey" ? "生成报告" : "开始面试"}
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

        {!result && reportDraft && !sessionId && (
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

        {(sessionId || summary) && (
          <section className="chatPanel" aria-label="模拟面试">
            <div className="chatHead">
              <div>
                <p className="eyebrow">Mock Interview</p>
                <h2>
                  模拟面试
                  {interviewTotal > 0 && <span className="count"> {interviewTotal} 道主问题链</span>}
                </h2>
              </div>
              {!summary && (
                <button className="endBtn" disabled={sending} onClick={() => void sendAnswer(true)}>
                  提前结束出总结
                </button>
              )}
            </div>

            <div className="chatLog">
              {chat.map((message) => {
                if (message.role === "evaluation") {
                  return (
                    <div className={`evalCard verdict-${message.verdict}`} key={message.id}>
                      <div className="evalHead">
                        <span className="evalScore">{message.score}/5</span>
                        <span className="evalVerdict">{message.verdict}</span>
                      </div>
                      <p>{message.feedback}</p>
                      {message.gaps.length > 0 && (
                        <ul>
                          {message.gaps.map((gap) => (
                            <li key={gap}>{gap}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                }
                if (message.role === "system") {
                  return (
                    <div className="chatSystem" key={message.id}>
                      {message.text}
                    </div>
                  );
                }
                return (
                  <div className={`bubble ${message.role}`} key={message.id}>
                    {message.role === "interviewer" && <span className="bubbleMeta">{message.meta}</span>}
                    <p>{message.text}</p>
                  </div>
                );
              })}
              {sending && <div className="chatSystem">面试官思考中…</div>}
            </div>

            {!summary && sessionId && (
              <div className="chatInput">
                <textarea
                  aria-label="你的回答"
                  value={answerDraft}
                  disabled={sending}
                  rows={4}
                  placeholder="输入你的回答…（Ctrl/⌘ + Enter 发送）"
                  onChange={(event) => setAnswerDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void sendAnswer();
                  }}
                />
                <button disabled={sending || !answerDraft.trim()} onClick={() => void sendAnswer()}>
                  发送回答
                </button>
              </div>
            )}

            {summary && (
              <div className="summaryCard">
                <h2>面试总结</h2>
                <p className="summaryOverall">{summary.overall}</p>
                {summary.scores.length > 0 && (
                  <div className="summaryBlock">
                    <h3>得分</h3>
                    <ul>
                      {summary.scores.map((item) => (
                        <li key={item.question}>
                          <span className="scoreChip">{item.score}/5</span> {item.question}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {summary.strengths.length > 0 && (
                  <div className="summaryBlock">
                    <h3>亮点</h3>
                    <ul>
                      {summary.strengths.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {summary.weaknesses.length > 0 && (
                  <div className="summaryBlock">
                    <h3>薄弱点</h3>
                    <ul>
                      {summary.weaknesses.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {summary.reviewPlan.length > 0 && (
                  <div className="summaryBlock">
                    <h3>面试前补坑计划</h3>
                    <ul>
                      {summary.reviewPlan.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {mode === "survey" && examPoints.length > 0 && (
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

        {mode === "survey" && questions.length > 0 && (
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

        {mode === "survey" && result && (
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
