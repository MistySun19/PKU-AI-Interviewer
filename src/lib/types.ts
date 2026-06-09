export type RepoInfo = {
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  htmlUrl: string;
  description: string | null;
  language: string | null;
  stars: number;
  fileCount: number;
};

export type EvidenceFile = {
  path: string;
  size: number;
  score: number;
  reason: string;
  truncated: boolean;
};

export type RepoFileContent = EvidenceFile & {
  content: string;
};

export type RepoContext = {
  repo: RepoInfo;
  readme: string;
  files: RepoFileContent[];
  warnings: string[];
};

export type Understanding = {
  summary: string;
  techStack: string[];
  entryPoints: string[];
  coreModules: Array<{
    name: string;
    responsibility: string;
    evidence: string[];
  }>;
  mainFlow: string[];
  dataFlow: string[];
  evaluationSignals: string[];
  deploymentNotes: string[];
  contributionHypotheses: string[];
};

export type ExamPoint = {
  title: string;
  riskLevel: "low" | "medium" | "high";
  evidence: string[];
  whyAsk: string;
  followUps: string[];
};

export type InterviewQuestion = {
  question: string;
  difficulty: "warmup" | "medium" | "hard";
  evidence: string[];
  whyAsk: string;
  expectedAnswer: string[];
  redFlags: string[];
  followUps: string[];
};

export type AnalyzeResponse = {
  repo: RepoInfo;
  understanding: Understanding;
  examPoints: ExamPoint[];
  questions: InterviewQuestion[];
  markdownReport: string;
  evidenceFiles: EvidenceFile[];
  warnings: string[];
};
