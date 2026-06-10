"use client";

import { FormEvent, Fragment, useEffect, useMemo, useState } from "react";
import type {
  AnalyzeResponse,
  EvidenceDocument,
  EvidenceRef,
  RepoInterviewRisk,
  RiskChatMessage,
  RiskChatResponse,
  PipelineStage,
  SseEvent
} from "@/lib/types";

const STORAGE_KEY = "pku-ai-interviewer:risk-reviewer:v1";
const DEMO_REPO = "https://github.com/MistySun19/PKU-AI-Interviewer";

type ProgressItem = {
  id: string;
  text: string;
};

type RiskChatState = {
  history: RiskChatMessage[];
  draft: string;
  busy: boolean;
};

type ViewMode = "demo" | "intro";

export default function Home() {
  const [viewMode, setViewMode] = useState<ViewMode>("demo");
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [selectedRiskId, setSelectedRiskId] = useState<string>("");
  const [selectedEvidenceKey, setSelectedEvidenceKey] = useState<string>("");
  const [progress, setProgress] = useState<ProgressItem[]>([]);
  const [currentStage, setCurrentStage] = useState<PipelineStage | null>(null);
  const [filesRead, setFilesRead] = useState(0);
  const [findingsSeen, setFindingsSeen] = useState(0);
  const [candidateQuestions, setCandidateQuestions] = useState(0);
  const [latestReadPath, setLatestReadPath] = useState("");
  const [status, setStatus] = useState<"idle" | "analyzing" | "ready" | "error">("idle");
  const [error, setError] = useState("");
  const [chats, setChats] = useState<Record<string, RiskChatState>>({});

  useEffect(() => {
    const saved = safeLoad();
    if (!saved) return;
    setResult(saved);
    setRepositoryUrl(saved.repo.htmlUrl);
    setStatus("ready");
    setSelectedRiskId(saved.risks[0]?.id ?? "");
    setSelectedEvidenceKey(evidenceKey(saved.risks[0]?.evidenceRefs[0]));
  }, []);

  useEffect(() => {
    if (!result) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(result));
  }, [result]);

  const risks = useMemo(() => result?.risks ?? [], [result]);
  const selectedRisk = risks.find((risk) => risk.id === selectedRiskId) ?? risks[0];
  const selectedEvidence =
    selectedRisk?.evidenceRefs.find((ref) => evidenceKey(ref) === selectedEvidenceKey) ??
    selectedRisk?.evidenceRefs[0] ??
    null;
  const selectedDocument = selectedEvidence ? findEvidenceDocument(result?.evidenceBundle ?? [], selectedEvidence) : null;
  const chat = selectedRisk ? chats[selectedRisk.id] ?? { history: [], draft: "", busy: false } : null;

  async function analyze(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!repositoryUrl.trim() || status === "analyzing") return;
    setError("");
    setResult(null);
    setSelectedRiskId("");
    setSelectedEvidenceKey("");
    setProgress([{ id: crypto.randomUUID(), text: "正在读取仓库，准备定位会被问穿的地方。" }]);
    setCurrentStage("scout");
    setFilesRead(0);
    setFindingsSeen(0);
    setCandidateQuestions(0);
    setLatestReadPath("");
    setStatus("analyzing");

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repositoryUrl: repositoryUrl.trim(), mode: "survey" })
      });
      if (!response.ok || !response.body) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "分析请求失败。");
      }
      await readAnalysisStream(response.body);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "分析失败。");
      setStatus("error");
    }
  }

  async function readAnalysisStream(body: ReadableStream<Uint8Array>) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let splitIndex = buffer.indexOf("\n\n");
      while (splitIndex !== -1) {
        const frame = buffer.slice(0, splitIndex);
        buffer = buffer.slice(splitIndex + 2);
        handleSseFrame(frame);
        splitIndex = buffer.indexOf("\n\n");
      }
    }
  }

  function handleSseFrame(frame: string) {
    const dataLine = frame.split("\n").find((line) => line.startsWith("data:"));
    if (!dataLine) return;
    const event = JSON.parse(dataLine.slice(5)) as SseEvent;
    if (event.type === "stage") {
      setCurrentStage(event.stage);
      pushProgress(event.detail ?? stageLabel(event.stage));
      return;
    }
    if (event.type === "file_read") {
      setFilesRead((count) => count + 1);
      setLatestReadPath(event.path);
      pushProgress(`读取证据文件：${event.path}`);
      return;
    }
    if (event.type === "finding") {
      setFindingsSeen((count) => count + 1);
      pushProgress(`发现候选风险线索：${event.claim}`);
      return;
    }
    if (event.type === "question") {
      setCandidateQuestions((count) => Math.max(count + 1, event.index + 1));
      return;
    }
    if (event.type === "warning") {
      pushProgress(`注意：${event.message}`);
      return;
    }
    if (event.type === "error") {
      setError(event.message);
      setStatus("error");
      return;
    }
    if (event.type === "result") {
      setResult(event.result);
      setStatus("ready");
      setCurrentStage("interview_ready");
      setCandidateQuestions(event.result.questions.length);
      const firstRisk = event.result.risks[0];
      setSelectedRiskId(firstRisk?.id ?? "");
      setSelectedEvidenceKey(evidenceKey(firstRisk?.evidenceRefs[0]));
      pushProgress(`完成：保留 ${event.result.risks.length} 个通过 Evidence Check 的风险点。`);
    }
  }

  function pushProgress(text: string) {
    setProgress((items) => [...items.slice(-8), { id: crypto.randomUUID(), text }]);
  }

  function selectRisk(risk: RepoInterviewRisk) {
    setSelectedRiskId(risk.id);
    setSelectedEvidenceKey(evidenceKey(risk.evidenceRefs[0]));
  }

  function updateDraft(riskId: string, draft: string) {
    setChats((current) => ({
      ...current,
      [riskId]: { history: current[riskId]?.history ?? [], busy: current[riskId]?.busy ?? false, draft }
    }));
  }

  async function sendAnswer(risk: RepoInterviewRisk) {
    const current = chats[risk.id] ?? { history: [], draft: "", busy: false };
    const answer = current.draft.trim();
    if (!answer || current.busy) return;
    const nextHistory: RiskChatMessage[] = [...current.history, { role: "user", content: answer }];
    setChats((state) => ({ ...state, [risk.id]: { history: nextHistory, draft: "", busy: true } }));
    try {
      const response = await fetch("/api/risk-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          riskId: risk.id,
          risk,
          answer,
          history: nextHistory,
          evidenceRefs: risk.evidenceRefs,
          repoSummary: result?.understanding.summary ?? ""
        })
      });
      const payload = (await response.json()) as RiskChatResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "追问失败。");
      const assistantText = [payload.reply, payload.followUpQuestion ? `追问：${payload.followUpQuestion}` : ""]
        .filter(Boolean)
        .join("\n");
      setChats((state) => ({
        ...state,
        [risk.id]: {
          history: [...nextHistory, { role: "assistant", content: assistantText || "继续说说你的判断依据。" }],
          draft: "",
          busy: false
        }
      }));
    } catch (reason) {
      setChats((state) => ({
        ...state,
        [risk.id]: {
          history: [...nextHistory, { role: "assistant", content: reason instanceof Error ? reason.message : "追问失败。" }],
          draft: "",
          busy: false
        }
      }));
    }
  }

  return (
    <main className="shell">
      <div className="workspace">
        <div className="topBar">
          <div>
            <p className="eyebrow">Traceback</p>
            <strong>Repo Interview Risk Review</strong>
          </div>
          <div className="viewSwitch" aria-label="页面视图切换">
            <button
              type="button"
              className={viewMode === "demo" ? "active" : ""}
              onClick={() => setViewMode("demo")}
            >
              Demo
            </button>
            <button
              type="button"
              className={viewMode === "intro" ? "active" : ""}
              onClick={() => setViewMode("intro")}
            >
              介绍
            </button>
          </div>
        </div>

        {viewMode === "intro" ? (
          <IntroPage />
        ) : (
          <>
            <section className="intro compactIntro">
              <p className="eyebrow">Traceback</p>
              <h1>Traceback</h1>
              <p className="lede">
                你的 GitHub 项目，真的经得起面试官追问吗？
              </p>
              <form className="inputRow" onSubmit={analyze}>
                <input
                  value={repositoryUrl}
                  onChange={(event) => setRepositoryUrl(event.target.value)}
                  placeholder={DEMO_REPO}
                  aria-label="GitHub repository URL"
                />
                <button disabled={status === "analyzing"}>{status === "analyzing" ? "审查中" : "开始审查"}</button>
              </form>
              {error ? <p className="errorText">{error}</p> : null}
            </section>

            {status === "analyzing" || progress.length > 0 ? (
              <AgentDashboard
                status={status}
                currentStage={currentStage}
                filesRead={filesRead}
                findingsSeen={findingsSeen}
                candidateQuestions={candidateQuestions}
                passedRisks={result?.risks.length ?? 0}
                latestReadPath={latestReadPath}
                progress={progress}
              />
            ) : null}

            {result ? (
              <section className="riskReviewer">
                <aside className="riskColumn">
                  <div className="resultHeader">
                    <p className="eyebrow">Repository Risk Review</p>
                    <h2>这是你的项目里最可能被面试官问穿的 {risks.length} 个地方。</h2>
                    <p>{result.repo.fullName} · {result.analysisMode}</p>
                  </div>
                  {result.warnings.length > 0 ? (
                    <div className="warningBox">
                      {result.warnings.map((warning) => (
                        <p key={warning}>{warning}</p>
                      ))}
                    </div>
                  ) : null}
                  <div className="riskList">
                    {risks.map((risk, index) => (
                      <Fragment key={risk.id}>
                        <button
                          type="button"
                          className={`riskCard ${risk.id === selectedRisk?.id ? "active" : ""}`}
                          onClick={() => selectRisk(risk)}
                        >
                          <span className={`riskLevel ${risk.riskLevel}`}>{riskLevelLabel(risk.riskLevel)}</span>
                          <strong>{index + 1}. {risk.title}</strong>
                          <span>{risk.interviewerQuestion}</span>
                          <small>
                            Evidence Check: {risk.evidenceCheck.status} · {risk.evidenceRefs.length} refs
                            {risk.source === "interview_story" ? " · 真实面经改写" : ""}
                          </small>
                        </button>
                        {risk.id === selectedRisk?.id && chat ? (
                          <RiskDetail
                            risk={risk}
                            chat={chat}
                            onDraftChange={(draft) => updateDraft(risk.id, draft)}
                            onSend={() => sendAnswer(risk)}
                          />
                        ) : null}
                      </Fragment>
                    ))}
                  </div>
                </aside>

                <EvidencePane
                  risk={selectedRisk}
                  selectedEvidence={selectedEvidence}
                  selectedDocument={selectedDocument}
                  onSelectEvidence={(ref) => setSelectedEvidenceKey(evidenceKey(ref))}
                />
              </section>
            ) : (
              <section className="emptyState">
                <h2>先给我一个 repo。</h2>
                <p>系统会先抓仓库证据，再输出一组能被代码、README 或配置支撑的面试风险点。</p>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function IntroPage() {
  return (
    <section className="introPage" aria-label="Traceback 项目介绍">
      <div className="introHeroPanel">
        <div>
          <p className="eyebrow">Traceback</p>
          <h1>你的 GitHub 项目，哪里会被面试官问穿？</h1>
          <p>
            输入 GitHub 仓库，系统会把最容易被面试官追问的项目细节标出来，并把每个问题直接链接到代码、README 或配置证据。
          </p>
        </div>
        <div className="introThesis">
          <strong>核心判断</strong>
          <p>项目面试不是看 README 写得多漂亮，而是看你的 claim 能不能在仓库里找到证据。</p>
        </div>
      </div>

      <div className="introSplit">
        <article className="introNarrative">
          <p className="eyebrow">Problem</p>
          <h2>Vibe coding 之后，项目更容易做，也更容易讲虚。</h2>
          <p>
            README 可以很好看，简历也可以很完整。但好的技术面试官会顺着你的项目 claim 一层层追问，直到确认这个项目是不是你真的理解、做过、能解释。
          </p>
          <blockquote>
            Traceback 不生成更多泛题，它先读仓库，再指出哪些地方最可能经不起追问。
          </blockquote>
        </article>

        <aside className="demoCue">
          <p className="eyebrow">3-minute talk flow</p>
          <div>
            <strong>0:00 - 0:30</strong>
            <span>展示 Demo：左边风险点，右边代码证据。</span>
          </div>
          <div>
            <strong>0:30 - 2:30</strong>
            <span>解释 Deep Research Agent 和 Evidence Check Agent。</span>
          </div>
          <div>
            <strong>2:30 - 3:00</strong>
            <span>回到用户价值：逐个补项目理解，直到经得起追问。</span>
          </div>
        </aside>
      </div>

      <div className="agentIntroGrid">
        <article>
          <span>01</span>
          <h2>Deep Research Agent</h2>
          <p>先搜索、读取、整理仓库，形成项目理解地图：项目声称做了什么，关键实现和复现证据在哪里。</p>
        </article>
        <article>
          <span>02</span>
          <h2>Evidence Check Agent</h2>
          <p>每个风险点进入结果前，都要检查 reference 是否充分且必要，避免听起来专业但证据不扎实的问题混进来。</p>
        </article>
        <article>
          <span>03</span>
          <h2>Follow-up Interview</h2>
          <p>用户点开任意风险点直接回答，Agent 会继续追问，把“答得虚”的地方暴露出来。</p>
        </article>
      </div>

      <div className="traceFlow">
        <div>
          <strong>GitHub repo</strong>
          <span>仓库输入</span>
        </div>
        <div>
          <strong>Risk points</strong>
          <span>会被问穿的问题</span>
        </div>
        <div>
          <strong>Evidence viewer</strong>
          <span>代码 / README / 配置证据</span>
        </div>
        <div>
          <strong>Follow-up</strong>
          <span>持续追问与补坑</span>
        </div>
      </div>
    </section>
  );
}

function RiskDetail(props: {
  risk: RepoInterviewRisk;
  chat: RiskChatState;
  onDraftChange: (draft: string) => void;
  onSend: () => void;
}) {
  const { risk, chat, onDraftChange, onSend } = props;
  return (
    <section className="riskDetail">
      <p className="eyebrow">Selected Risk</p>
      <h2>{risk.title}</h2>
      <p className="questionText">{risk.interviewerQuestion}</p>
      <div className="riskDisclosureStack">
        <MetaBlock label="对应 claim" items={[risk.claim]} />
        <MetaBlock label="参考答案" items={[risk.referenceAnswer]} />
        <MetaBlock label="红旗回答" items={risk.redFlags} />
        <MetaBlock label="补坑建议" items={risk.fixSuggestions} />
        <details className="metaBlock">
          <summary>
            <span>Evidence Check</span>
            <small>{risk.evidenceCheck.status}</small>
          </summary>
          <p>{risk.evidenceCheck.reason}</p>
          <p>
            {risk.evidenceCheck.sufficiency} / {risk.evidenceCheck.necessity}
          </p>
          {risk.evidenceCheck.missingEvidence.length > 0 ? (
            <p>缺少证据：{risk.evidenceCheck.missingEvidence.join("、")}</p>
          ) : null}
        </details>
      </div>
      <div className="riskChat">
        <div className="chatHistory">
          {chat.history.length === 0 ? (
            <p className="mutedText">直接写你的回答，系统会沿着这个风险点继续追问。</p>
          ) : (
            chat.history.map((turn, index) => (
              <p key={`${turn.role}-${index}`} className={`chatTurn ${turn.role}`}>
                <strong>{turn.role === "user" ? "你" : "面试官"}</strong>
                {turn.content}
              </p>
            ))
          )}
        </div>
        <textarea
          value={chat.draft}
          onChange={(event) => onDraftChange(event.target.value)}
          placeholder="在这里回答这个风险点..."
        />
        <button type="button" onClick={onSend} disabled={chat.busy}>
          {chat.busy ? "追问中" : "提交回答"}
        </button>
      </div>
    </section>
  );
}

function EvidencePane(props: {
  risk?: RepoInterviewRisk;
  selectedEvidence: EvidenceRef | null;
  selectedDocument: EvidenceDocument | null;
  onSelectEvidence: (ref: EvidenceRef) => void;
}) {
  const { risk, selectedEvidence, selectedDocument, onSelectEvidence } = props;
  const displayEvidence = buildEvidenceDisplay(selectedEvidence, selectedDocument);

  return (
    <section className="evidenceColumn">
      <div className="evidenceToolbar">
        <div>
          <p className="eyebrow">Evidence Viewer</p>
          <h2>{selectedEvidence?.filePath ?? "等待证据"}</h2>
        </div>
        {selectedEvidence ? (
          <span>
            L{displayEvidence.startLine}-L{displayEvidence.endLine}
          </span>
        ) : null}
      </div>
      {risk ? (
        <div className="referenceRail">
          {risk.evidenceRefs.map((ref) => (
            <button
              key={evidenceKey(ref)}
              type="button"
              className={evidenceKey(ref) === evidenceKey(selectedEvidence) ? "active" : ""}
              onClick={() => onSelectEvidence(ref)}
            >
              {ref.filePath}:{ref.startLine}-{ref.endLine}
            </button>
          ))}
        </div>
      ) : null}
      <pre className="codeViewer">
        <code>{displayEvidence.code}</code>
      </pre>
      {selectedEvidence ? (
        <div className="evidenceReason">
          <strong>为什么引用这里</strong>
          <p>{selectedEvidence.reason}</p>
          {selectedEvidence.highlightTerms.length > 0 ? (
            <p>高亮词：{selectedEvidence.highlightTerms.join("、")}</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function AgentDashboard(props: {
  status: "idle" | "analyzing" | "ready" | "error";
  currentStage: PipelineStage | null;
  filesRead: number;
  findingsSeen: number;
  candidateQuestions: number;
  passedRisks: number;
  latestReadPath: string;
  progress: ProgressItem[];
}) {
  const activeIndex = props.currentStage ? AGENT_STEPS.findIndex((step) => step.stage === props.currentStage) : -1;
  const currentStep = activeIndex >= 0 ? AGENT_STEPS[activeIndex] : AGENT_STEPS[0];
  return (
    <section className={`agentDashboard status-${props.status}`} aria-label="agent pipeline dashboard">
      <div className="agentDashTop">
        <div>
          <p className="eyebrow">Agent Pipeline</p>
          <h2>{currentStep.title}</h2>
          <p>{currentStep.description}</p>
        </div>
        <div className="agentMetrics">
          <div>
            <strong>{props.filesRead}</strong>
            <span>证据文件</span>
          </div>
          <div>
            <strong>{props.findingsSeen}</strong>
            <span>风险线索</span>
          </div>
          <div>
            <strong>{props.candidateQuestions}</strong>
            <span>候选问题</span>
          </div>
          <div>
            <strong>{props.passedRisks}</strong>
            <span>通过审核</span>
          </div>
        </div>
      </div>
      <div className="agentStepRail">
        {AGENT_STEPS.map((step, index) => {
          const state = index < activeIndex || props.status === "ready" ? "done" : index === activeIndex ? "active" : "pending";
          return (
            <div key={step.stage} className={`agentStep ${state}`}>
              <span>{index + 1}</span>
              <strong>{step.short}</strong>
              <small>{step.agent}</small>
            </div>
          );
        })}
      </div>
      <div className="agentDashBottom">
        <div>
          <strong>最近读取</strong>
          <span>{props.latestReadPath || "等待文件读取"}</span>
        </div>
        <div className="agentEventLog">
          {props.progress.slice(-5).map((item) => (
            <p key={item.id}>{item.text}</p>
          ))}
        </div>
      </div>
    </section>
  );
}

function buildEvidenceDisplay(ref: EvidenceRef | null, document: EvidenceDocument | null) {
  const fallback = "选择左侧风险点后，这里会显示对应 evidence snippet。";
  if (!ref) return { code: document?.content ?? fallback, startLine: 1, endLine: 1 };
  const documentLines = document?.content.split(/\r?\n/) ?? [];
  if (!document || documentLines.length < ref.endLine) {
    return { code: ref.snippet, startLine: ref.startLine, endLine: ref.endLine };
  }

  const minEndLine = ref.startLine + 39;
  const endLine = Math.min(documentLines.length, Math.max(ref.endLine, minEndLine));
  const code = documentLines
    .slice(ref.startLine - 1, endLine)
    .map((line, offset) => `${String(ref.startLine + offset).padStart(4, " ")} | ${line}`)
    .join("\n");
  return { code, startLine: ref.startLine, endLine };
}

function MetaBlock({ label, items }: { label: string; items: string[] }) {
  const clean = items.filter(Boolean);
  if (clean.length === 0) return null;
  return (
    <details className="metaBlock">
      <summary>
        <span>{label}</span>
        <small>{clean.length} 条</small>
      </summary>
      {clean.map((item) => (
        <p key={item}>{item}</p>
      ))}
    </details>
  );
}

function safeLoad(): AnalyzeResponse | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AnalyzeResponse;
    return Array.isArray(parsed.risks) ? parsed : null;
  } catch {
    return null;
  }
}

function findEvidenceDocument(documents: EvidenceDocument[], ref: EvidenceRef): EvidenceDocument | null {
  return documents.find((document) => document.filePath === ref.filePath) ?? null;
}

function evidenceKey(ref?: EvidenceRef | null): string {
  return ref ? `${ref.filePath}:${ref.startLine}-${ref.endLine}` : "";
}

function stageLabel(stage: string): string {
  const labels: Record<string, string> = {
    scout: "读取仓库证据",
    plan: "规划审查路径",
    research: "深读关键文件",
    synthesize: "合成仓库理解",
    questions: "生成风险点并准备 Evidence Check",
    evidence_check: "审核证据充分性与必要性",
    interview_ready: "审查完成"
  };
  return labels[stage] ?? stage;
}

const AGENT_STEPS: Array<{
  stage: PipelineStage;
  short: string;
  title: string;
  agent: string;
  description: string;
}> = [
  {
    stage: "scout",
    short: "Scout",
    title: "Scout Agent 正在抓取仓库证据",
    agent: "Repo Scout",
    description: "读取仓库元数据、README、文件树和关键源码文件。"
  },
  {
    stage: "plan",
    short: "Plan",
    title: "Planner Agent 正在规划研究维度",
    agent: "Research Planner",
    description: "决定要深读哪些模块、训练/评测/数据/配置路径。"
  },
  {
    stage: "research",
    short: "Research",
    title: "Research Agents 正在并行深读代码",
    agent: "Repo Deep Research",
    description: "抽取可验证的代码事实、claim-code link 和候选风险线索。"
  },
  {
    stage: "synthesize",
    short: "Synthesize",
    title: "Synthesis Agent 正在合成仓库理解",
    agent: "Understanding Synthesizer",
    description: "把多维度 digest 合成项目地图、方法路径和评估逻辑。"
  },
  {
    stage: "questions",
    short: "Risk Gen",
    title: "Risk Agent 正在生成会被问穿的问题",
    agent: "Repo Interview Risk Agent",
    description: "只围绕内部实现、控制流、数据流和边界条件生成候选问题。"
  },
  {
    stage: "evidence_check",
    short: "Evidence",
    title: "Evidence Check Agent 正在审核 reference",
    agent: "Evidence Check",
    description: "检查每个问题的证据是否充分且必要，不通过则丢弃。"
  },
  {
    stage: "interview_ready",
    short: "Result",
    title: "风险审查结果已生成",
    agent: "Risk Viewer",
    description: "展示通过审核的问题和右侧代码证据。"
  }
];

function riskLevelLabel(level: RepoInterviewRisk["riskLevel"]): string {
  if (level === "high") return "高风险";
  if (level === "medium") return "中风险";
  return "低风险";
}
