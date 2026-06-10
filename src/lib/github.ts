import { z } from "zod";
import type {
  EvidenceFile,
  PaperSignals,
  RepoContext,
  RepoFileContent,
  RepoInfo,
  ResearchArtifactKind,
  ResearchArtifacts
} from "./types";

const MAX_FILES = 30;
const MAX_FILE_BYTES = 200_000;

const bucketCaps: Record<ResearchArtifactKind | "other", number> = {
  paperDocs: 5,
  methodFiles: 8,
  trainingFiles: 5,
  evaluationFiles: 6,
  configFiles: 6,
  dataFiles: 4,
  demoFiles: 3,
  scripts: 4,
  other: 3
};

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
  ".csv",
  ".css",
  ".go",
  ".html",
  ".ipynb",
  ".java",
  ".js",
  ".jsx",
  ".json",
  ".jsonl",
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
  ".tsv",
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

  const [owner, repoSegment, marker, ...rest] = url.pathname
    .split("/")
    .filter(Boolean);
  if (!owner || !repoSegment) {
    throw new Error("GitHub 链接需要包含 owner 和 repo。");
  }

  const repo = repoSegment.replace(/\.git$/, "");
  return {
    owner,
    repo,
    branch: marker === "tree" && rest.length > 0 ? rest.join("/") : undefined
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
  const category = classifyResearchArtifact(path);

  if (category !== "other") add(15, artifactReason(category));
  if (file.startsWith("readme")) add(120, "README/paper overview");
  if (/(paper|arxiv|citation|bibtex|project|supplement|method|algorithm)/i.test(lower)) add(55, "paper signal");
  if (/(^|\/)(train|pretrain|finetune|main|launch|run|scripts?\/.*train).*\.(ts|tsx|js|jsx|py|sh)$/i.test(path)) {
    add(100, "training entry");
  }
  if (/(^|\/)(infer|inference|demo|sample|generate|predict).*\.(ts|tsx|js|jsx|py|sh)$/i.test(path)) {
    add(82, "inference/demo entry");
  }
  if (/(eval|evaluate|benchmark|metric|ablation|reproduce|results?)/i.test(path)) add(78, "evaluation/reproduce");
  if (/(configs?|hydra|yaml|yml|toml|json|requirements|environment|pyproject)/i.test(path)) {
    add(62, "config/hyperparameter");
  }
  if (/(models?|modules?|loss|criterion|algorithms?|methods?|diffusion|transformer|attention|agent|rlhf|ppo|dpo|sft|rag|retriev|encoder|decoder)/i.test(path)) {
    add(76, "method implementation");
  }
  if (/(datasets?|dataloader|data_loader|preprocess|tokeniz|collat|sampler)/i.test(path)) add(70, "data pipeline");
  if (/(^|\/)(test|spec|ci|deploy|docker|compose|server|api|web|ui)/i.test(path)) add(-16, "software-engineering lower priority");
  if (/\.(csv|tsv|jsonl)$/i.test(path) && /(label|labels|data|annotations?|benchmark|test)/i.test(path)) {
    add(-45, "data blob cap");
  }
  if (size > MAX_FILE_BYTES) add(-30, "large file");
  if (path.split("/").length > 6) add(-12, "deep path");

  return { score, reason: reasons.join(", ") || "source file" };

  function add(points: number, reason: string) {
    score += points;
    reasons.push(reason);
  }
}

export function selectCandidateFiles(files: Array<{ path: string; size?: number }>): EvidenceFile[] {
  const ranked = files
    .filter((file) => !shouldExcludePath(file.path, file.size ?? 0))
    .map((file) => {
      const { score, reason } = scoreFilePath(file.path, file.size ?? 0);
      const category = classifyResearchArtifact(file.path);
      return {
        path: file.path,
        size: file.size ?? 0,
        score,
        category,
        reason,
        truncated: false
      };
    })
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));

  const selected: EvidenceFile[] = [];
  const counts = new Map<ResearchArtifactKind | "other", number>();
  for (const file of ranked) {
    const used = counts.get(file.category) ?? 0;
    if (used >= bucketCaps[file.category]) continue;
    selected.push(file);
    counts.set(file.category, used + 1);
    if (selected.length >= MAX_FILES) break;
  }
  return selected;
}

export type FetchRepoContextOptions = {
  onFileFetched?: (path: string) => void;
};

