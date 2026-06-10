import type {
  EvidenceCheck,
  EvidenceDocument,
  EvidenceRef,
  ExamPoint,
  InterviewQuestion,
  PaperCodeMapItem,
  RepoContext,
  RepoInterviewRisk,
  Understanding
} from "./types";

const MIN_TARGET_RISKS = 8;
const EVIDENCE_CONTEXT_LINES = 40;
const ANCHOR_SCORE_LINES = 5;
const MIN_EVIDENCE_LINES = 28;
const MAX_EVIDENCE_LINES = 80;
const MAX_DOCUMENT_CHARS = 90_000;

type RiskDraft = Omit<RepoInterviewRisk, "evidenceCheck"> & {
  evidenceCheck?: EvidenceCheck;
};

export type RepoInterviewAudit = {
  risks: RepoInterviewRisk[];
  evidenceBundle: EvidenceDocument[];
  warnings: string[];
};

type ParsedEvidencePath = {
  filePath: string;
  startLine?: number;
  endLine?: number;
};

export function buildRepoInterviewAudit(args: {
  context: RepoContext;
  understanding: Understanding;
  paperCodeMap: PaperCodeMapItem[];
  examPoints: ExamPoint[];
  questions: InterviewQuestion[];
}): RepoInterviewAudit {
  const drafts = buildRiskDrafts(args);
  const checked = runEvidenceCheck(drafts);
  const passed = sortRisks(checked.filter((risk) => risk.evidenceCheck.status === "pass"));
  const warnings: string[] = [];

  if (passed.length < MIN_TARGET_RISKS) {
    warnings.push(
      `Evidence Check 后仅保留 ${passed.length} 个证据充分的风险点；仓库证据不足时未强行编造到 ${MIN_TARGET_RISKS} 个。`
    );
  }

  return {
    risks: passed,
    evidenceBundle: buildEvidenceBundle(args.context, passed),
    warnings
  };
}

export function buildRiskDrafts(args: {
  context: RepoContext;
  understanding: Understanding;
  paperCodeMap: PaperCodeMapItem[];
  examPoints: ExamPoint[];
  questions: InterviewQuestion[];
}): RiskDraft[] {
  const contentByPath = new Map(args.context.files.map((file) => [file.path, file.content]));
  const fallbackClaim =
    args.understanding.paperClaims[0] || args.understanding.problemSetting || args.understanding.summary;

  return args.questions.map((question, index) => {
    const matchedPoint = findMatchingExamPoint(question, args.examPoints);
    const matchedClaim = findMatchingClaim(question, args.paperCodeMap) ?? fallbackClaim;
    const evidenceRefs = question.evidence
      .map((rawRef) =>
        resolveEvidenceRef(rawRef, contentByPath, {
          reason: question.whyAsk || matchedPoint?.whyAsk || "支撑该风险追问的仓库证据。",
          highlightTerms: buildHighlightTerms(question, matchedPoint, matchedClaim)
        })
      )
      .filter((ref): ref is EvidenceRef => ref !== null);

    const draft: RiskDraft = {
      id: `risk-${index + 1}`,
      riskLevel: matchedPoint?.riskLevel ?? difficultyToRiskLevel(question.difficulty),
      title: matchedPoint?.title || buildRiskTitle(question.question, index),
      interviewerQuestion: question.question,
      claim: matchedClaim,
      whyThisMatters: question.whyAsk || matchedPoint?.whyAsk || "这个问题会暴露候选人是否真正理解项目细节。",
      evidenceRefs,
      knowledgeGaps: dedupeStrings([
        ...question.expectedAnswer.slice(0, 4),
        ...question.followUps.slice(0, 2)
      ]),
      referenceAnswer: buildReferenceAnswer(question),
      redFlags: question.redFlags,
      fixSuggestions: dedupeStrings([question.hint ?? "", ...question.followUps]).slice(0, 5),
      followUpSeeds: question.followUps,
      source: question.source === "kaomian" ? "interview_story" : "repo"
    };
    return reviseRiskAgainstEvidence(draft);
  });
}

