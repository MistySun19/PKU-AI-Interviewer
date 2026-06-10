"use client";

import { useEffect, useRef, useState } from "react";
import type {
  AnalyzeMode,
  AnalyzeResponse,
  ExamPoint,
  InteractiveMode,
  InterviewQuestion,
  InterviewRun,
  InterviewSession,
  InterviewSummary,
  PipelineStage,
  QuestionSet,
  ResearchPlanSummary,
  SseEvent
} from "@/lib/types";

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
type RiskLevel = ExamPoint["riskLevel"];
type Difficulty = InterviewQuestion["difficulty"];

const PERSISTENCE_KEY = "pku-ai-interviewer:last-run:v1";

type PersistedRun = {
  version: 1;
  savedAt: number;
  repositoryUrl: string;
  mode: AnalyzeMode;
  status: Status;
  runId: string;
  result: AnalyzeResponse | null;
  error: string;
  feed: FeedItem[];
  stageLabel: string;
  currentStage: PipelineStage | null;
  planSummary: ResearchPlanSummary | null;
  filesRead: number;
  findingsSeen: number;
  latestReadPath: string;
  reportDraft: string;
  examPoints: ExamPoint[];
  questions: InterviewQuestion[];
  sessionId: string;
  chat: ChatMessage[];
  interviewTotal: number;
  summary: InterviewSummary | null;
  interviewSession: InterviewSession | null;
  activeQuestionSet: QuestionSet | null;
  questionSets: QuestionSet[];
  interviewRuns: InterviewRun[];
  answerDraft: string;
};

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
  const [analysisRunId, setAnalysisRunId] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [stageLabel, setStageLabel] = useState("");
  const [currentStage, setCurrentStage] = useState<PipelineStage | null>(null);
  const [planSummary, setPlanSummary] = useState<ResearchPlanSummary | null>(null);
  const [filesRead, setFilesRead] = useState(0);
  const [findingsSeen, setFindingsSeen] = useState(0);
  const [latestReadPath, setLatestReadPath] = useState("");
  const [reportDraft, setReportDraft] = useState("");
  const [examPoints, setExamPoints] = useState<ExamPoint[]>([]);
  const [questions, setQuestions] = useState<InterviewQuestion[]>([]);
  const [mode, setMode] = useState<AnalyzeMode>("survey");
  const [sessionId, setSessionId] = useState("");
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [interviewTotal, setInterviewTotal] = useState(0);
  const [summary, setSummary] = useState<InterviewSummary | null>(null);
  const [interviewSession, setInterviewSession] = useState<InterviewSession | null>(null);
  const [activeQuestionSet, setActiveQuestionSet] = useState<QuestionSet | null>(null);
  const [questionSets, setQuestionSets] = useState<QuestionSet[]>([]);
  const [interviewRuns, setInterviewRuns] = useState<InterviewRun[]>([]);
  const [answerDraft, setAnswerDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [startingMode, setStartingMode] = useState<InteractiveMode | null>(null);
  const [practiceHelpLoading, setPracticeHelpLoading] = useState<"hint" | "answer" | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [restoredNotice, setRestoredNotice] = useState("");
  const feedSeq = useRef(0);
  const hydrated = useRef(false);
  const reconnectingRun = useRef(false);
  const interactiveMode = mode === "interview" || mode === "practice";
  const practiceMode = mode === "practice";
  const interviewReady = interactiveMode && (sessionId || summary);

  useEffect(() => {
    const saved = readPersistedRun();
    hydrated.current = true;
    if (!saved) return;

    setRepositoryUrl(saved.repositoryUrl);
    setMode(saved.mode);
    setAnalysisRunId(saved.runId);
    setStatus(saved.status === "loading" && saved.runId ? "loading" : saved.status === "loading" ? "error" : saved.status);
    setResult(saved.result);
    setError(saved.status === "loading" && !saved.runId ? "上次分析被刷新中断，已恢复刷新前已经生成的内容。" : saved.error);
    setFeed(saved.feed);
    setStageLabel(saved.stageLabel);
    setCurrentStage(saved.currentStage);
    setPlanSummary(saved.planSummary);
    setFilesRead(saved.filesRead);
    setFindingsSeen(saved.findingsSeen);
    setLatestReadPath(saved.latestReadPath);
    setReportDraft(saved.reportDraft);
    setExamPoints(saved.examPoints);
    setQuestions(saved.questions);
    setSessionId(saved.sessionId);
    setChat(saved.chat);
    setInterviewTotal(saved.interviewTotal);
    setSummary(saved.summary);
    setInterviewSession(saved.interviewSession);
    setActiveQuestionSet(saved.activeQuestionSet);
    setQuestionSets(saved.questionSets);
    setInterviewRuns(saved.interviewRuns);
    setAnswerDraft(saved.answerDraft);
    setLastSavedAt(saved.savedAt);
    setRestoredNotice(
      saved.status === "loading" && saved.runId
        ? "正在重新连接上次分析任务。"
        : saved.status === "loading"
          ? "已恢复刷新前的中间结果，原分析流已中断。"
          : "已恢复上次分析记录。"
    );
    feedSeq.current = Math.max(0, ...saved.feed.map((item) => item.id), ...saved.chat.map((item) => item.id));
    if (saved.status === "loading" && saved.runId) void reconnectAnalysisRun(saved.runId);
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    if (
      !hasPersistableContent({
        currentStage,
        result,
        reportDraft,
        feed,
        examPoints,
        questions,
        sessionId,
        chat,
        summary,
        questionSets,
        interviewRuns
      })
    ) {
      return;
    }

    const savedAt = Date.now();
    const snapshot: PersistedRun = {
      version: 1,
      savedAt,
      repositoryUrl,
      mode,
      status,
      runId: analysisRunId,
      result,
      error,
      feed,
      stageLabel,
      currentStage,
      planSummary,
      filesRead,
      findingsSeen,
      latestReadPath,
      reportDraft,
      examPoints,
      questions,
      sessionId,
      chat,
      interviewTotal,
      summary,
      interviewSession,
      activeQuestionSet,
      questionSets,
      interviewRuns,
      answerDraft
    };
    try {
      window.localStorage.setItem(PERSISTENCE_KEY, JSON.stringify(snapshot));
      setLastSavedAt(savedAt);
    } catch {
      setRestoredNotice("浏览器本地存储空间不足，本次记录可能无法完整保存。");
    }
  }, [
    analysisRunId,
    answerDraft,
    chat,
    currentStage,
    error,
    examPoints,
    feed,
    filesRead,
    findingsSeen,
    interviewTotal,
    interviewSession,
    activeQuestionSet,
    latestReadPath,
    mode,
    planSummary,
    questions,
    reportDraft,
    repositoryUrl,
    result,
    sessionId,
    stageLabel,
    status,
    summary,
    questionSets,
    interviewRuns
  ]);

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
        setCurrentStage(event.stage);
        setStageLabel(event.detail ?? event.stage);
        pushFeed("stage", event.detail ?? event.stage);
        break;
      case "run":
        setAnalysisRunId(event.runId);
        break;
      case "file_read":
        setFilesRead((prev) => prev + 1);
        setLatestReadPath(event.path);
        pushFeed("file", `读取 ${event.path}${event.dimension ? `（${event.dimension} 补读）` : ""}`);
        break;
      case "plan":
        setPlanSummary(event.plan);
        pushFeed(
          "stage",
          `研究计划（${event.plan.analysisMode}）：${event.plan.dimensions
            .map((dimension) => `${dimension.key}×${dimension.files.length}文件`)
            .join("，")}`
        );
        break;
      case "finding":
        setFindingsSeen((prev) => prev + 1);
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
        setInterviewSession(event.session ?? null);
        setInterviewTotal(event.total);
        pushChat({
          role: "interviewer",
          kind: "main",
          text: event.question.question,
          meta: `Q1/${event.total}`
        });
        break;
      case "session_state":
        setInterviewSession(event.session);
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
        if (activeQuestionSet) {
          const run: InterviewRun = {
            id: createClientId(),
            questionSetId: activeQuestionSet.id,
            repoFullName: activeQuestionSet.repoFullName,
            mode: activeQuestionSet.mode,
            createdAt: Date.now(),
            summary: event.summary
          };
          setInterviewRuns((prev) => [run, ...prev.filter((item) => item.questionSetId !== run.questionSetId)]);
        }
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
    const urlError = validateGitHubRepoUrl(repositoryUrl);
    if (urlError) {
      setStatus("error");
      setError(urlError);
      setResult(null);
      setAnalysisRunId("");
      setCopied(false);
      setFeed([]);
      setReportDraft("");
      setExamPoints([]);
      setQuestions([]);
      setSessionId("");
      setChat([]);
      setInterviewTotal(0);
      setSummary(null);
      setInterviewSession(null);
      setActiveQuestionSet(null);
      setAnswerDraft("");
      setStageLabel("");
      setCurrentStage(null);
      setPlanSummary(null);
      setFilesRead(0);
      setFindingsSeen(0);
      setLatestReadPath("");
      return;
    }
    setStatus("loading");
    setMode("survey");
    setError("");
    setResult(null);
    setAnalysisRunId("");
    setCopied(false);
    setFeed([]);
    setReportDraft("");
    setExamPoints([]);
    setQuestions([]);
    setSessionId("");
    setChat([]);
    setInterviewTotal(0);
    setSummary(null);
    setInterviewSession(null);
    setActiveQuestionSet(null);
    setQuestionSets([]);
    setInterviewRuns([]);
    setAnswerDraft("");
    setStageLabel("连接分析服务");
    setCurrentStage("scout");
    setPlanSummary(null);
    setFilesRead(0);
    setFindingsSeen(0);
    setLatestReadPath("");

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
      const responseRunId = response.headers.get("X-Analysis-Run-Id");
      if (responseRunId) setAnalysisRunId(responseRunId);

      await consumeSse(response.body, handleEvent);
      setStatus((prev) => (prev === "loading" ? "done" : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : "分析失败。");
      setStatus("error");
    }
  }

  async function reconnectAnalysisRun(runId: string) {
    if (reconnectingRun.current) return;
    reconnectingRun.current = true;
    setError("");
    setStatus("loading");
    setRestoredNotice("正在重新连接上次分析任务。");

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId })
      });
      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error ?? `续接分析失败 (${response.status})。`);
      }
      const responseRunId = response.headers.get("X-Analysis-Run-Id");
      if (responseRunId) setAnalysisRunId(responseRunId);
      setFeed([]);
      setReportDraft("");
      setExamPoints([]);
      setQuestions([]);
      setSessionId("");
      setChat([]);
      setInterviewTotal(0);
      setSummary(null);
      setInterviewSession(null);
      setActiveQuestionSet(null);
      setStageLabel("重新连接分析任务");
      setCurrentStage(null);
      setPlanSummary(null);
      setFilesRead(0);
      setFindingsSeen(0);
      setLatestReadPath("");
      feedSeq.current = 0;
      await consumeSse(response.body, handleEvent);
      setStatus((prev) => (prev === "loading" ? "done" : prev));
      setRestoredNotice("已续接并恢复上次分析任务。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "续接分析失败，请重新开始。");
      setStatus("error");
      setRestoredNotice("服务端分析任务无法续接，已保留本地保存的内容。");
    } finally {
      reconnectingRun.current = false;
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
        body: JSON.stringify({ sessionId, answer, end, restoreSession: interviewSession ?? undefined })
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

  async function requestPracticeHelp(kind: "hint" | "answer") {
    if (!sessionId || !interviewSession || practiceHelpLoading) return;
    setPracticeHelpLoading(kind);
    try {
      const response = await fetch("/api/practice-help", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, kind, restoreSession: interviewSession })
      });
      const data = (await response.json().catch(() => null)) as { text?: string; error?: string } | null;
      if (!response.ok) throw new Error(data?.error ?? `AI 生成失败 (${response.status})。`);
      pushChat({
        role: "system",
        text: data?.text?.trim() || (kind === "hint" ? "AI 暂时没有生成有效提示。" : "AI 暂时没有生成有效参考答案。")
      });
    } catch (err) {
      pushChat({ role: "system", text: err instanceof Error ? err.message : "AI 生成失败，请稍后重试。" });
    } finally {
      setPracticeHelpLoading(null);
    }
  }

  async function startInteractiveSession(nextMode: InteractiveMode, reuseQuestionSet?: QuestionSet) {
    if (!result || startingMode || sending) return;
    setStartingMode(nextMode);
    setMode(nextMode);
    setError("");
    setSessionId("");
    setChat([]);
    setInterviewTotal(0);
    setSummary(null);
    setInterviewSession(null);
    setActiveQuestionSet(null);
    setAnswerDraft("");
    try {
      const response = await fetch("/api/question-set", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: nextMode, result, questionSet: reuseQuestionSet })
      });
      const data = (await response.json().catch(() => null)) as
        | {
            questionSet?: QuestionSet;
            sessionId?: string;
            session?: InterviewSession;
            question?: InterviewQuestion;
            total?: number;
            warnings?: string[];
            error?: string;
          }
        | null;
      if (!response.ok || !data?.questionSet || !data.sessionId || !data.session || !data.question) {
        throw new Error(data?.error ?? `题集生成失败 (${response.status})。`);
      }

      const createdQuestionSet = data.questionSet;
      setActiveQuestionSet(createdQuestionSet);
      setQuestionSets((prev) => [createdQuestionSet, ...prev.filter((item) => item.id !== createdQuestionSet.id)]);
      setSessionId(data.sessionId);
      setInterviewSession(data.session);
      setInterviewTotal(data.total ?? data.session.questions.length);
      pushChat({
        role: "interviewer",
        kind: "main",
        text: data.question.question,
        meta: `Q1/${data.total ?? data.session.questions.length}`
      });
      for (const warning of data.warnings ?? []) pushChat({ role: "system", text: warning });
    } catch (err) {
      setError(err instanceof Error ? err.message : "题集生成失败，请重试。");
    } finally {
      setStartingMode(null);
    }
  }

  function clearPersistedRun() {
    try {
      window.localStorage.removeItem(PERSISTENCE_KEY);
    } catch {
      // ignore localStorage failures; clearing UI state still matters.
    }
    setRepositoryUrl("");
    setStatus("idle");
    setResult(null);
    setAnalysisRunId("");
    setError("");
    setCopied(false);
    setFeed([]);
    setReportDraft("");
    setExamPoints([]);
    setQuestions([]);
    setSessionId("");
    setChat([]);
    setInterviewTotal(0);
    setSummary(null);
    setInterviewSession(null);
    setActiveQuestionSet(null);
    setQuestionSets([]);
    setInterviewRuns([]);
    setAnswerDraft("");
    setStageLabel("");
    setCurrentStage(null);
    setPlanSummary(null);
    setFilesRead(0);
    setFindingsSeen(0);
    setLatestReadPath("");
    setLastSavedAt(null);
    setRestoredNotice("");
    feedSeq.current = 0;
  }

  return (
    <main className="shell">
      <section className="workspace">
        <div className="intro">
          <p className="eyebrow">v1.0.0-beta.1</p>
          <h1>GitHub Repo 项目考核面试生成器</h1>
          <p className="lede">
            Deep Research Agent 读懂你的仓库（方法、训练、评测、配置、复现证据），结合 kaomian
            高频题库，先沉淀项目细节地图，再进入练习或测试。
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
            {status === "loading" ? "分析中" : result ? "重新分析" : "开始分析"}
          </button>
        </div>

        {(lastSavedAt || restoredNotice) && (
          <div className="persistenceRow">
            <span>
              {restoredNotice || "本轮记录已自动保存"}
              {lastSavedAt ? ` · ${formatSavedAt(lastSavedAt)}` : ""}
            </span>
            <button type="button" onClick={clearPersistedRun} disabled={status === "loading"}>
              清空本地记录
            </button>
          </div>
        )}

        {status !== "idle" && (currentStage || feed.length > 0 || filesRead > 0 || result || reportDraft) && (
          <ProgressDashboard
            status={status}
            currentStage={currentStage}
            stageLabel={stageLabel}
            plan={planSummary}
            filesRead={filesRead}
            findingsSeen={findingsSeen}
            examPointCount={examPoints.length}
            questionCount={questions.length}
            latestReadPath={latestReadPath}
          />
        )}

        {status === "error" && <div className="error">{error}</div>}
        {status !== "error" && error && <div className="error">{error}</div>}

        {result && (
          <ModuleSwitcher
            mode={mode}
            result={result}
            questionSets={questionSets}
            interviewRuns={interviewRuns}
            startingMode={startingMode}
            onSelectSurvey={() => setMode("survey")}
            onStartPractice={(questionSet) => void startInteractiveSession("practice", questionSet)}
            onStartTest={(questionSet) => void startInteractiveSession("interview", questionSet)}
          />
        )}

        {interviewReady && (
          <section className="chatPanel priority" aria-label={practiceMode ? "练习模式" : "测试模式"}>
            <div className="chatHead">
              <div>
                <p className="eyebrow">{practiceMode ? "Practice Session" : "Test Session"}</p>
                <h2>
                  {practiceMode ? "练习模式" : "测试模式"}
                  {interviewTotal > 0 && <span className="count"> {interviewTotal} 道主问题链</span>}
                </h2>
                {activeQuestionSet && <p className="sessionSubtitle">{activeQuestionSet.title}</p>}
              </div>
              {!summary && (
                <button className="endBtn" disabled={sending} onClick={() => void sendAnswer(true)}>
                  {practiceMode ? "结束练习出复盘" : "提前结束测试"}
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

            {practiceMode && !summary && sessionId && (
              <div className="practiceTools" aria-label="练习辅助">
                <button
                  type="button"
                  disabled={sending || !interviewSession || practiceHelpLoading !== null}
                  onClick={() => void requestPracticeHelp("hint")}
                >
                  {practiceHelpLoading === "hint" ? "AI 生成中" : "给我提示"}
                </button>
                <button
                  type="button"
                  disabled={sending || !interviewSession || practiceHelpLoading !== null}
                  onClick={() => void requestPracticeHelp("answer")}
                >
                  {practiceHelpLoading === "answer" ? "AI 生成中" : "看参考答案"}
                </button>
              </div>
            )}

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
                <h2>面试复盘</h2>
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
                {(summary.questionReviews ?? []).length > 0 && (
                  <div className="summaryBlock primaryReviewBlock">
                    <h3>逐题复盘</h3>
                    <div className="questionReviewList">
                      {(summary.questionReviews ?? []).map((item, index) => (
                        <article className={`questionReviewCard verdict-${item.verdict}`} key={`${item.question}-${index}`}>
                          <div className="questionReviewHead">
                            <span className="scoreChip">{item.score}/5</span>
                            <span className="evalVerdict">{item.verdict}</span>
                          </div>
                          <h4>{item.question}</h4>
                          {item.answer && <p className="answerExcerpt">你的回答：{item.answer}</p>}
                          <div className="reviewColumns">
                            {item.whatWorked.length > 0 && (
                              <div>
                                <strong>已经答到</strong>
                                <ul>
                                  {item.whatWorked.map((point) => (
                                    <li key={point}>{point}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {item.missingPoints.length > 0 && (
                              <div>
                                <strong>需要补齐</strong>
                                <ul>
                                  {item.missingPoints.map((point) => (
                                    <li key={point}>{point}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                          {item.betterAnswer && (
                            <div className="betterAnswer">
                              <strong>更好的回答方式</strong>
                              <p>{item.betterAnswer}</p>
                            </div>
                          )}
                          {item.followUpAdvice.length > 0 && (
                            <div className="followUpAdvice">
                              <strong>下一轮追问准备</strong>
                              <ul>
                                {item.followUpAdvice.map((point) => (
                                  <li key={point}>{point}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </article>
                      ))}
                    </div>
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
                {(summary.evidenceReview ?? []).length > 0 && (
                  <div className="summaryBlock">
                    <h3>证据链复盘</h3>
                    <ul>
                      {(summary.evidenceReview ?? []).map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {(summary.priorityFixes ?? []).length > 0 && (
                  <div className="summaryBlock">
                    <h3>优先补坑</h3>
                    <ul>
                      {(summary.priorityFixes ?? []).map((item) => (
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
                {(summary.practiceDrills ?? []).length > 0 && (
                  <div className="summaryBlock">
                    <h3>专项练习</h3>
                    <ul>
                      {(summary.practiceDrills ?? []).map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {feed.length > 0 && status !== "idle" && (
          <details
            className={interviewReady ? "feedPanel compact collapsiblePanel" : "feedPanel collapsiblePanel"}
            aria-live="polite"
            open
          >
            <summary className="feedHead panelSummary">
              <span>
                <span className={status === "loading" ? "dot" : "dot idle"} />
                {interviewReady ? "面试已开始" : status === "loading" ? stageLabel : "分析完成"}
              </span>
            </summary>
            <ul className="feedList">
              {feed.map((item) => (
                <li key={item.id} className={`feedItem ${item.kind}`}>
                  {item.text}
                </li>
              ))}
            </ul>
          </details>
        )}

        {!result && reportDraft && !sessionId && (
          <details className="report streamingReport collapsiblePanel" aria-label="理解报告生成中" aria-live="polite" open>
            <summary className="reportHead panelSummary">
              <div>
                <p className="eyebrow">Streaming</p>
                <h2>仓库理解报告（生成中）</h2>
              </div>
            </summary>
            <pre>{reportDraft}</pre>
          </details>
        )}

        {mode === "survey" && examPoints.length > 0 && !result && (
          <details className="examPoints collapsiblePanel" aria-label="项目考核点" open>
            <summary className="sectionSummary panelSummary">
              <h2>
                项目考核点 <span className="count">{examPoints.length}</span>
              </h2>
            </summary>
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
          </details>
        )}

        {mode === "survey" && questions.length > 0 && !result && (
          <details className="questionsPanel collapsiblePanel" aria-label="题目种子" open>
            <summary className="sectionSummary panelSummary">
              <h2>
                题目种子 <span className="count">{questions.length}</span>
              </h2>
            </summary>
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
          </details>
        )}

        {mode === "survey" && result && <RenderedInterviewPlan result={result} copied={copied} onCopy={() => void copyReport()} />}
      </section>
    </main>
  );
}

type RoadmapStage = PipelineStage | "complete";

function ModuleSwitcher({
  mode,
  result,
  questionSets,
  interviewRuns,
  startingMode,
  onSelectSurvey,
  onStartPractice,
  onStartTest
}: {
  mode: AnalyzeMode;
  result: AnalyzeResponse;
  questionSets: QuestionSet[];
  interviewRuns: InterviewRun[];
  startingMode: InteractiveMode | null;
  onSelectSurvey: () => void;
  onStartPractice: (questionSet?: QuestionSet) => void;
  onStartTest: (questionSet?: QuestionSet) => void;
}) {
  const latestRun = interviewRuns[0];
  const latestQuestionSet = questionSets[0];
  return (
    <section className="moduleHub" aria-label="分析后的模式入口">
      <div className="moduleHubHead">
        <div>
          <p className="eyebrow">Analysis Ready</p>
          <h2>{result.repo.fullName} 的项目底座已生成</h2>
          <p>Survey 查看项目细节地图；练习和测试会基于同一份分析结果，各自生成一套新的问题。</p>
        </div>
      </div>
      <div className="moduleGrid">
        <button className={mode === "survey" ? "moduleCard active" : "moduleCard"} type="button" onClick={onSelectSurvey}>
          <span>01</span>
          <strong>Survey 报告</strong>
          <small>{result.examPoints.length} 个考核点 · {result.questions.length} 个题目种子</small>
        </button>
        <button
          className={mode === "practice" ? "moduleCard active" : "moduleCard"}
          type="button"
          disabled={Boolean(startingMode)}
          onClick={() => onStartPractice()}
        >
          <span>02</span>
          <strong>{startingMode === "practice" ? "正在生成练习题" : "练习模式"}</strong>
          <small>新题集 · 可看提示和参考答案</small>
        </button>
        <button
          className={mode === "interview" ? "moduleCard active" : "moduleCard"}
          type="button"
          disabled={Boolean(startingMode)}
          onClick={() => onStartTest()}
        >
          <span>03</span>
          <strong>{startingMode === "interview" ? "正在生成测试题" : "测试模式"}</strong>
          <small>新题集 · 不给提示，结束后详尽复盘</small>
        </button>
      </div>
      {(questionSets.length > 0 || latestRun) && (
        <div className="historyStrip" aria-label="最近题集和复盘">
          {latestQuestionSet && (
            <div>
              <strong>最近题集</strong>
              <p>
                {latestQuestionSet.mode === "practice" ? "练习" : "测试"} · {latestQuestionSet.questions.length} 题 ·{" "}
                {formatDateTime(latestQuestionSet.createdAt)}
              </p>
              <div className="historyActions">
                <button type="button" disabled={Boolean(startingMode)} onClick={() => onStartPractice(latestQuestionSet)}>
                  用这套练习
                </button>
                <button type="button" disabled={Boolean(startingMode)} onClick={() => onStartTest(latestQuestionSet)}>
                  用这套测试
                </button>
              </div>
            </div>
          )}
          {latestRun && (
            <div>
              <strong>最近复盘</strong>
              <p>
                {latestRun.mode === "practice" ? "练习" : "测试"} · {summaryAverage(latestRun.summary)} ·{" "}
                {formatDateTime(latestRun.createdAt)}
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

type RoadmapStep = {
  stage: RoadmapStage;
  label: string;
  caption: string;
};

const SURVEY_ROADMAP: RoadmapStep[] = [
  { stage: "scout", label: "抓仓库", caption: "README / 文件树 / 证据文件" },
  { stage: "plan", label: "定计划", caption: "判断仓库形态和研究维度" },
  { stage: "research", label: "并行深读", caption: "多个 digest worker 读不同维度" },
  { stage: "synthesize", label: "合成报告", caption: "汇总 claim、代码和复现证据" },
  { stage: "questions", label: "整理细节", caption: "连接 kaomian，形成可问方向和题目种子" },
  { stage: "complete", label: "进入模块", caption: "Survey / 练习 / 测试共用同一份分析底座" }
];

function ProgressDashboard({
  status,
  currentStage,
  stageLabel,
  plan,
  filesRead,
  findingsSeen,
  examPointCount,
  questionCount,
  latestReadPath
}: {
  status: Status;
  currentStage: PipelineStage | null;
  stageLabel: string;
  plan: ResearchPlanSummary | null;
  filesRead: number;
  findingsSeen: number;
  examPointCount: number;
  questionCount: number;
  latestReadPath: string;
}) {
  const steps = SURVEY_ROADMAP;
  const activeStage: RoadmapStage = status === "done" ? "complete" : currentStage ?? "scout";
  const activeIndex = Math.max(
    0,
    steps.findIndex((step) => step.stage === activeStage)
  );
  const clampedActiveIndex = activeIndex === -1 ? 0 : activeIndex;
  const nextStep = status === "loading" ? steps[clampedActiveIndex + 1] : null;
  const detail = status === "error" ? "分析中断，请查看错误信息" : status === "done" ? "本轮分析完成" : stageLabel || "连接分析服务";
  const planLabel = plan
    ? `${plan.analysisMode} · ${plan.dimensions.length} 个维度`
    : "Analysis";

  return (
    <section className={`progressDashboard status-${status}`} aria-label="分析进度">
      <div className="dashTopline">
        <div>
          <p className="eyebrow">Run Dashboard</p>
          <h2>{roadmapTitle(activeStage, status)}</h2>
          <p className="dashDetail">{detail}</p>
        </div>
        <div className="dashMode">
          <span>{planLabel}</span>
          {nextStep && <strong>下一步：{nextStep.label}</strong>}
        </div>
      </div>

      <ol className="roadmap" aria-label="分析路线图">
        {steps.map((step, index) => {
          const state =
            status === "error" && index === clampedActiveIndex
              ? "blocked"
              : index < clampedActiveIndex || status === "done"
                ? "done"
                : index === clampedActiveIndex
                  ? "active"
                  : "queued";
          return (
            <li className={`roadmapStep ${state}`} key={step.stage} aria-current={state === "active" ? "step" : undefined}>
              <span className="roadmapIndex">{String(index + 1).padStart(2, "0")}</span>
              <div>
                <strong>{step.label}</strong>
                <small>{step.caption}</small>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="dashStats" aria-label="实时产出">
        <div>
          <span>已读文件</span>
          <strong>{filesRead}</strong>
        </div>
        <div>
          <span>研究发现</span>
          <strong>{findingsSeen}</strong>
        </div>
        <div>
          <span>考核点</span>
          <strong>{examPointCount}</strong>
        </div>
        <div>
          <span>题目</span>
          <strong>{questionCount}</strong>
        </div>
      </div>

      <div className="dashFoot">
        <span>{latestReadPath ? `最近读取：${latestReadPath}` : "等待第一个证据文件"}</span>
      </div>
    </section>
  );
}

function roadmapTitle(stage: RoadmapStage, status: Status): string {
  if (status === "error") return "分析被打断";
  if (status === "done") return "分析完成";
  const labels: Record<RoadmapStage, string> = {
    scout: "正在抓取仓库证据",
    plan: "正在规划研究路线",
    research: "正在并行深读",
    synthesize: "正在合成项目理解",
    questions: "正在整理可问细节",
    interview_ready: "正在准备模拟面试",
    complete: "分析完成"
  };
  return labels[stage];
}

function validateGitHubRepoUrl(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return "请输入完整的 GitHub 仓库链接，例如 https://github.com/owner/repo。";
  }
  if (url.hostname !== "github.com" && url.hostname !== "www.github.com") {
    return "请输入 github.com 仓库链接。";
  }
  const [owner, repoSegment, marker, ...rest] = url.pathname.split("/").filter(Boolean);
  if (!owner || !repoSegment) {
    return "GitHub 链接需要包含 owner 和 repo。";
  }
  const repo = repoSegment.replace(/\.git$/, "");
  const repoNamePattern = /^[A-Za-z0-9_.-]+$/;
  if (!repo || !repoNamePattern.test(owner) || !repoNamePattern.test(repo)) {
    return "GitHub 仓库链接中的 owner 或 repo 不合法。";
  }
  if (marker && marker !== "tree") {
    return "请输入 GitHub 仓库主页链接，或 /tree/{branch} 分支链接。";
  }
  if (marker === "tree" && rest.length === 0) {
    return "GitHub 分支链接需要包含 branch。";
  }
  return null;
}

function readPersistedRun(): PersistedRun | null {
  try {
    const raw = window.localStorage.getItem(PERSISTENCE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<PersistedRun>;
    if (data.version !== 1) return null;
    if (typeof data.savedAt !== "number") return null;
    if (typeof data.repositoryUrl !== "string") return null;
    if (!isAnalyzeMode(data.mode)) return null;
    if (!isStatus(data.status)) return null;
    return {
      version: 1,
      savedAt: data.savedAt,
      repositoryUrl: data.repositoryUrl,
      mode: data.mode,
      status: data.status,
      runId: typeof data.runId === "string" ? data.runId : "",
      result: data.result ?? null,
      error: typeof data.error === "string" ? data.error : "",
      feed: Array.isArray(data.feed) ? data.feed : [],
      stageLabel: typeof data.stageLabel === "string" ? data.stageLabel : "",
      currentStage: isPipelineStage(data.currentStage) ? data.currentStage : null,
      planSummary: data.planSummary ?? null,
      filesRead: typeof data.filesRead === "number" ? data.filesRead : 0,
      findingsSeen: typeof data.findingsSeen === "number" ? data.findingsSeen : 0,
      latestReadPath: typeof data.latestReadPath === "string" ? data.latestReadPath : "",
      reportDraft: typeof data.reportDraft === "string" ? data.reportDraft : "",
      examPoints: Array.isArray(data.examPoints) ? data.examPoints : [],
      questions: Array.isArray(data.questions) ? data.questions : [],
      sessionId: typeof data.sessionId === "string" ? data.sessionId : "",
      chat: Array.isArray(data.chat) ? data.chat : [],
      interviewTotal: typeof data.interviewTotal === "number" ? data.interviewTotal : 0,
      summary: data.summary ?? null,
      interviewSession: data.interviewSession ?? null,
      activeQuestionSet: data.activeQuestionSet ?? null,
      questionSets: Array.isArray(data.questionSets) ? data.questionSets : [],
      interviewRuns: Array.isArray(data.interviewRuns) ? data.interviewRuns : [],
      answerDraft: typeof data.answerDraft === "string" ? data.answerDraft : ""
    };
  } catch {
    return null;
  }
}

function hasPersistableContent({
  currentStage,
  result,
  reportDraft,
  feed,
  examPoints,
  questions,
  sessionId,
  chat,
  summary,
  questionSets,
  interviewRuns
}: {
  currentStage: PipelineStage | null;
  result: AnalyzeResponse | null;
  reportDraft: string;
  feed: FeedItem[];
  examPoints: ExamPoint[];
  questions: InterviewQuestion[];
  sessionId: string;
  chat: ChatMessage[];
  summary: InterviewSummary | null;
  questionSets: QuestionSet[];
  interviewRuns: InterviewRun[];
}) {
  return Boolean(
    currentStage ||
      result ||
      reportDraft ||
      feed.length > 0 ||
      examPoints.length > 0 ||
      questions.length > 0 ||
      sessionId ||
      chat.length > 0 ||
      summary ||
      questionSets.length > 0 ||
      interviewRuns.length > 0
  );
}

function isAnalyzeMode(value: unknown): value is AnalyzeMode {
  return value === "survey" || value === "interview" || value === "practice";
}

function isStatus(value: unknown): value is Status {
  return value === "idle" || value === "loading" || value === "done" || value === "error";
}

function isPipelineStage(value: unknown): value is PipelineStage {
  return (
    value === "scout" ||
    value === "plan" ||
    value === "research" ||
    value === "synthesize" ||
    value === "questions" ||
    value === "interview_ready"
  );
}

function formatSavedAt(savedAt: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(savedAt);
}

function formatDateTime(value: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(value);
}

function summaryAverage(summary: InterviewSummary): string {
  if (summary.scores.length === 0) return "暂无得分";
  const average = summary.scores.reduce((sum, item) => sum + item.score, 0) / summary.scores.length;
  return `平均 ${Math.round(average * 10) / 10}/5`;
}

function createClientId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function RenderedInterviewPlan({
  result,
  copied,
  onCopy
}: {
  result: AnalyzeResponse;
  copied: boolean;
  onCopy: () => void;
}) {
  const priorityPoints = [
    ...result.examPoints.filter((point) => point.riskLevel === "high"),
    ...result.examPoints.filter((point) => point.riskLevel !== "high")
  ].slice(0, 3);
  const spotlightQuestions = uniqueByQuestion([
    ...result.questions.filter((question) => question.difficulty === "hard"),
    ...result.questions.filter((question) => question.source === "kaomian"),
    ...result.questions
  ]).slice(0, 3);
  const primaryEvidence = uniqueStrings([
    ...priorityPoints.flatMap((point) => point.evidence),
    ...spotlightQuestions.flatMap((question) => question.evidence)
  ]).slice(0, 8);
  const supportSignals = [
    ...result.understanding.entryPoints,
    ...result.understanding.evaluationSignals,
    ...result.understanding.reproductionRecipe
  ].filter(Boolean);

  return (
    <section className="planCanvas" aria-label="项目细节地图">
      <header className="planHero">
        <div>
          <p className="eyebrow">Project Survey</p>
          <h2>{result.repo.fullName}</h2>
          <p className="planSummary">{result.understanding.summary}</p>
        </div>
        <div className="planScoreboard" aria-label="分析指标">
          <div>
            <span>考核点</span>
            <strong>{result.examPoints.length}</strong>
          </div>
          <div>
            <span>题目种子</span>
            <strong>{result.questions.length}</strong>
          </div>
          <div>
            <span>证据文件</span>
            <strong>{result.evidenceFiles.length}</strong>
          </div>
        </div>
      </header>

      <section className="priorityBand" aria-label="项目可问细节">
        <div className="bandTitle">
          <p className="eyebrow">Start Here</p>
          <h2>最容易被问的细节</h2>
        </div>
        <div className="priorityGrid">
          {priorityPoints.map((point, index) => (
            <article className="priorityCard" key={`${point.title}-${index}`}>
              <span className={`chip risk-${point.riskLevel}`}>{riskText(point.riskLevel)}</span>
              <h3>{point.title}</h3>
              <p>{point.whyAsk || "这类问题最容易暴露候选人是否真的理解项目取舍。"}</p>
              <EvidenceLine paths={point.evidence} />
            </article>
          ))}
        </div>
      </section>

      <section className="focusLayout" aria-label="核心面试题">
        <div className="focusMain">
          <div className="sectionLead">
            <p className="eyebrow">Question Seeds</p>
            <h2>可转成题目的方向</h2>
          </div>
          <div className="spotlightList">
            {spotlightQuestions.map((question, index) => (
              <QuestionSpotlight question={question} index={index} key={`${question.question}-${index}`} />
            ))}
          </div>
        </div>

        <aside className="prepRail" aria-label="答题抓手">
          <div className="railBlock">
            <h3>一句话项目定位</h3>
            <p>{result.understanding.problemSetting || result.understanding.summary}</p>
          </div>
          <div className="railBlock">
            <h3>先打开这些证据</h3>
            <CompactPathList paths={primaryEvidence.length > 0 ? primaryEvidence : result.evidenceFiles.map((file) => file.path).slice(0, 6)} />
          </div>
          {supportSignals.length > 0 && (
            <div className="railBlock quiet">
              <h3>复现/评测线索</h3>
              <CompactPathList paths={supportSignals.slice(0, 6)} />
            </div>
          )}
        </aside>
      </section>

      <section className="questionDeck" aria-label="题目种子">
        <div className="sectionLead">
          <p className="eyebrow">Seed Set</p>
          <h2>Survey 题目种子</h2>
        </div>
        <div className="questionDeckGrid">
          {result.questions.map((question, index) => (
            <article className="planQuestionCard" key={`${question.question}-${index}`}>
              <header>
                <span className={`chip diff-${question.difficulty}`}>{difficultyText(question.difficulty)}</span>
                {question.source === "kaomian" && <span className="chip kaomian">高频题改写</span>}
                <span className="qIndex">Q{String(index + 1).padStart(2, "0")}</span>
              </header>
              <p className="qText">{question.question}</p>
              <div className="answerGrid">
                <MiniList title="好回答要点" items={question.expectedAnswer.slice(0, 3)} />
                <MiniList title="红旗回答" items={question.redFlags.slice(0, 3)} danger />
              </div>
              <details>
                <summary>证据与追问</summary>
                <EvidenceLine paths={question.evidence} />
                <MiniList title="追问链" items={question.followUps} />
              </details>
            </article>
          ))}
        </div>
      </section>

      <section className="secondaryReport" aria-label="低优先级信息">
        <details>
          <summary>仓库元信息、证据文件和原始 Markdown</summary>
          <div className="secondaryGrid">
            <div className="smallFacts">
              <h3>仓库元信息</h3>
              <dl>
                <div>
                  <dt>分析模式</dt>
                  <dd>{result.analysisMode}</dd>
                </div>
                <div>
                  <dt>语言</dt>
                  <dd>{result.repo.language ?? "Unknown"}</dd>
                </div>
                <div>
                  <dt>默认分支</dt>
                  <dd>{result.repo.defaultBranch}</dd>
                </div>
                <div>
                  <dt>Stars</dt>
                  <dd>{result.repo.stars}</dd>
                </div>
              </dl>
            </div>
            <div className="smallFacts">
              <h3>证据文件</h3>
              <CompactPathList paths={result.evidenceFiles.map((file) => `${file.path} · ${file.category}`).slice(0, 18)} />
            </div>
            {result.warnings.length > 0 && (
              <div className="smallFacts warning">
                <h3>Warnings</h3>
                <CompactPathList paths={result.warnings} />
              </div>
            )}
          </div>
          <div className="rawReportHead">
            <h3>原始 Markdown</h3>
            <button className="copy" onClick={onCopy}>
              {copied ? "已复制" : "复制"}
            </button>
          </div>
          <pre>{result.markdownReport}</pre>
        </details>
      </section>
    </section>
  );
}

function QuestionSpotlight({ question, index }: { question: InterviewQuestion; index: number }) {
  return (
    <article className="spotlightQuestion">
      <header>
        <span className="spotlightIndex">{String(index + 1).padStart(2, "0")}</span>
        <div>
          <span className={`chip diff-${question.difficulty}`}>{difficultyText(question.difficulty)}</span>
          {question.source === "kaomian" && <span className="chip kaomian">高频题改写</span>}
        </div>
      </header>
      <p>{question.question}</p>
      {question.whyAsk && <small>{question.whyAsk}</small>}
      <EvidenceLine paths={question.evidence} />
    </article>
  );
}

function MiniList({ title, items, danger = false }: { title: string; items: string[]; danger?: boolean }) {
  if (items.length === 0) return null;
  return (
    <div className={danger ? "miniList danger" : "miniList"}>
      <h3>{title}</h3>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function EvidenceLine({ paths }: { paths: string[] }) {
  if (paths.length === 0) return <p className="cardEvidence">证据：—</p>;
  return (
    <p className="cardEvidence">
      证据：{paths.slice(0, 4).join("、")}
      {paths.length > 4 ? ` 等 ${paths.length} 处` : ""}
    </p>
  );
}

function CompactPathList({ paths }: { paths: string[] }) {
  if (paths.length === 0) return <p className="emptySmall">未明确识别</p>;
  return (
    <ul className="compactPathList">
      {paths.map((path) => (
        <li key={path}>{path}</li>
      ))}
    </ul>
  );
}

function uniqueByQuestion(questions: InterviewQuestion[]): InterviewQuestion[] {
  const seen = new Set<string>();
  return questions.filter((question) => {
    if (seen.has(question.question)) return false;
    seen.add(question.question);
    return true;
  });
}

function uniqueStrings(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}

function riskText(risk: RiskLevel): string {
  const labels: Record<RiskLevel, string> = { low: "低风险", medium: "中风险", high: "高风险" };
  return labels[risk];
}

function difficultyText(difficulty: Difficulty): string {
  const labels: Record<Difficulty, string> = { warmup: "热身", medium: "中等", hard: "强压" };
  return labels[difficulty];
}
