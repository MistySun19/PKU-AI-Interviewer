import { describe, expect, it } from "vitest";
import {
  buildEvidenceBundle,
  buildRepoInterviewAudit,
  buildRiskDrafts,
  resolveEvidenceRef,
  runEvidenceCheck,
  sortRisks
} from "./risk-audit";
import { fallbackUnderstanding } from "./report";
import type { EvidenceRef, RepoContext, RepoFileContent } from "./types";

function context(): RepoContext {
  const files: RepoFileContent[] = [
    {
      path: "README.md",
      size: 120,
      score: 90,
      category: "paperDocs",
      reason: "README",
      truncated: false,
      content: "# Claim\nsupports persistent memory\n"
    },
    {
      path: "src/memory.ts",
      size: 220,
      score: 130,
      category: "methodFiles",
      reason: "method",
      truncated: false,
      content: ["export function saveMemory(session) {", "  return session.state.memory;", "}"].join("\n")
    },
    {
      path: "configs/eval.yaml",
      size: 90,
      score: 70,
      category: "configFiles",
      reason: "config",
      truncated: false,
      content: "metric: accuracy\nseed: 42\n"
    }
  ];
  return {
    repo: {
      owner: "o",
      name: "r",
      fullName: "o/r",
      defaultBranch: "main",
      htmlUrl: "https://github.com/o/r",
      description: null,
      language: "TypeScript",
      stars: 1,
      fileCount: files.length
    },
    readme: files[0].content,
    files,
    treeFiles: files.map((file) => ({ path: file.path, size: file.size })),
    analysisMode: "paper-code",
    paperSignals: {
      venues: [],
      paperLinks: [],
      citationFound: false,
      officialImplementation: false,
      benchmarkSignals: [],
      trainingSignals: [],
      evaluationSignals: [],
      methodSignals: []
    },
    researchArtifacts: {
      paperDocs: ["README.md"],
      methodFiles: ["src/memory.ts"],
      trainingFiles: [],
      evaluationFiles: [],
      configFiles: ["configs/eval.yaml"],
      dataFiles: [],
      demoFiles: [],
      scripts: []
    },
    warnings: []
  };
}

function contextWithLlamaAttention(): RepoContext {
  const files: RepoFileContent[] = [
    {
      path: "modeling_flash_llama.py",
      size: 2000,
      score: 150,
      category: "methodFiles",
      reason: "attention",
      truncated: false,
      content: [
        "from swebench.inference.llamao.distributed_attention import DistributedAttention",
        "from flash_attn import flash_attn_kvpacked_func, flash_attn_varlen_kvpacked_func",
        "",
        "class Attention:",
        "  def __init__(self):",
        "    self.distributed_attn_func = DistributedAttention(flash_attn_kvpacked_func)",
        "  def forward(self, q, kv, unpadded_lengths, attention_mask, seq_parallel_group):",
        "    if dist.is_initialized() and dist.get_world_size(seq_parallel_group) > 1:",
        "      # NOTE: we assume that padding tokens are at the end of the sequence and may ignore `attention_mask`",
        "      attn_outputs = self.distributed_attn_func(q, kv, group=seq_parallel_group)",
        "    else:",
        "      if unpadded_lengths is not None:",
        "        # varlen, ignore padding tokens, efficient for large batch with many paddings",
        "        cu_seqlens, max_seqlen = unpadded_lengths",
        "        attn_outputs = flash_attn_varlen_kvpacked_func(q, kv, cu_seqlens, cu_seqlens, max_seqlen, max_seqlen)",
        "      else:",
        "        attn_outputs = flash_attn_kvpacked_func(q, kv)",
        "    return attn_outputs"
      ].join("\n")
    },
    {
      path: "distributed_attention.py",
      size: 900,
      score: 120,
      category: "methodFiles",
      reason: "distributed attention",
      truncated: false,
      content: [
        "class SeqAllToAll:",
        "  def forward(ctx, input, scatter_idx, gather_idx, group):",
        "    input_list = [t.contiguous() for t in torch.tensor_split(input, world_size, scatter_idx)]",
        "    dist.all_to_all(output_list, input_list, group=group)",
        "class DistributedAttention(torch.nn.Module):",
        "  def forward(self, query, key_values, group=None, **kwargs):",
        "    query_heads = SeqAllToAll.apply(query, self.scatter_idx, self.gather_idx, group)",
        "    output_heads = self.local_attn(query_heads, key_values, **kwargs)",
        "    return SeqAllToAll.apply(output_heads, self.gather_idx, self.scatter_idx, group)"
      ].join("\n")
    }
  ];
  return {
    ...context(),
    files,
    treeFiles: files.map((file) => ({ path: file.path, size: file.size })),
    researchArtifacts: {
      paperDocs: [],
      methodFiles: ["modeling_flash_llama.py", "distributed_attention.py"],
      trainingFiles: [],
      evaluationFiles: [],
      configFiles: [],
      dataFiles: [],
      demoFiles: [],
      scripts: []
    }
  };
}