export function resolveEvidenceRef(
  rawPath: string,
  contentByPath: Map<string, string>,
  options: { reason: string; highlightTerms: string[] }
): EvidenceRef | null {
  const parsed = parseEvidencePath(rawPath);
  const content = contentByPath.get(parsed.filePath);
  if (!content) return null;

  const lines = content.split(/\r?\n/);
  const requestedStart = chooseEvidenceStartLine(lines, parsed.startLine, options.highlightTerms);
  const startLine = clamp(requestedStart, 1, Math.max(1, lines.length));
  const requestedEnd = parsed.endLine ?? startLine + EVIDENCE_CONTEXT_LINES - 1;
  const expandedEnd = expandEvidenceEndLine(lines, startLine, requestedEnd);
  const endLine = clamp(expandedEnd, startLine, Math.max(startLine, lines.length));
  const snippet = lines
    .slice(startLine - 1, endLine)
    .map((line, offset) => `${String(startLine + offset).padStart(4, " ")} | ${line}`)
    .join("\n");

  return {
    filePath: parsed.filePath,
    startLine,
    endLine,
    snippet,
    reason: options.reason,
    highlightTerms: options.highlightTerms
  };
}

function chooseEvidenceStartLine(lines: string[], requestedStart: number | undefined, terms: string[]): number {
  const mutualBranchStart = findMutualBranchStart(lines, requestedStart, terms);
  if (mutualBranchStart) return mutualBranchStart;
  if (!requestedStart) return inferEvidenceStartLine(lines, terms);
  const currentScore = scoreEvidenceWindow(lines, requestedStart, terms, ANCHOR_SCORE_LINES);
  const bestStart = inferEvidenceStartLine(lines, terms);
  const bestScore = scoreEvidenceWindow(lines, bestStart, terms, ANCHOR_SCORE_LINES);
  if (isImportOnlyWindow(lines, requestedStart) && bestScore > 0) return bestStart;
  if (bestScore >= currentScore + 2) return bestStart;
  return requestedStart;
}

function findMutualBranchStart(lines: string[], requestedStart: number | undefined, terms: string[]): number | undefined {
  const termText = terms.join(" ").toLowerCase();
  const needsDistributedAndVarlen =
    /(distributed_attn_func|dist\.is_initialized|distributedattention|seqalltoall)/i.test(termText) &&
    /(flash_attn_varlen|cu_seqlens|unpadded_lengths|varlen)/i.test(termText);
  if (!needsDistributedAndVarlen) return undefined;

  const startIndex = requestedStart ? Math.max(0, requestedStart - 1) : 0;
  const searchStart = Math.max(0, startIndex - 80);
  const searchEnd = Math.min(lines.length, startIndex + 30);
  const window = lines.slice(searchStart, searchEnd);
  const relativeDist = window.findIndex((line) => /dist\.is_initialized|distributed_attn_func/.test(line));
  const relativeVarlen = window.findIndex((line) => /flash_attn_varlen|cu_seqlens|unpadded_lengths/.test(line));
  if (relativeDist !== -1 && relativeVarlen !== -1 && relativeDist < relativeVarlen) {
    return searchStart + relativeDist + 1;
  }
  return undefined;
}

function expandEvidenceEndLine(lines: string[], startLine: number, requestedEnd: number): number {
  const minEnd = startLine + MIN_EVIDENCE_LINES - 1;
  const maxEnd = startLine + MAX_EVIDENCE_LINES - 1;
  const semanticEnd = inferSemanticBlockEnd(lines, startLine, maxEnd);
  return Math.min(Math.max(requestedEnd, minEnd, semanticEnd), maxEnd, lines.length);
}

function inferSemanticBlockEnd(lines: string[], startLine: number, maxEnd: number): number {
  const startIndex = startLine - 1;
  const startText = lines[startIndex] ?? "";
  const indent = startText.match(/^\s*/)?.[0].length ?? 0;
  const startsBlock = /^\s*(class|def|async def|function|export function|const|let|var)\b/.test(startText);
  if (!startsBlock) return startLine + MIN_EVIDENCE_LINES - 1;

  for (let index = startIndex + 1; index < Math.min(lines.length, maxEnd); index++) {
    const line = lines[index];
    if (!line.trim()) continue;
    const lineIndent = line.match(/^\s*/)?.[0].length ?? 0;
    if (lineIndent <= indent && /^\s*(class|def|async def|function|export function|const|let|var)\b/.test(line)) {
      return index;
    }
  }
  return Math.min(maxEnd, lines.length);
}

