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
  category: ResearchArtifactKind | "other";
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
  analysisMode: AnalysisMode;
  paperSignals: PaperSignals;
  researchArtifacts: ResearchArtifacts;
  warnings: string[];
};

export type AnalysisMode = "paper-code" | "general-code" | "unknown";

export type ResearchArtifactKind =
  | "paperDocs"
  | "methodFiles"
  | "trainingFiles"
  | "evaluationFiles"
  | "configFiles"
  | "dataFiles"
  | "demoFiles"
  | "scripts";

export type PaperSignals = {
  venues: string[];
  paperLinks: string[];
  citationFound: boolean;
  officialImplementation: boolean;
  benchmarkSignals: string[];
  trainingSignals: string[];
  evaluationSignals: string[];
  methodSignals: string[];
};

export type ResearchArtifacts = Record<ResearchArtifactKind, string[]>;

export type PaperCodeMapItem = {
  claim: string;
  codeEvidence: string[];
  experimentEvidence: string[];
  interviewRisk: string;
};

export type Understanding = {
  analysisMode: AnalysisMode;
  paperSignals: PaperSignals;
  summary: string;
  problemSetting: string;
  paperClaims: string[];
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
  reproductionRecipe: string[];
  methodCodeMap: string[];
  experimentEvidence: string[];
  keyHyperparameters: string[];
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
  analysisMode: AnalysisMode;
  paperSignals: PaperSignals;
  researchArtifacts: ResearchArtifacts;
  paperCodeMap: PaperCodeMapItem[];
  understanding: Understanding;
  examPoints: ExamPoint[];
  questions: InterviewQuestion[];
  markdownReport: string;
  evidenceFiles: EvidenceFile[];
  warnings: string[];
};
