import { describe, expect, it } from "vitest";
import { buildTreeSummary, computeCentrality, extractImports, skeletonizeFile } from "./repomap";

describe("extractImports", () => {
  it("extracts python imports", () => {
    const content = "import torch\nfrom micrograd.engine import Value\nimport os, sys\n";
    expect(extractImports("train.py", content)).toEqual(["micrograd.engine", "torch", "os", "sys"]);
  });

  it("extracts js/ts imports", () => {
    const content = 'import { a } from "./engine";\nconst b = require("../data/loader");\n';
    expect(extractImports("src/main.ts", content)).toEqual(["./engine", "../data/loader"]);
  });
});

describe("computeCentrality", () => {
  it("counts how many files import a module", () => {
    const files = [
      { path: "micrograd/engine.py", content: "" },
      { path: "micrograd/nn.py", content: "from micrograd.engine import Value" },
      { path: "test/test_engine.py", content: "from micrograd.engine import Value\nfrom micrograd.nn import MLP" }
    ];
    const centrality = computeCentrality(files);
    expect(centrality.get("micrograd/engine.py")).toBe(2);
    expect(centrality.get("micrograd/nn.py")).toBe(1);
    expect(centrality.get("test/test_engine.py")).toBe(0);
  });

  it("does not double count the same target from one file", () => {
    const files = [
      { path: "engine.py", content: "" },
      { path: "main.py", content: "import engine\nfrom engine import Value" }
    ];
    expect(computeCentrality(files).get("engine.py")).toBe(1);
  });
});

describe("skeletonizeFile", () => {
  it("keeps small files unchanged", () => {
    const { content, skeletonized } = skeletonizeFile("a.py", "def f():\n    return 1\n");
    expect(skeletonized).toBe(false);
    expect(content).toContain("def f()");
  });

  it("keeps signatures and imports for large python files", () => {
    const body = `import torch\n\nclass Model:\n    def forward(self, x):\n${"        x = x + 1\n".repeat(4000)}`;
    const { content, skeletonized } = skeletonizeFile("model.py", body, 1000);
    expect(skeletonized).toBe(true);
    expect(content).toContain("import torch");
    expect(content).toContain("class Model:");
    expect(content).toContain("def forward(self, x):");
    expect(content).not.toContain("x = x + 1");
  });

  it("keeps signatures for large ts files", () => {
    const body = `import { z } from "zod";\nexport function run(a: number) {\n${"  console.log(a);\n".repeat(4000)}}\n`;
    const { content, skeletonized } = skeletonizeFile("run.ts", body, 1000);
    expect(skeletonized).toBe(true);
    expect(content).toContain('import { z } from "zod";');
    expect(content).toContain("export function run(a: number) {");
    expect(content).not.toContain("console.log");
  });
});

describe("buildTreeSummary", () => {
  it("groups files by directory with counts", () => {
    const summary = buildTreeSummary(["README.md", "src/a.ts", "src/b.ts", "configs/train.yaml"]);
    expect(summary).toContain("src (2 个文件)");
    expect(summary).toContain(". (1 个文件)");
    expect(summary).toContain("configs (1 个文件)");
  });
});
