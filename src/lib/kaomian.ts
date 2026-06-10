import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { KaomianItem } from "./types";

export type KaomianMatch = KaomianItem & { matchScore: number };

let cache: KaomianItem[] | null = null;

export function loadKaomianBank(): KaomianItem[] {
  if (cache) return cache;
  try {
    const raw = readFileSync(join(process.cwd(), "data", "kaomian", "kaomian.json"), "utf8");
    cache = (JSON.parse(raw) as { items: KaomianItem[] }).items ?? [];
  } catch {
    cache = [];
  }
  return cache;
}

export function matchKaomianQuestions(
  terms: string[],
  topN = 12,
  bank: KaomianItem[] = loadKaomianBank()
): KaomianMatch[] {
  const normalized = normalizeTerms(terms);
  if (normalized.length === 0) return [];

  return bank
    .map((item) => {
      const text = item.question.toLowerCase();
      let hits = 0;
      for (const term of normalized) {
        if (text.includes(term)) hits += 1;
      }
      return { ...item, matchScore: hits * Math.log2(1 + item.frequency) };
    })
    .filter((item) => item.matchScore > 0)
    .sort((a, b) => b.matchScore - a.matchScore || b.frequency - a.frequency || a.id.localeCompare(b.id))
    .slice(0, topN);
}

function normalizeTerms(values: string[]): string[] {
  return [
    ...new Set(
      values
        .flatMap((value) => value.toLowerCase().split(/[\s/、,，()（）:：;；·\-_]+/))
        .map((term) => term.trim())
        .filter((term) => term.length >= 2)
    )
  ];
}
