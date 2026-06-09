import { z } from "zod";
import type { EvidenceFile, RepoContext, RepoFileContent, RepoInfo } from "./types";

const MAX_FILES = 30;
const MAX_FILE_BYTES = 200_000;
const MAX_CONTEXT_CHARS = 180_000;

const excludedDirs = new Set([
  ".git",
  ".next",
  "__pycache__",
  "bin",
  "build",
  "coverage",
  "dist",
  "env",
  "node_modules",
  "obj",
  "out",
  "target",
  "venv",
  ".venv"
]);

const excludedFiles = new Set([
  ".ds_store",
  ".env",
  ".env.local",
  "id_ed25519",
  "id_rsa",
  "package-lock.json",
  "pnpm-lock.yaml",
  "poetry.lock",
  "yarn.lock"
]);

const excludedExtensions = new Set([
  ".7z",
  ".avif",
  ".bmp",
  ".dll",
  ".eot",
  ".exe",
  ".gif",
  ".gz",
  ".ico",
  ".jpeg",
  ".jpg",
  ".lock",
  ".mp3",
  ".mp4",
  ".pdf",
  ".png",
  ".so",
  ".svg",
  ".tar",
  ".ttf",
  ".webp",
  ".woff",
  ".woff2",
  ".zip"
]);

const sourceExtensions = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".cs",
  ".css",
  ".go",
  ".html",
  ".ipynb",
  ".java",
  ".js",
  ".jsx",
  ".json",
  ".md",
  ".mjs",
  ".py",
  ".rb",
  ".rs",
  ".sh",
  ".sql",
  ".toml",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml"
]);

const githubUrlSchema = z.string().url();

export type ParsedGitHubUrl = {
  owner: string;
  repo: string;
  branch?: string;
};

type GitHubTreeItem = {
  path: string;
  mode: string;
  type: "blob" | "tree";
  sha: string;
  size?: number;
  url: string;
};

type GitHubRepoApi = {
  name: string;
  full_name: string;
  default_branch: string;
  html_url: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
};

type GitHubTreeApi = {
  truncated: boolean;
  tree: GitHubTreeItem[];
};

export function parseGitHubUrl(input: string): ParsedGitHubUrl {
  const value = githubUrlSchema.parse(input.trim());
  const url = new URL(value);
  if (url.hostname !== "github.com" && url.hostname !== "www.github.com") {
    throw new Error("请输入 github.com 仓库链接。");
  }

  const [owner, repoSegment, marker, branch] = url.pathname
    .split("/")
    .filter(Boolean);
  if (!owner || !repoSegment) {
    throw new Error("GitHub 链接需要包含 owner 和 repo。");
  }

  const repo = repoSegment.replace(/\.git$/, "");
  return {
    owner,
    repo,
    branch: marker === "tree" && branch ? branch : undefined
  };
}

export function shouldExcludePath(path: string, size = 0): boolean {
  const normalized = path.toLowerCase();
  const parts = normalized.split("/");
  if (parts.some((part) => excludedDirs.has(part))) return true;
  if (excludedFiles.has(parts.at(-1) ?? "")) return true;
  if (/(^|\/)(secrets?|credentials?)\./i.test(path)) return true;
  if (/\.(pem|key|p12|pfx)$/i.test(path)) return true;
  const ext = getExtension(normalized);
  if (excludedExtensions.has(ext)) return true;
  if (ext && !sourceExtensions.has(ext)) return true;
  return size > MAX_FILE_BYTES * 4;
}

export function scoreFilePath(path: string, size = 0): { score: number; reason: string } {
  const lower = path.toLowerCase();
  const file = lower.split("/").at(-1) ?? lower;
  let score = 0;
  const reasons: string[] = [];

  if (file.startsWith("readme")) add(100, "README");
  if (lower.startsWith("docs/") || lower.includes("/docs/")) add(70, "docs");
  if (lower.startsWith("examples/") || lower.includes("/examples/")) add(64, "examples");
  if (/(^|\/)(main|index|app|server|cli|train|infer|evaluate|eval|benchmark)\.(ts|tsx|js|jsx|py|go|rs)$/i.test(path)) {
    add(80, "entrypoint");
  }
  if (/(src|lib|backend|server|app|core|models?|agents?|rag|retriev|train|eval|benchmark|tests?)/i.test(path)) {
    add(45, "core path");
  }
  if (/(package\.json|pyproject\.toml|requirements\.txt|dockerfile|compose|next\.config|vite\.config|tsconfig)/i.test(path)) {
    add(55, "config");
  }
  if (/(test|spec|eval|benchmark|metric)/i.test(path)) add(45, "test/eval");
  if (size > MAX_FILE_BYTES) add(-30, "large file");
  if (path.split("/").length > 6) add(-12, "deep path");

  return { score, reason: reasons.join(", ") || "source file" };

  function add(points: number, reason: string) {
    score += points;
    reasons.push(reason);
  }
}