export function runEvidenceCheck(drafts: RiskDraft[]): RepoInterviewRisk[] {
  return drafts.map((draft) => {
    const { refs, removed } = normalizeEvidenceRefs(draft.evidenceRefs);
    const check = checkEvidenceForRisk({ ...draft, evidenceRefs: refs }, removed);
    return {
      ...draft,
      evidenceRefs: refs,
      evidenceCheck: check
    };
  });
}

export function sortRisks<T extends { riskLevel: "low" | "medium" | "high"; title: string }>(risks: T[]): T[] {
  const order = { high: 0, medium: 1, low: 2 };
  return [...risks].sort((a, b) => order[a.riskLevel] - order[b.riskLevel] || a.title.localeCompare(b.title));
}

export function buildEvidenceBundle(context: RepoContext, risks: RepoInterviewRisk[]): EvidenceDocument[] {
  const rangesByFile = new Map<string, Array<{ startLine: number; endLine: number; riskIds: string[] }>>();
  for (const risk of risks) {
    for (const ref of risk.evidenceRefs) {
      const ranges = rangesByFile.get(ref.filePath) ?? [];
      const existing = ranges.find((range) => range.startLine === ref.startLine && range.endLine === ref.endLine);
      if (existing) {
        existing.riskIds.push(risk.id);
      } else {
        ranges.push({ startLine: ref.startLine, endLine: ref.endLine, riskIds: [risk.id] });
      }
      rangesByFile.set(ref.filePath, ranges);
    }
  }

  return context.files
    .filter((file) => rangesByFile.has(file.path))
    .map((file) => ({
      filePath: file.path,
      language: inferLanguage(file.path),
      content: file.content.length > MAX_DOCUMENT_CHARS ? file.content.slice(0, MAX_DOCUMENT_CHARS) : file.content,
      truncated: file.truncated || file.content.length > MAX_DOCUMENT_CHARS,
      evidenceRanges: rangesByFile.get(file.path) ?? []
    }));
}

function checkEvidenceForRisk(
  risk: Omit<RiskDraft, "evidenceCheck">,
  removedEvidenceRefs: EvidenceRef[]
): EvidenceCheck {
  const hasEvidence = risk.evidenceRefs.length > 0;
  const hasSnippet = risk.evidenceRefs.some((ref) => ref.snippet.trim().length > 0);
  const hasCodeOrConfig = risk.evidenceRefs.some((ref) => !isReadmeLike(ref.filePath));
  const hasReadmeClaim = risk.evidenceRefs.some((ref) => isReadmeLike(ref.filePath));
  const combinedEvidence = risk.evidenceRefs.map((ref) => ref.snippet).join("\n").toLowerCase();
  const offFocusReason = getOffFocusReason(risk);
  const asksForRuntimeEvidence = /(训练|train|eval|评测|metric|baseline|ablation|配置|config|data|数据|memory|tool|agent|RAG|召回|推理|inference)/i.test(
    `${risk.title} ${risk.interviewerQuestion} ${risk.claim}`
  );
  const missingEntailment = findUnsupportedQuestionTerms(risk, combinedEvidence);

  const missingEvidence: string[] = [];
  if (!hasEvidence) missingEvidence.push("至少一个能定位到已读取文件的 reference");
  if (asksForRuntimeEvidence && !hasCodeOrConfig) missingEvidence.push("核心实现、配置、训练/评测或数据处理文件");
  if (/claim|README|论文|paper|主张/i.test(risk.claim) && !hasReadmeClaim && risk.evidenceRefs.length < 2) {
    missingEvidence.push("README / 论文主张证据");
  }
  if (offFocusReason) missingEvidence.push(offFocusReason);
  missingEvidence.push(...missingEntailment);

  const sufficiency: EvidenceCheck["sufficiency"] =
    hasEvidence && hasSnippet && missingEntailment.length === 0 && (!asksForRuntimeEvidence || hasCodeOrConfig)
      ? "sufficient"
      : hasEvidence && hasSnippet
        ? "partial"
        : "insufficient";
  const necessity: EvidenceCheck["necessity"] =
    !hasEvidence ? "irrelevant" : removedEvidenceRefs.length > 0 || risk.evidenceRefs.length > 4 ? "excessive" : "necessary";
  const status: EvidenceCheck["status"] =
    offFocusReason
      ? "drop"
      : sufficiency === "sufficient" && necessity !== "irrelevant"
      ? "pass"
      : sufficiency === "insufficient"
        ? "drop"
        : "needs_revision";

  return {
    status,
    sufficiency,
    necessity,
    missingEvidence,
    removedEvidenceRefs,
    reason: buildEvidenceCheckReason(status, sufficiency, necessity, missingEvidence)
  };
}

