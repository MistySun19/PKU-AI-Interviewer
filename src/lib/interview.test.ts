import { describe, expect, it } from "vitest";
import {
  applyAnswer,
  createInterviewSession,
  decideNextStep,
  getInterviewSession,
  pickInterviewQuestions
} from "./interview";
import { fallbackUnderstanding } from "./report";
import type { InterviewQuestion, RepoContext } from "./types";

function question(text: string, difficulty: InterviewQuestion["difficulty"], followUps: string[] = []): InterviewQuestion {
  return {
    question: text,
    difficulty,
    evidence: ["train.py"],
    whyAsk: "",
    expectedAnswer: [],
    redFlags: [],
    followUps
  };
}

function makeUnderstanding() {
  const context = {
    repo: {
      owner: "o",
      name: "r",
      fullName: "o/r",
      defaultBranch: "main",
      htmlUrl: "",
      description: null,
      language: null,
      stars: 0,
      fileCount: 0
    },
    readme: "",
    files: [],
    treeFiles: [],
    analysisMode: "unknown",
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
      paperDocs: [],
      methodFiles: [],
      trainingFiles: [],
      evaluationFiles: [],
      configFiles: [],
      dataFiles: [],
      demoFiles: [],
      scripts: []
    },
    warnings: []
  } as unknown as RepoContext;
  return fallbackUnderstanding(context);
}

describe("pickInterviewQuestions", () => {
  it("builds an escalating chain: warmup then medium then hard", () => {
    const questions = [
      question("h1", "hard"),
      question("w1", "warmup"),
      question("m1", "medium"),
      question("m2", "medium"),
      question("h2", "hard"),
      question("w2", "warmup")
    ];
    const picked = pickInterviewQuestions(questions, 4);
    expect(picked.map((item) => item.question)).toEqual(["w1", "m1", "m2", "h1"]);
  });

  it("pads with leftovers when buckets are sparse", () => {
    const questions = [question("m1", "medium"), question("m2", "medium"), question("m3", "medium"), question("m4", "medium"), question("m5", "medium")];
    const picked = pickInterviewQuestions(questions, 5);
    expect(picked.length).toBe(5);
  });
});

describe("interview state machine", () => {
  it("follows up on weak answers using model question first", () => {
    const session = createInterviewSession({
      repoFullName: "o/r",
      understanding: makeUnderstanding(),
      questions: [question("q1", "medium", ["默认追问"]), question("q2", "hard")]
    });

    const step = decideNextStep(session, {
      score: 2,
      verdict: "weak",
      feedback: "",
      gaps: [],
      followUpQuestion: "模型追问"
    });
    expect(step).toEqual({ action: "follow_up", followUpQuestion: "模型追问" });

    applyAnswer(session, "不知道", { score: 2, verdict: "weak", feedback: "", gaps: [] , followUpQuestion: "模型追问"}, step);
    expect(session.followUpDepth).toBe(1);
    expect(session.currentIndex).toBe(0);
    expect(session.transcript.at(-1)).toMatchObject({ role: "interviewer", kind: "follow_up", content: "模型追问" });
  });

  it("falls back to authored followUps and caps follow-up depth", () => {
    const session = createInterviewSession({
      repoFullName: "o/r",
      understanding: makeUnderstanding(),
      questions: [question("q1", "medium", ["默认追问"]), question("q2", "hard")]
    });

    const first = decideNextStep(session, { score: 1, verdict: "weak", feedback: "", gaps: [] });
    expect(first).toEqual({ action: "follow_up", followUpQuestion: "默认追问" });
    applyAnswer(session, "嗯", { score: 1, verdict: "weak", feedback: "", gaps: [] }, first);

    const second = decideNextStep(session, { score: 1, verdict: "weak", feedback: "", gaps: [] });
    expect(second).toEqual({ action: "next" });
  });

  it("advances on strong answers and finishes after the last question", () => {
    const session = createInterviewSession({
      repoFullName: "o/r",
      understanding: makeUnderstanding(),
      questions: [question("q1", "medium"), question("q2", "hard")]
    });

    const step1 = decideNextStep(session, { score: 5, verdict: "strong", feedback: "", gaps: [] });
    expect(step1).toEqual({ action: "next" });
    applyAnswer(session, "答案1", { score: 5, verdict: "strong", feedback: "", gaps: [] }, step1);
    expect(session.currentIndex).toBe(1);

    const step2 = decideNextStep(session, { score: 4, verdict: "ok", feedback: "", gaps: [] });
    expect(step2).toEqual({ action: "finish" });
    applyAnswer(session, "答案2", { score: 4, verdict: "ok", feedback: "", gaps: [] }, step2);
    expect(session.finished).toBe(true);
    expect(session.evaluations.length).toBe(2);
  });

  it("stores and retrieves sessions by id", () => {
    const session = createInterviewSession({
      repoFullName: "o/r",
      understanding: makeUnderstanding(),
      questions: [question("q1", "medium")]
    });
    expect(getInterviewSession(session.id)?.id).toBe(session.id);
    expect(getInterviewSession("missing")).toBeUndefined();
  });
});
