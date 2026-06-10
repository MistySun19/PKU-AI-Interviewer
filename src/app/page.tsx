"use client";

import { useState } from "react";
import type { AnalyzeResponse } from "@/lib/types";

type Status = "idle" | "loading" | "done" | "error";

export default function Home() {
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  async function submit() {
    if (!repositoryUrl.trim()) return;
    setStatus("loading");
    setError("");
    setResult(null);
    setCopied(false);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repositoryUrl: repositoryUrl.trim() })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "分析失败。");
      setResult(data as AnalyzeResponse);
      setStatus("done");
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
              if (event.key === "Enter") void submit();
            }}
            placeholder="https://github.com/owner/repo"
          />
          <button disabled={status === "loading" || !repositoryUrl.trim()} onClick={() => void submit()}>
            {status === "loading" ? "分析中" : "生成报告"}
          </button>
        </div>

        {status === "loading" && (
          <div className="progress" aria-live="polite">
            <span />
            正在读取仓库、筛选关键文件并生成项目考核问题。
          </div>
        )}

        {status === "error" && <div className="error">{error}</div>}

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