export function selectCandidateFiles(files: Array<{ path: string; size?: number }>): EvidenceFile[] {
  return files
    .filter((file) => !shouldExcludePath(file.path, file.size ?? 0))
    .map((file) => {
      const { score, reason } = scoreFilePath(file.path, file.size ?? 0);
      return {
        path: file.path,
        size: file.size ?? 0,
        score,
        reason,
        truncated: false
      };
    })
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, MAX_FILES);
}

export async function fetchRepoContext(repositoryUrl: string): Promise<RepoContext> {
  const parsed = parseGitHubUrl(repositoryUrl);
  const headers = githubHeaders();
  const repoApi = await githubFetch<GitHubRepoApi>(
    `https://api.github.com/repos/${parsed.owner}/${parsed.repo}`,
    headers
  );

  const branch = parsed.branch ?? repoApi.default_branch;
  const tree = await githubFetch<GitHubTreeApi>(
    `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    headers
  );

  const blobFiles = tree.tree.filter((item) => item.type === "blob");
  const candidates = selectCandidateFiles(blobFiles);
  const warnings: string[] = [];
  if (tree.truncated) warnings.push("GitHub tree API 返回已截断，可能遗漏部分文件。");
  if (!candidates.some((file) => file.path.toLowerCase().includes("readme"))) {
    warnings.push("未读取到 README，报告会更多依赖代码结构。");
  }
  if (!candidates.some((file) => /(test|spec|eval|benchmark|metric)/i.test(file.path))) {
    warnings.push("未发现明显测试或评测文件，面试官可能追问评测可信度。");
  }

  const files = await fetchSelectedFiles(parsed.owner, parsed.repo, branch, candidates, headers, warnings);
  const readme = files.find((file) => file.path.toLowerCase().includes("readme"))?.content ?? "";
  const repo: RepoInfo = {
    owner: parsed.owner,
    name: repoApi.name,
    fullName: repoApi.full_name,
    defaultBranch: branch,
    htmlUrl: repoApi.html_url,
    description: repoApi.description,
    language: repoApi.language,
    stars: repoApi.stargazers_count,
    fileCount: blobFiles.length
  };

  return { repo, readme, files, warnings };
}

export function buildCodeContext(files: RepoFileContent[]): { context: string; warnings: string[] } {
  const warnings: string[] = [];
  let total = 0;
  const blocks: string[] = [];

  for (const file of files) {
    const header = `\n--- File: ${file.path} | reason: ${file.reason} ---\n`;
    const next = header + file.content;
    if (total + next.length > MAX_CONTEXT_CHARS) {
      warnings.push("仓库上下文超过 alpha 限制，后续文件未送入模型。");
      break;
    }
    total += next.length;
    blocks.push(next);
  }

  return { context: blocks.join("\n"), warnings };
}

async function fetchSelectedFiles(
  owner: string,
  repo: string,
  branch: string,
  candidates: EvidenceFile[],
  headers: HeadersInit,
  warnings: string[]
): Promise<RepoFileContent[]> {
  const files: RepoFileContent[] = [];
  for (const candidate of candidates) {
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${candidate.path}`;
    const response = await fetch(rawUrl, { headers });
    if (!response.ok) {
      warnings.push(`读取文件失败：${candidate.path} (${response.status})`);
      continue;
    }
    let content = await response.text();
    let truncated = false;
    if (content.length > MAX_FILE_BYTES) {
      content = `${content.slice(0, MAX_FILE_BYTES)}\n... (truncated by alpha limit)`;
      truncated = true;
      warnings.push(`文件过大已截断：${candidate.path}`);
    }
    files.push({ ...candidate, content, truncated });
  }
  return files;
}

async function githubFetch<T>(url: string, headers: HeadersInit): Promise<T> {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    const rateLimit = response.headers.get("x-ratelimit-remaining") === "0";
    const hint = rateLimit ? "GitHub rate limit 已耗尽，请配置 GITHUB_TOKEN。" : await response.text();
    throw new Error(`GitHub 请求失败 (${response.status}): ${hint}`);
  }
  return (await response.json()) as T;
}

function githubHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "PKU-AI-Interviewer"
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
}

function getExtension(path: string): string {
  const last = path.split("/").at(-1) ?? path;
  const index = last.lastIndexOf(".");
  return index >= 0 ? last.slice(index) : "";
}
