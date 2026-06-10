import { describe, expect, it } from "vitest";
import { matchKaomianQuestions } from "./kaomian";
import type { KaomianItem } from "./types";

const bank: KaomianItem[] = [
  { id: "k001", question: "RAG 的召回率怎么提升？", category: "knowledge_qa", frequency: 5, companies: [], sourceFile: "题库/02" },
  { id: "k002", question: "怎么评估 Agent 效果好不好？", category: "knowledge_qa", frequency: 9, companies: [], sourceFile: "题库/02" },
  { id: "k003", question: "上下文窗口不够用，对话太长怎么办？", category: "knowledge_qa", frequency: 7, companies: [], sourceFile: "题库/02" },
  { id: "k004", question: "手写一个 attention", category: "ml_llm_coding", frequency: 2, companies: [], sourceFile: "题库/05" }
];

describe("matchKaomianQuestions", () => {
  it("matches by tech tag substring and ranks by score", () => {
    const matches = matchKaomianQuestions(["RAG", "attention"], 10, bank);
    expect(matches.map((match) => match.id)).toEqual(["k001", "k004"]);
  });

  it("matches Chinese terms", () => {
    const matches = matchKaomianQuestions(["上下文窗口"], 10, bank);
    expect(matches.map((match) => match.id)).toEqual(["k003"]);
  });

  it("returns empty when no term matches", () => {
    expect(matchKaomianQuestions(["diffusion"], 10, bank)).toEqual([]);
    expect(matchKaomianQuestions([], 10, bank)).toEqual([]);
  });

  it("caps results at topN", () => {
    const matches = matchKaomianQuestions(["agent", "rag", "上下文", "attention"], 2, bank);
    expect(matches.length).toBe(2);
  });
});