function getOffFocusReason(risk: Omit<RiskDraft, "evidenceCheck">): string {
  const questionText = `${risk.title} ${risk.interviewerQuestion}`.toLowerCase();
  const answerText = risk.referenceAnswer.toLowerCase();
  const externalMainQuestion =
    /huggingface|transformers|vllm|现成框架|现成实现|原生支持/.test(questionText) ||
    (/为什么不(直接)?用|为什么不用|不用.*现成|升级.*版本|版本.*兼容/.test(questionText) &&
      /huggingface|transformers|vllm|框架|库/.test(`${questionText} ${answerText}`));
  if (!externalMainQuestion) return "";
  return "主问题偏向外部框架/生态选型，不是本仓库内部设计思路或具体实现风险";
}

function reviseRiskAgainstEvidence<T extends RiskDraft>(risk: T): T {
  const combined = risk.evidenceRefs.map((ref) => ref.snippet).join("\n").toLowerCase();
  if (hasDistributedVarlenSplitEvidence(combined)) {
    const mentionsVarlenDistributed =
      /distributedattention|分布式|distributed/i.test(risk.interviewerQuestion) &&
      /varlen|cu_seqlens|变长/i.test(risk.interviewerQuestion);
    const mentionsPaddingWaste = /padding|attention_mask|序列长度不均匀|空转|显存浪费|浪费/i.test(
      risk.interviewerQuestion
    );
    if (mentionsVarlenDistributed) {
      return {
        ...risk,
        title: "分布式路径与 varlen 路径互斥的 padding 代价",
        interviewerQuestion:
          "你这段 LLaMA attention 里，分布式分支和 varlen 分支是互斥的。为什么分布式路径没有走 flash_attn_varlen_kvpacked_func？如果 batch 里 padding 很多，分布式路径会不会失去 varlen 的收益？",
        referenceAnswer:
          "这里的代码先判断分布式环境，分布式分支直接调用 distributed_attn_func，并且注释写了假设 padding tokens 在序列末尾、可能忽略 attention_mask；只有非分布式分支且 unpadded_lengths 存在时才会构造 cu_seqlens 并调用 flash_attn_varlen_kvpacked_func。好回答应该指出这两个路径是互斥的，然后讨论 padding 很多时分布式路径可能无法获得 varlen 跳过 padding 的收益，以及需要怎样验证或改造。",
        redFlags: dedupeStrings([
          ...risk.redFlags,
          "把 cu_seqlens 说成是在 DistributedAttention 内部构造的",
          "没有看出分布式分支和 varlen 分支是互斥路径"
        ]),
        fixSuggestions: dedupeStrings([
          "把 attention forward 里的分布式分支和 varlen 分支画成控制流图。",
          "准备解释 padding 很多时为什么 varlen 能省计算，以及分布式路径没有走 varlen 的代价。",
          ...risk.fixSuggestions
        ]),
        followUpSeeds: dedupeStrings([
          "如果要让分布式路径也支持 varlen，你会把 cu_seqlens 的构造和 all-to-all 放在哪一步？",
          ...risk.followUpSeeds
        ])
      };
    }
    if (mentionsPaddingWaste) {
      return {
        ...risk,
        title: "分布式 attention 路径忽略 attention_mask 的 padding 风险",
        interviewerQuestion:
          "这里分布式分支直接走 distributed_attn_func，而且注释说假设 padding tokens 在序列末尾、可能忽略 attention_mask。那 batch 里 padding 很多或者序列长度差异很大时，这条路径会不会失去 varlen 跳过 padding 的收益？你会怎么验证它的计算和显存代价？",
        referenceAnswer:
          "证据能证明分布式路径使用 distributed_attn_func，而非分布式路径才在 unpadded_lengths 存在时使用 flash_attn_varlen_kvpacked_func；同时分布式分支注释说明可能忽略 attention_mask。好回答应避免说代码已经处理了不均匀序列，而是说明这是一个需要 benchmark 或改造验证的风险点。",
        redFlags: dedupeStrings([
          ...risk.redFlags,
          "直接声称分布式路径已经通过 varlen 处理 padding",
          "没有区分 tensor split/all-to-all 和跳过 padding 计算这两个问题"
        ]),
        fixSuggestions: dedupeStrings([
          "准备一个 padding-heavy batch 的 benchmark，对比分布式路径和 varlen 非分布式路径。",
          "补充说明 attention_mask 被忽略时的正确性假设和性能代价。",
          ...risk.fixSuggestions
        ]),
        followUpSeeds: dedupeStrings([
          "你会用哪些指标证明这不是 GPU 空转，而只是通信/切分开销？",
          ...risk.followUpSeeds
        ])
      };
    }
  }
  return risk;
}