export async function fetchRepoContext(
  repositoryUrl: string,
  options: FetchRepoContextOptions = {}
): Promise<RepoContext> {
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
  if (!process.env.GITHUB_TOKEN) {
    warnings.push("未配置 GITHUB_TOKEN，GitHub REST API 未认证限制较低，建议配置 token 提升到常规 5000 次/小时。");
  }
  if (tree.truncated) warnings.push("GitHub tree API 返回已截断，可能遗漏部分文件。");
  if (!candidates.some((file) => file.path.toLowerCase().includes("readme"))) {
    warnings.push("未读取到 README，报告会更多依赖代码结构。");
  }
  if (!candidates.some((file) => /(test|spec|eval|benchmark|metric)/i.test(file.path))) {
    warnings.push("未发现明显测试或评测文件，面试官可能追问评测可信度。");
  }

  const files = await fetchSelectedFiles(parsed.owner, parsed.repo, branch, candidates, headers, warnings, options.onFileFetched);
  if (files.length === 0 && candidates.length > 0) {
    throw new Error("无法读取任何仓库文件（GitHub raw 与 contents API 均失败），请检查网络后重试。");
  }
  const readme = files.find((file) => file.path.toLowerCase().includes("readme"))?.content ?? "";
  const researchArtifacts = collectResearchArtifacts(candidates);
  const paperSignals = emptyPaperSignals();
  const analysisMode = "unknown";
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

  const treeFiles = blobFiles.map((item) => ({ path: item.path, size: item.size ?? 0 }));

  return { repo, readme, files, treeFiles, analysisMode, paperSignals, researchArtifacts, warnings };
}

export async function fetchSingleFile(
  owner: string,
  repo: string,
  branch: string,
  path: string
): Promise<{ content: string; truncated: boolean } | null> {
  let content: string | null;
  try {
    content = await fetchRawWithFallback(owner, repo, branch, path, githubHeaders());
  } catch {
    return null;
  }
  if (content === null) return null;
  let truncated = false;
  if (content.length > MAX_FILE_BYTES) {
    content = `${content.slice(0, MAX_FILE_BYTES)}\n... (truncated by alpha limit)`;
    truncated = true;
  }
  return { content, truncated };
}

const RAW_FETCH_CONCURRENCY = 5;

const ownerRepoPattern = /^[A-Za-z0-9_.-]+$/;

function encodePathSegments(path: string): string {
  const segments = path.split("/").map((segment) => {
    if (segment === "" || segment === "." || segment === ".." || segment.includes("\\")) {
      throw new Error(`非法的文件路径：${path}`);
    }
    return encodeURIComponent(segment);
  });
  return segments.join("/");
}

export function buildRawUrl(owner: string, repo: string, branch: string, path: string): string {
  if (!ownerRepoPattern.test(owner) || !ownerRepoPattern.test(repo)) {
    throw new Error(`非法的 owner/repo：${owner}/${repo}`);
  }
  return `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${encodePathSegments(path)}`;
}

