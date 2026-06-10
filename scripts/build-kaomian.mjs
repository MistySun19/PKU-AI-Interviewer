// 拉取 smile-struggler/kaomian 题库 Markdown，解析为 data/kaomian/kaomian.json 快照（ADR-0002）。
// 用法：node scripts/build-kaomian.mjs
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const REPO = "smile-struggler/kaomian";
const OUT_DIR = join(process.cwd(), "data", "kaomian");
const OUT_FILE = join(OUT_DIR, "kaomian.json");

function loadEnvToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  const envPath = join(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return undefined;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const match = line.match(/^GITHUB_TOKEN=(.*)$/);
    if (match) return match[1].trim();
  }
  return undefined;
}

const token = loadEnvToken();
const baseHeaders = { "User-Agent": "PKU-AI-Interviewer" };
if (token) baseHeaders.Authorization = `Bearer ${token}`;

async function githubJson(url) {
  const response = await fetch(url, { headers: { ...baseHeaders, Accept: "application/vnd.github+json" } });
  if (!response.ok) throw new Error(`GitHub 请求失败 ${response.status}: ${url}`);
  return response.json();
}

async function githubRaw(path, ref) {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  const response = await fetch(`https://api.github.com/repos/${REPO}/contents/${encoded}?ref=${ref}`, {
    headers: { ...baseHeaders, Accept: "application/vnd.github.raw" }
  });
  if (!response.ok) throw new Error(`读取失败 ${response.status}: ${path}`);
  return response.text();
}

const categoryByFile = {
  "题库/02_知识问答题.md": "knowledge_qa",
  "题库/03_Agent_RAG_Tool_Memory.md": "agent_rag_tool_memory",
  "题库/04_LeetCode_算法手撕.md": "leetcode",
  "题库/05_机器学习_大模型手撕.md": "ml_llm_coding",
  "题库/06_项目拷打题.md": "project_deep_dive"
};

function parseQuestions(markdown, sourceFile) {
  const items = [];
  const defaultCategory = categoryByFile[sourceFile] ?? "unknown";
  // Top100 用 "## N. 题目"，分类文件用 "### N. 题目"（外层是 "## 出现 N 帖" 分组）
  const headings = [...markdown.matchAll(/^#{2,3}\s+(\d+)\.\s+(.+)$/gm)];
  for (let i = 0; i < headings.length; i++) {
    const question = headings[i][2].trim();
    if (!question) continue;
    const start = (headings[i].index ?? 0) + headings[i][0].length;
    const end = i + 1 < headings.length ? headings[i + 1].index : markdown.length;
    const body = markdown.slice(start, end);

    const frequency = Number(body.match(/出现帖子数：`?(\d+)`?/)?.[1] ?? 1);
    const category = body.match(/题型：`?([\w-]+)`?/)?.[1] ?? defaultCategory;
    const companies = (body.match(/公司：(.+)/)?.[1] ?? "")
      .split(/[、，,]/)
      .map((item) => item.trim())
      .filter(Boolean);

    items.push({ question, category, frequency, companies, sourceFile });
  }
  return items;
}

const repoInfo = await githubJson(`https://api.github.com/repos/${REPO}`);
const branch = repoInfo.default_branch;
const tree = await githubJson(`https://api.github.com/repos/${REPO}/git/trees/${branch}?recursive=1`);
const bankFiles = tree.tree
  .filter((item) => item.type === "blob" && /^题库\/\d+_.+\.md$/.test(item.path) && !item.path.startsWith("题库/00_"))
  .map((item) => item.path)
  .sort();

console.log(`题库文件 ${bankFiles.length} 个：\n${bankFiles.join("\n")}`);

const all = [];
for (const path of bankFiles) {
  const markdown = await githubRaw(path, branch);
  const items = parseQuestions(markdown, path);
  console.log(`${path} -> ${items.length} 题`);
  all.push(...items);
}

// Top100 是分类文件的高频子集视图，按题面去重并保留最高频次
const byQuestion = new Map();
for (const item of all) {
  const key = item.question.replace(/\s+/g, "").toLowerCase();
  const existing = byQuestion.get(key);
  if (!existing || item.frequency > existing.frequency) {
    byQuestion.set(key, { ...item, companies: [...new Set([...(existing?.companies ?? []), ...item.companies])] });
  } else {
    existing.companies = [...new Set([...existing.companies, ...item.companies])];
  }
}

const deduped = [...byQuestion.values()]
  .sort((a, b) => b.frequency - a.frequency || a.question.localeCompare(b.question))
  .map((item, index) => ({ id: `k${String(index + 1).padStart(3, "0")}`, ...item }));

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(
  OUT_FILE,
  `${JSON.stringify({ sourceRepo: REPO, branch, count: deduped.length, items: deduped }, null, 2)}\n`,
  "utf8"
);
console.log(`已写入 ${OUT_FILE}：去重后 ${deduped.length} 题（原始 ${all.length} 条）`);