function hasDistributedVarlenSplitEvidence(combinedEvidence: string): boolean {
  return (
    combinedEvidence.includes("dist.is_initialized") &&
    combinedEvidence.includes("distributed_attn_func") &&
    combinedEvidence.includes("flash_attn_varlen") &&
    combinedEvidence.includes("cu_seqlens")
  );
}

function findUnsupportedQuestionTerms(
  risk: Omit<RiskDraft, "evidenceCheck">,
  combinedEvidence: string
): string[] {
  const text = `${risk.title} ${risk.interviewerQuestion} ${risk.referenceAnswer}`.toLowerCase();
  const missing: string[] = [];
  const needsVarlen = /varlen|cu_seqlens|变长/.test(text);
  if (needsVarlen && !(combinedEvidence.includes("varlen") && combinedEvidence.includes("cu_seqlens"))) {
    missing.push("能证明 varlen/cu_seqlens 的实际构造或调用位置");
  }
  const needsFlashAttention = /flashattention|flash attention|flash_attn/.test(text);
  if (needsFlashAttention && !/flash_attn|flashattention|flash attention/.test(combinedEvidence)) {
    missing.push("能证明 FlashAttention 实际调用、导入或配置的代码证据");
  }
  const needsExternalComparison = /huggingface|transformers|vllm|版本|升级|兼容|现成|原生支持|支持还不完善|如果现在/.test(text);
  if (needsExternalComparison) {
    missing.push("外部框架/版本兼容性只能作为补充追问，主问题需要改成仓库内部实现、控制流或参数边界");
  }
  if (/开发时|当时|还不完善|历史原因/.test(text) && !/readme|changelog|issue|commit|release|version|requirements/.test(combinedEvidence)) {
    missing.push("能证明历史背景或当时库支持状态的文档/依赖证据");
  }
  const needsPadding = /padding|attention_mask|序列长度不均匀|空转|显存浪费/.test(text);
  if (
    needsPadding &&
    !(
      combinedEvidence.includes("padding") ||
      combinedEvidence.includes("attention_mask") ||
      combinedEvidence.includes("unpadded")
    )
  ) {
    missing.push("能证明 padding / attention_mask / unpadded_lengths 行为的代码证据");
  }
  const claimsInsideDistributed =
    /distributedattention|distributed attention|distributed path|分布式/.test(text) &&
    /varlen|cu_seqlens/.test(text);
  if (claimsInsideDistributed && hasDistributedVarlenSplitEvidence(combinedEvidence)) {
    return missing;
  }
  if (
    claimsInsideDistributed &&
    combinedEvidence.includes("distributedattention") &&
    !combinedEvidence.includes("flash_attn_varlen")
  ) {
    missing.push("能证明 DistributedAttention 内部直接使用 varlen/cu_seqlens 的代码；否则应改写为分支互斥风险");
  }
  return dedupeStrings(missing);
}

