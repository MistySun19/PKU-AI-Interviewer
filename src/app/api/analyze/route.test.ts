import { describe, expect, it } from "vitest";
import { POST } from "./route";

describe("POST /api/analyze", () => {
  it("returns the fixed Traceback demo snapshot for the PKU-AI-Interviewer repo", async () => {
    const response = await POST(
      new Request("http://localhost/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repositoryUrl: "https://github.com/MistySun19/PKU-AI-Interviewer",
          mode: "survey"
        })
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const body = await response.text();
    const resultFrame = body
      .split("\n\n")
      .map((frame) => frame.split("\n").find((line) => line.startsWith("data:")))
      .filter(Boolean)
      .map((line) => JSON.parse(line!.slice(5)) as { type: string; result?: { repo?: { fullName?: string }; risks?: unknown[] } })
      .find((event) => event.type === "result");

    expect(resultFrame?.result?.repo?.fullName).toBe("MistySun19/PKU-AI-Interviewer");
    expect(resultFrame?.result?.risks?.length).toBeGreaterThanOrEqual(8);
  });

  it("returns a normal 400 error when the repository URL cannot be parsed", async () => {
    const response = await POST(
      new Request("http://localhost/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repositoryUrl: "https://github.com/foo/bar/issues", mode: "survey" })
      })
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({
      error: "请输入 GitHub 仓库主页链接，或 /tree/{branch} 分支链接。"
    });
  });
});