async function fetchRawWithFallback(
  owner: string,
  repo: string,
  branch: string,
  path: string,
  headers: HeadersInit
): Promise<string | null> {
  const rawUrl = buildRawUrl(owner, repo, branch, path);
  const contentsUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${encodePathSegments(path)}?ref=${encodeURIComponent(branch)}`;

  try {
    const response = await fetch(rawUrl, { headers, signal: AbortSignal.timeout(20_000) });
    if (response.ok) return await response.text();
  } catch {
    /* raw CDN 失败，回退 contents API */
  }
  try {
    const response = await fetch(contentsUrl, {
      headers: { ...(headers as Record<string, string>), Accept: "application/vnd.github.raw" },
      signal: AbortSignal.timeout(20_000)
    });
    if (response.ok) return await response.text();
  } catch {
    /* 两个通道都失败 */
  }
  return null;
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function fetchSelectedFiles(
  owner: string,
  repo: string,
  branch: string,
  candidates: EvidenceFile[],
  headers: HeadersInit,
  warnings: string[],
  onFileFetched?: (path: string) => void
): Promise<RepoFileContent[]> {
  const fetched = await mapWithConcurrency(candidates, RAW_FETCH_CONCURRENCY, async (candidate) => {
    let content: string | null;
    try {
      content = await fetchRawWithFallback(owner, repo, branch, candidate.path, headers);
    } catch {
      warnings.push(`跳过非法文件路径：${candidate.path}`);
      return null;
    }
    if (content === null) {
      warnings.push(`读取文件失败（raw 与 contents API 均不可用）：${candidate.path}`);
      return null;
    }
    let truncated = false;
    if (content.length > MAX_FILE_BYTES) {
      content = `${content.slice(0, MAX_FILE_BYTES)}\n... (truncated by alpha limit)`;
      truncated = true;
      warnings.push(`文件过大已截断：${candidate.path}`);
    }
    onFileFetched?.(candidate.path);
    return { ...candidate, content, truncated };
  });
  return fetched.filter((file): file is RepoFileContent => file !== null);
}

function getExtension(path: string): string {
  const last = path.split("/").at(-1) ?? path;
  const index = last.lastIndexOf(".");
  return index >= 0 ? last.slice(index) : "";
}

async function githubFetch<T>(url: string, headers: HeadersInit): Promise<T> {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    const rateLimit = response.headers.get("x-ratelimit-remaining") === "0";
    const reset = response.headers.get("x-ratelimit-reset");
    const resetHint = reset ? `，重置时间 Unix 秒：${reset}` : "";
    const hint = rateLimit
      ? `GitHub rate limit 已耗尽${resetHint}。请配置 GITHUB_TOKEN，认证请求通常可提升到 5000 次/小时。`
      : await response.text();
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

export function classifyResearchArtifact(path: string): ResearchArtifactKind | "other" {
  const lower = path.toLowerCase();
  const file = lower.split("/").at(-1) ?? lower;

  if (
    file.startsWith("readme") ||
    /(paper|arxiv|citation|bibtex|supplement|project_page|project-page)/i.test(lower) ||
    lower.startsWith("docs/")
  ) {
    return "paperDocs";
  }
  if (/(configs?|conf|hydra|\.yaml$|\.yml$|\.toml$|requirements|environment|pyproject|setup\.py)/i.test(lower)) {
    return "configFiles";
  }
  if (/(^|\/)(train|pretrain|finetune|main|launch|run|scripts?\/.*train).*\.(py|sh|ts|tsx|js|jsx)$/i.test(path)) {
    return "trainingFiles";
  }
  if (/(eval|evaluate|benchmark|metric|ablation|reproduce|results?|tests?)/i.test(lower)) {
    return "evaluationFiles";
  }
  if (/(datasets?|dataloader|data_loader|preprocess|tokeniz|collat|sampler|labels?|annotations?)/i.test(lower)) {
    return "dataFiles";
  }
  if (/(infer|inference|demo|sample|generate|predict|gradio|streamlit|app\.py)/i.test(lower)) {
    return "demoFiles";
  }
  if (/(^|\/)(scripts?|slurm|jobs?|notebooks?)\//i.test(lower) || /\.(ipynb|sh)$/i.test(lower)) {
    return "scripts";
  }
  if (
    /(models?|modules?|loss|criterion|algorithms?|methods?|diffusion|transformer|attention|agent|rlhf|ppo|dpo|sft|rag|retriev|encoder|decoder|policy|reward|trainer|solver)/i.test(
      lower
    )
  ) {
    return "methodFiles";
  }
  return "other";
}

export function collectResearchArtifacts(files: Array<{ path: string; category?: ResearchArtifactKind | "other" }>): ResearchArtifacts {
  const artifacts = emptyResearchArtifacts();
  for (const file of files) {
    const category = file.category ?? classifyResearchArtifact(file.path);
    if (category === "other") continue;
    artifacts[category].push(file.path);
  }
  return artifacts;
}

function emptyResearchArtifacts(): ResearchArtifacts {
  return {
    paperDocs: [],
    methodFiles: [],
    trainingFiles: [],
    evaluationFiles: [],
    configFiles: [],
    dataFiles: [],
    demoFiles: [],
    scripts: []
  };
}

function emptyPaperSignals(): PaperSignals {
  return {
    venues: [],
    paperLinks: [],
    citationFound: false,
    officialImplementation: false,
    benchmarkSignals: [],
    trainingSignals: [],
    evaluationSignals: [],
    methodSignals: []
  };
}

function artifactReason(category: ResearchArtifactKind | "other"): string {
  switch (category) {
    case "paperDocs":
      return "paper/README evidence";
    case "methodFiles":
      return "method implementation";
    case "trainingFiles":
      return "training entry";
    case "evaluationFiles":
      return "evaluation/benchmark";
    case "configFiles":
      return "config/hyperparameter";
    case "dataFiles":
      return "data pipeline";
    case "demoFiles":
      return "inference/demo";
    case "scripts":
      return "script/reproduce";
    default:
      return "source file";
  }
}