function normalizeEvidenceRefs(refs: EvidenceRef[]): { refs: EvidenceRef[]; removed: EvidenceRef[] } {
  const seen = new Set<string>();
  const kept: EvidenceRef[] = [];
  const removed: EvidenceRef[] = [];
  for (const ref of refs) {
    const key = `${ref.filePath}:${ref.startLine}-${ref.endLine}`;
    if (seen.has(key) || !ref.snippet.trim()) {
      removed.push(ref);
      continue;
    }
    seen.add(key);
    kept.push(ref);
  }
  return { refs: kept.slice(0, 4), removed: [...removed, ...kept.slice(4)] };
}

function parseEvidencePath(rawPath: string): ParsedEvidencePath {
  const trimmed = rawPath.trim();
  const match = trimmed.match(/^(.+?)(?::L?(\d+)(?:-L?(\d+))?)?$/);
  if (!match) return { filePath: trimmed };
  const startLine = match[2] ? Number(match[2]) : undefined;
  const endLine = match[3] ? Number(match[3]) : startLine;
  return {
    filePath: match[1],
    startLine: Number.isFinite(startLine) ? startLine : undefined,
    endLine: Number.isFinite(endLine) ? endLine : undefined
  };
}

function inferEvidenceStartLine(lines: string[], terms: string[]): number {
  const normalizedTerms = terms.map((term) => term.toLowerCase()).filter((term) => term.length >= 3);
  if (normalizedTerms.length > 0) {
    let best = { score: 0, line: -1 };
    for (let index = 0; index < lines.length; index++) {
      const score = scoreEvidenceWindow(lines, index + 1, normalizedTerms, ANCHOR_SCORE_LINES);
      if (score > best.score) best = { score, line: index };
    }
    if (best.line !== -1 && best.score > 0) {
      return Math.max(1, best.line + 1);
    }
  }
  const firstNonEmpty = lines.findIndex((line) => line.trim().length > 0);
  return firstNonEmpty === -1 ? 1 : firstNonEmpty + 1;
}

function scoreEvidenceWindow(lines: string[], startLine: number, terms: string[], windowLines = EVIDENCE_CONTEXT_LINES): number {
  const window = lines.slice(Math.max(0, startLine - 1), Math.min(lines.length, startLine + windowLines - 1));
  const text = window.join("\n").toLowerCase();
  const normalizedTerms = terms.map((term) => term.toLowerCase()).filter((term) => term.length >= 3);
  const termScore = normalizedTerms.reduce((score, term) => score + countOccurrences(text, term), 0);
  const implementationScore = window.some((line) => /^\s*(class|def|async def|function|export function|if|for|while|return|assert)\b/.test(line))
    ? 2
    : 0;
  const importPenalty = isImportOnlyWindow(lines, startLine) ? 100 : 0;
  return termScore + implementationScore - importPenalty;
}

