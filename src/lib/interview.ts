import { randomUUID } from "node:crypto";
import type {
  AnswerEvaluation,
  InterviewQuestion,
  InterviewSession,
  Understanding
} from "./types";

const MAX_MAIN_QUESTIONS = 8;
const MAX_FOLLOW_UP_DEPTH = 1;
const SESSION_TTL_MS = 3 * 60 * 60 * 1000;
const SESSION_CAP = 200;

// Next.js 会把不同 route 编译成独立 bundle，模块级 Map 会被实例化多份；
// 挂到 globalThis 保证单进程内 analyze 和 interview 两个路由共享同一个会话表。
const globalStore = globalThis as unknown as { __interviewSessions?: Map<string, InterviewSession> };
const sessions: Map<string, InterviewSession> = globalStore.__interviewSessions ?? new Map();
globalStore.__interviewSessions = sessions;

export function pickInterviewQuestions(questions: InterviewQuestion[], max = MAX_MAIN_QUESTIONS): InterviewQuestion[] {
  const warmup = questions.filter((question) => question.difficulty === "warmup");
  const medium = questions.filter((question) => question.difficulty === "medium");
  const hard = questions.filter((question) => question.difficulty === "hard");

  const picked = [...warmup.slice(0, 1), ...medium.slice(0, 3), ...hard.slice(0, 3)];
  if (picked.length < max) {
    for (const question of questions) {
      if (picked.length >= max) break;
      if (!picked.includes(question)) picked.push(question);
    }
  }
  return picked.slice(0, max);
}

export function createInterviewSession(args: {
  repoFullName: string;
  understanding: Understanding;
  questions: InterviewQuestion[];
}): InterviewSession {
  evictStaleSessions();
  const mainQuestions = pickInterviewQuestions(args.questions);
  const session: InterviewSession = {
    id: randomUUID(),
    createdAt: Date.now(),
    repoFullName: args.repoFullName,
    understanding: args.understanding,
    questions: mainQuestions,
    currentIndex: 0,
    followUpDepth: 0,
    transcript: [],
    evaluations: [],
    finished: mainQuestions.length === 0,
    busy: false
  };
  if (mainQuestions.length > 0) {
    session.transcript.push({
      role: "interviewer",
      kind: "question",
      content: mainQuestions[0].question,
      questionIndex: 0
    });
  }
  sessions.set(session.id, session);
  return session;
}

export function getInterviewSession(id: string): InterviewSession | undefined {
  const session = sessions.get(id);
  if (!session) return undefined;
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    sessions.delete(id);
    return undefined;
  }
  return session;
}

export function restoreInterviewSession(snapshot: InterviewSession): InterviewSession {
  evictStaleSessions();
  const session: InterviewSession = {
    ...snapshot,
    busy: false,
    transcript: [...snapshot.transcript],
    evaluations: [...snapshot.evaluations],
    questions: [...snapshot.questions]
  };
  sessions.set(session.id, session);
  return session;
}

export type NextStep =
  | { action: "follow_up"; followUpQuestion: string }
  | { action: "next" }
  | { action: "finish" };

export function decideNextStep(session: InterviewSession, evaluation: AnswerEvaluation): NextStep {
  const current = session.questions[session.currentIndex];
  if (current && evaluation.verdict === "weak" && session.followUpDepth < MAX_FOLLOW_UP_DEPTH) {
    const followUpQuestion =
      evaluation.followUpQuestion?.trim() || current.followUps[session.followUpDepth] || "";
    if (followUpQuestion) return { action: "follow_up", followUpQuestion };
  }
  if (session.currentIndex + 1 < session.questions.length) return { action: "next" };
  return { action: "finish" };
}

export function applyAnswer(
  session: InterviewSession,
  answer: string,
  evaluation: AnswerEvaluation,
  step: NextStep
): void {
  session.transcript.push({
    role: "candidate",
    kind: "answer",
    content: answer,
    questionIndex: session.currentIndex
  });
  session.evaluations.push({ ...evaluation, questionIndex: session.currentIndex });

  if (step.action === "follow_up") {
    session.followUpDepth += 1;
    session.transcript.push({
      role: "interviewer",
      kind: "follow_up",
      content: step.followUpQuestion,
      questionIndex: session.currentIndex
    });
    return;
  }
  if (step.action === "next") {
    session.currentIndex += 1;
    session.followUpDepth = 0;
    session.transcript.push({
      role: "interviewer",
      kind: "question",
      content: session.questions[session.currentIndex].question,
      questionIndex: session.currentIndex
    });
    return;
  }
  session.finished = true;
}

export function currentQuestionText(session: InterviewSession): string {
  for (let i = session.transcript.length - 1; i >= 0; i--) {
    const turn = session.transcript[i];
    if (turn.role === "interviewer") return turn.content;
  }
  return session.questions[session.currentIndex]?.question ?? "";
}

function evictStaleSessions(): void {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL_MS) sessions.delete(id);
  }
  if (sessions.size >= SESSION_CAP) {
    const oldest = [...sessions.values()].sort((a, b) => a.createdAt - b.createdAt)[0];
    if (oldest) sessions.delete(oldest.id);
  }
}
