import { describe, expect, it } from "vitest";
import { POST } from "./route";

describe("POST /api/analyze", () => {
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