function isImportOnlyWindow(lines: string[], startLine: number): boolean {
  const window = lines
    .slice(Math.max(0, startLine - 1), Math.min(lines.length, startLine + 4))
    .map((line) => line.trim())
    .filter(Boolean);
  if (window.length === 0) return false;
  const importLike = window.filter((line) =>
    /^(from\s+\S+\s+import\s+|import\s+|try:|except\b|raise\s+ImportError|\)|\(|#|"""|''')/.test(line)
  );
  return importLike.length / window.length >= 0.5;
}

function countOccurrences(text: string, term: string): number {
  let count = 0;
  let index = text.indexOf(term);
  while (index !== -1) {
    count += 1;
    index = text.indexOf(term, index + term.length);
  }
  return count;
}

function findMatchingExamPoint(question: InterviewQuestion, examPoints: ExamPoint[]): ExamPoint | undefined {
  return examPoints.find((point) => overlaps(point.evidence, question.evidence)) ?? examPoints[0];
}

function findMatchingClaim(question: InterviewQuestion, paperCodeMap: PaperCodeMapItem[]): string | undefined {
  return paperCodeMap.find((item) => overlaps([...item.codeEvidence, ...item.experimentEvidence], question.evidence))?.claim;
}

function overlaps(left: string[], right: string[]): boolean {
  const rightPaths = new Set(right.map((item) => parseEvidencePath(item).filePath));
  return left.some((item) => rightPaths.has(parseEvidencePath(item).filePath));
}

function difficultyToRiskLevel(difficulty: InterviewQuestion["difficulty"]): RepoInterviewRisk["riskLevel"] {
  if (difficulty === "hard") return "high";
  if (difficulty === "warmup") return "low";
  return "medium";
}

function buildRiskTitle(question: string, index: number): string {
  const cleaned = question.replace(/[？?].*$/, "").trim();
  return cleaned.length > 0 ? cleaned.slice(0, 34) : `风险点 ${index + 1}`;
}

function buildReferenceAnswer(question: InterviewQuestion): string {
  if (question.expectedAnswer.length === 0) {
    return "先把回答落到对应实现、配置或评测证据，再说明设计理由、取舍和可能失败的边界。";
  }
  return question.expectedAnswer.join("；");
}

function buildHighlightTerms(question: InterviewQuestion, point: ExamPoint | undefined, claim: string): string[] {
  const fullText = `${question.question} ${question.expectedAnswer.join(" ")} ${question.followUps.join(" ")} ${point?.title ?? ""} ${claim}`;
  return dedupeStrings([
    ...domainSupportTerms(fullText),
    ...extractCodeTerms(fullText),
    ...splitTerms(question.question),
    ...splitTerms(point?.title ?? ""),
    ...splitTerms(claim)
  ]).slice(0, 16);
}

function splitTerms(text: string): string[] {
  return text
    .split(/[\s,，。；;:：、/()（）"'`]+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 3 && !/^(为什么|这个|如果|怎么|什么|哪些|以及|the|and|for)$/i.test(term));
}

function extractCodeTerms(text: string): string[] {
  return Array.from(text.matchAll(/[A-Za-z_][A-Za-z0-9_]{2,}/g), (match) => match[0]).filter(
    (term) => !/^(and|the|for|with|from|this|that|you|your|why|how)$/i.test(term)
  );
}

function domainSupportTerms(text: string): string[] {
  const terms: string[] = [];
  if (/varlen|cu_seqlens|变长/i.test(text)) terms.push("cu_seqlens", "flash_attn_varlen", "unpadded_lengths");
  if (/padding|序列长度不均匀|显存浪费|空转|attention_mask/i.test(text)) {
    terms.push("padding", "attention_mask", "unpadded_lengths");
  }
  if (/distributedattention|distributed|分布式|多\s*gpu|gpu/i.test(text)) {
    terms.push("distributed_attn_func", "dist.is_initialized", "SeqAllToAll", "all_to_all");
  }
  return terms;
}

function dedupeStrings(items: string[]): string[] {
  const seen = new Set<string>();
  return items
    .map((item) => item.trim())
    .filter((item) => {
      if (!item || seen.has(item)) return false;
      seen.add(item);
      return true;
    });
}

function isReadmeLike(filePath: string): boolean {
  return /(^|\/)(readme|paper|project|docs?)(\.|\/|$)/i.test(filePath);
}

function inferLanguage(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    py: "python",
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    md: "markdown",
    sh: "shell",
    toml: "toml",
    rs: "rust",
    go: "go"
  };
  return ext ? (map[ext] ?? ext) : "text";
}

function buildEvidenceCheckReason(
  status: EvidenceCheck["status"],
  sufficiency: EvidenceCheck["sufficiency"],
  necessity: EvidenceCheck["necessity"],
  missingEvidence: string[]
): string {
  if (status === "pass") return "reference 能定位到具体仓库证据，且没有发现明显无关或重复证据。";
  if (status === "drop") return "reference 无法定位到足以支撑该风险点的已读取文件。";
  return `reference 只有部分支撑，需要补充：${missingEvidence.join("、") || "更精确的实现或配置证据"}；必要性判断为 ${necessity}，充分性判断为 ${sufficiency}。`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
