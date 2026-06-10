import type { RepoContext } from "./types";

export const SKELETON_THRESHOLD_CHARS = 24_000;

const jsLikeExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

function getExtension(path: string): string {
  const last = path.split("/").at(-1) ?? path;
  const index = last.lastIndexOf(".");
  return index >= 0 ? last.slice(index).toLowerCase() : "";
}

export function extractImports(path: string, content: string): string[] {
  const ext = getExtension(path);
  const specs: string[] = [];
  if (ext === ".py") {
    for (const match of content.matchAll(/^\s*from\s+([\w.]+)\s+import\b/gm)) specs.push(match[1]);
    for (const match of content.matchAll(/^\s*import\s+([\w.]+(?:\s*,\s*[\w.]+)*)/gm)) {
      for (const part of match[1].split(",")) specs.push(part.trim());
    }
  } else if (jsLikeExtensions.has(ext)) {
    for (const match of content.matchAll(/from\s+["']([^"']+)["']/g)) specs.push(match[1]);
    for (const match of content.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)) specs.push(match[1]);
  }
  return specs;
}

export function computeCentrality(files: Array<{ path: string; content: string }>): Map<string, number> {
  const byModuleName = new Map<string, string[]>();
  for (const file of files) {
    const base = (file.path.split("/").at(-1) ?? "").replace(/\.[^.]+$/, "").toLowerCase();
    if (!base) continue;
    const list = byModuleName.get(base) ?? [];
    list.push(file.path);
    byModuleName.set(base, list);
  }

  const centrality = new Map<string, number>(files.map((file) => [file.path, 0]));
  for (const file of files) {
    const credited = new Set<string>();
    for (const spec of extractImports(file.path, file.content)) {
      const last = spec.split(/[./]/).filter(Boolean).at(-1)?.toLowerCase();
      if (!last) continue;
      for (const target of byModuleName.get(last) ?? []) {
        if (target === file.path || credited.has(target)) continue;
        credited.add(target);
        centrality.set(target, (centrality.get(target) ?? 0) + 1);
      }
    }
  }
  return centrality;
}

export function skeletonizeFile(
  path: string,
  content: string,
  threshold = SKELETON_THRESHOLD_CHARS
): { content: string; skeletonized: boolean } {
  if (content.length <= threshold) return { content, skeletonized: false };

  const ext = getExtension(path);
  const lines = content.split("\n");
  const kept: string[] = [];

  if (ext === ".py") {
    let docstringLines = 0;
    for (const line of lines) {
      const trimmed = line.trim();
      if (docstringLines > 0) {
        kept.push(line);
        docstringLines = /"""|'''/.test(trimmed) || docstringLines >= 6 ? 0 : docstringLines + 1;
        continue;
      }
      if (
        /^(import|from)\s/.test(trimmed) ||
        /^@\w/.test(trimmed) ||
        /^(async\s+def|def|class)\s/.test(trimmed) ||
        /^[A-Z_][A-Z0-9_]*\s*=/.test(trimmed)
      ) {
        kept.push(line);
        continue;
      }
      if (/^("""|''')/.test(trimmed)) {
        kept.push(line);
        docstringLines = /^("""|''').+("""|''')\s*$/.test(trimmed) ? 0 : 1;
      }
    }
  } else if (jsLikeExtensions.has(ext)) {
    for (const line of lines) {
      const trimmed = line.trim();
      if (
        /^(import|export)\b/.test(trimmed) ||
        /^(export\s+)?(default\s+)?(abstract\s+)?(async\s+)?(function|class)\b/.test(trimmed) ||
        /^(export\s+)?(const|let|var)\s+\w+\s*(:|=)/.test(trimmed) ||
        /^(public|private|protected|static|readonly)\b/.test(trimmed) ||
        /require\(/.test(trimmed)
      ) {
        kept.push(line);
      }
    }
  } else {
    kept.push(...lines.slice(0, 220), "...", ...lines.slice(-40));
  }

  let result = kept.join("\n");
  if (result.length === 0) result = content.slice(0, threshold);
  if (result.length > threshold) result = result.slice(0, threshold);
  return {
    content: `(文件过大，已骨架化：仅保留 import、签名、docstring 和常量行)\n${result}`,
    skeletonized: true
  };
}

export function buildTreeSummary(paths: string[], maxLines = 60): string {
  const dirCount = new Map<string, number>();
  for (const path of paths) {
    const parts = path.split("/");
    const dir = parts.length > 1 ? parts.slice(0, Math.min(2, parts.length - 1)).join("/") : ".";
    dirCount.set(dir, (dirCount.get(dir) ?? 0) + 1);
  }
  const sorted = [...dirCount.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const lines = sorted.slice(0, maxLines).map(([dir, count]) => `${dir} (${count} 个文件)`);
  if (sorted.length > maxLines) lines.push(`... 其余 ${sorted.length - maxLines} 个目录省略`);
  return lines.join("\n");
}

export function buildRepoMapText(context: RepoContext, centrality: Map<string, number>): string {
  const ranked = [...context.files].sort(
    (a, b) =>
      (centrality.get(b.path) ?? 0) - (centrality.get(a.path) ?? 0) ||
      b.score - a.score ||
      a.path.localeCompare(b.path)
  );
  const fileLines = ranked.map((file) => {
    const refs = centrality.get(file.path) ?? 0;
    return `- ${file.path} [${file.category}] 被引用 ${refs} 次${file.truncated ? "（截断）" : ""} :: ${file.reason}`;
  });

  return [
    `仓库: ${context.repo.fullName}`,
    `描述: ${context.repo.description ?? "无"}`,
    `主语言: ${context.repo.language ?? "未知"} | stars: ${context.repo.stars} | 文件总数: ${context.repo.fileCount}`,
    "",
    "目录结构（按文件数排序）:",
    buildTreeSummary(context.treeFiles.map((file) => file.path)),
    "",
    "已读取的证据文件（按重要性排序）:",
    ...fileLines
  ].join("\n");
}
