import { describe, expect, it } from "vitest";
import { extractJsonObject } from "./llm";

describe("extractJsonObject", () => {
  it("extracts raw JSON", () => {
    expect(extractJsonObject('{"ok":true}')).toEqual({ ok: true });
  });

  it("extracts fenced JSON", () => {
    expect(extractJsonObject('```json\n{"name":"repo"}\n```')).toEqual({ name: "repo" });
  });

  it("throws on missing JSON", () => {
    expect(() => extractJsonObject("not json")).toThrow();
  });
});