describe("risk-audit", () => {
  it("resolves evidence refs with line ranges and snippets", () => {
    const ref = resolveEvidenceRef("src/memory.ts:2-3", new Map(context().files.map((file) => [file.path, file.content])), {
      reason: "memory risk",
      highlightTerms: ["memory"]
    });

    expect(ref).toMatchObject({
      filePath: "src/memory.ts",
      startLine: 2
    });
    expect(ref?.endLine).toBeGreaterThanOrEqual(3);
    expect(ref?.snippet).toContain("2 |");
    expect(ref?.snippet).toContain("session.state.memory");
  });

  it("reanchors shallow import references to stronger implementation evidence", () => {
    const content = [
      "from package import DistributedAttention",
      "from flash_attn import flash_attn_varlen_kvpacked_func",
      "",
      "def unrelated():",
      "  return None",
      "",
      "def forward(unpadded_lengths):",
      "  if unpadded_lengths is not None:",
      "    cu_seqlens, max_seqlen = unpadded_lengths",
      "    return flash_attn_varlen_kvpacked_func(q, kv, cu_seqlens, cu_seqlens, max_seqlen, max_seqlen)"
    ].join("\n");
    const ref = resolveEvidenceRef("modeling_flash_llama.py:1-2", new Map([["modeling_flash_llama.py", content]]), {
      reason: "varlen evidence",
      highlightTerms: ["DistributedAttention", "varlen", "cu_seqlens", "flash_attn"]
    });

    expect(ref?.startLine).toBeGreaterThan(1);
    expect(ref?.snippet).toContain("cu_seqlens");
    expect(ref?.snippet).toContain("flash_attn_varlen_kvpacked_func");
  });

  it("marks pass, needs_revision and drop according to evidence quality", () => {
    const goodRef = evidenceRef("src/memory.ts", "memory code");
    const readmeRef = evidenceRef("README.md", "claim only");
    const checked = runEvidenceCheck([
      draft("good", [goodRef]),
      draft("partial", [readmeRef], "训练配置怎么支撑 claim？"),
      draft("drop", [])
    ]);

    expect(checked.find((risk) => risk.id === "good")?.evidenceCheck.status).toBe("pass");
    expect(checked.find((risk) => risk.id === "partial")?.evidenceCheck.status).toBe("needs_revision");
    expect(checked.find((risk) => risk.id === "drop")?.evidenceCheck.status).toBe("drop");
  });

  it("does not pass varlen questions without varlen evidence", () => {
    const checked = runEvidenceCheck([
      draft(
        "unsupported-varlen",
        [evidenceRef("distributed_attention.py", "class DistributedAttention:\n  def forward(self):\n    return SeqAllToAll.apply(x)")],
        "在你的 DistributedAttention 里，varlen 的 cu_seqlens 参数是怎么构造的？"
      )
    ]);

    expect(checked[0].evidenceCheck.status).toBe("needs_revision");
    expect(checked[0].evidenceCheck.missingEvidence.join(" ")).toContain("varlen/cu_seqlens");
  });

  it("drops external framework comparison as an off-focus main question", () => {
    const checked = runEvidenceCheck([
      draft(
        "unsupported-hf",
        [
          evidenceRef(
            "modeling_flash_llama.py",
            "class LlamaDecoderLayer(nn.Module):\n  def forward(self, hidden_states):\n    return self.self_attn(hidden_states)"
          )
        ],
        "你们为什么不直接用 HuggingFace 现成的 FlashAttention？升级 transformers 版本的时候不会炸吗？"
      )
    ]);

    expect(checked[0].evidenceCheck.status).toBe("drop");
    expect(checked[0].evidenceCheck.missingEvidence.join(" ")).toContain("外部框架/生态选型");
  });

  it("keeps internal design and implementation questions in focus", () => {
    const checked = runEvidenceCheck([
      draft(
        "internal-branch",
        [
          evidenceRef(
            "modeling_flash_llama.py",
            "if dist.is_initialized():\n  attn_outputs = self.distributed_attn_func(q, kv)\nelse:\n  cu_seqlens, max_seqlen = unpadded_lengths\n  attn_outputs = flash_attn_varlen_kvpacked_func(q, kv, cu_seqlens, cu_seqlens, max_seqlen, max_seqlen)"
          )
        ],
        "这里分布式分支和 varlen 分支是互斥的。为什么分布式路径没有走 flash_attn_varlen_kvpacked_func？如果 padding 很多会失去什么收益？"
      )
    ]);

    expect(checked[0].evidenceCheck.status).toBe("pass");
  });

  it("rewrites mutually exclusive distributed and varlen branch questions", () => {
    const repoContext = contextWithLlamaAttention();
    const understanding = fallbackUnderstanding(repoContext);
    const audit = buildRepoInterviewAudit({
      context: repoContext,
      understanding,
      paperCodeMap: [
        {
          claim: "LLaMA attention uses distributed attention and FlashAttention varlen paths.",
          codeEvidence: ["modeling_flash_llama.py:1-2", "distributed_attention.py:5-6"],
          experimentEvidence: [],
          interviewRisk: ""
        }
      ],
      examPoints: [
        {
          title: "DistributedAttention 与 FlashAttention 集成的正确性与稳定性",
          riskLevel: "high",
          evidence: ["modeling_flash_llama.py:1-2", "distributed_attention.py:5-6"],
          whyAsk: "检查分支逻辑",
          followUps: []
        }
      ],
      questions: [
        {
          question: "你用了 FlashAttention 的 varlen 函数来处理变长序列。这个 varlen 跟普通的 FlashAttention 有什么区别？在你的 DistributedAttention 里，varlen 的 cu_seqlens 参数是怎么构造的？如果构造错了会有什么后果？",
          difficulty: "hard",
          evidence: ["modeling_flash_llama.py:1-2", "distributed_attention.py:5-6"],
          whyAsk: "检查分支逻辑",
          expectedAnswer: ["cu_seqlens", "flash_attn_varlen_kvpacked_func", "DistributedAttention"],
          redFlags: [],
          followUps: [],
          source: "repo"
        }
      ]
    });

    expect(audit.risks[0].interviewerQuestion).toContain("分布式分支和 varlen 分支是互斥的");
    expect(audit.risks[0].interviewerQuestion).toContain("为什么分布式路径没有走 flash_attn_varlen_kvpacked_func");
    expect(audit.risks[0].evidenceRefs[0].startLine).toBeLessThanOrEqual(8);
    expect(audit.risks[0].evidenceRefs[0].snippet).toContain("dist.is_initialized");
    expect(audit.risks[0].evidenceRefs[0].snippet).toContain("flash_attn_varlen_kvpacked_func");
    expect(audit.risks[0].evidenceCheck.status).toBe("pass");
  });

  it("removes duplicate evidence refs as unnecessary", () => {
    const ref = evidenceRef("src/memory.ts", "memory code");
    const [checked] = runEvidenceCheck([draft("dup", [ref, ref])]);

    expect(checked.evidenceRefs).toHaveLength(1);
    expect(checked.evidenceCheck.removedEvidenceRefs).toHaveLength(1);
    expect(checked.evidenceCheck.necessity).toBe("excessive");
  });

  it("sorts risks by high, medium and low risk", () => {
    const sorted = sortRisks([
      { title: "low", riskLevel: "low" as const },
      { title: "high", riskLevel: "high" as const },
      { title: "medium", riskLevel: "medium" as const }
    ]);

    expect(sorted.map((risk) => risk.riskLevel)).toEqual(["high", "medium", "low"]);
  });

  it("builds final risks and evidence bundle with evidence checks", () => {
    const repoContext = context();
    const understanding = fallbackUnderstanding(repoContext);
    const drafts = buildRiskDrafts({
      context: repoContext,
      understanding,
      paperCodeMap: [{ claim: "memory claim", codeEvidence: ["src/memory.ts"], experimentEvidence: [], interviewRisk: "" }],
      examPoints: [{ title: "memory 风险", riskLevel: "high", evidence: ["src/memory.ts"], whyAsk: "why", followUps: [] }],
      questions: [
        {
          question: "你这个 memory 真的是长期存储吗？",
          difficulty: "hard",
          evidence: ["src/memory.ts"],
          whyAsk: "查 claim",
          expectedAnswer: ["session state 不是长期存储"],
          redFlags: ["说成数据库"],
          followUps: ["如果重启会怎样？"],
          source: "repo"
        }
      ]
    });
    const audit = buildRepoInterviewAudit({
      context: repoContext,
      understanding,
      paperCodeMap: [{ claim: "memory claim", codeEvidence: ["src/memory.ts"], experimentEvidence: [], interviewRisk: "" }],
      examPoints: [{ title: "memory 风险", riskLevel: "high", evidence: ["src/memory.ts"], whyAsk: "why", followUps: [] }],
      questions: [
        {
          question: "你这个 memory 真的是长期存储吗？",
          difficulty: "hard",
          evidence: ["src/memory.ts"],
          whyAsk: "查 claim",
          expectedAnswer: ["session state 不是长期存储"],
          redFlags: ["说成数据库"],
          followUps: ["如果重启会怎样？"],
          source: "kaomian"
        }
      ]
    });

    expect(drafts[0].evidenceRefs[0].filePath).toBe("src/memory.ts");
    expect(audit.risks[0].evidenceCheck.status).toBe("pass");
    expect(audit.risks[0].source).toBe("interview_story");
    expect(audit.evidenceBundle[0]).toMatchObject({ filePath: "src/memory.ts" });
  });

  it("builds evidence bundle ranges for passed risks", () => {
    const repoContext = context();
    const bundle = buildEvidenceBundle(repoContext, [
      {
        ...draft("risk-1", [evidenceRef("src/memory.ts", "code")]),
        evidenceCheck: {
          status: "pass",
          sufficiency: "sufficient",
          necessity: "necessary",
          missingEvidence: [],
          removedEvidenceRefs: [],
          reason: "ok"
        }
      }
    ]);

    expect(bundle).toHaveLength(1);
    expect(bundle[0].evidenceRanges[0].riskIds).toEqual(["risk-1"]);
  });
});

function evidenceRef(filePath: string, snippet: string): EvidenceRef {
  return {
    filePath,
    startLine: 1,
    endLine: 2,
    snippet,
    reason: "reason",
    highlightTerms: []
  };
}

function draft(id: string, evidenceRefs: EvidenceRef[], question = "为什么这么设计？") {
  return {
    id,
    riskLevel: "medium" as const,
    title: id,
    interviewerQuestion: question,
    claim: "claim",
    whyThisMatters: "why",
    evidenceRefs,
    knowledgeGaps: [],
    referenceAnswer: "answer",
    redFlags: [],
    fixSuggestions: [],
    followUpSeeds: [],
    source: "repo" as const
  };
}
