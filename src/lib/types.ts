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
  treeFiles: Array<{ path: string; size: number }>;
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
  source?: "repo" | "kaomian";
};

export type KaomianItem = {
  id: string;
  question: string;
  category: string;
  frequency: number;
  companies: string[];
  sourceFile: string;
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

export type AnalyzeMode = "survey" | "interview";

export type PipelineStage =
  | "scout"
  | "plan"
  | "research"
  | "synthesize"
  | "questions"
  | "interview_ready";

export type Confidence = "high" | "medium" | "low";

export type ResearchDimensionKey = "overview" | "method" | "training" | "evaluation" | "data";

export type ResearchPlanSummary = {
  analysisMode: AnalysisMode;
  techTags: string[];
  dimensions: Array<{ key: ResearchDimensionKey; goal: string; files: string[] }>;
};

export type DimensionDigest = {
  dimension: ResearchDimensionKey;
  summary: string;
  findings: Array<{ claim: string; evidence: string[]; confidence: Confidence }>;
  claimCodeLinks: Array<{ claim: string; code: string[]; experiments: string[] }>;
  askPoints: string[];
  openQuestions: string[];
  requestedFiles: string[];
};

export type SseEvent =
  | { type: "stage"; stage: PipelineStage; detail?: string }
  | { type: "plan"; plan: ResearchPlanSummary }
  | { type: "file_read"; path: string; dimension?: string }
  | { type: "finding"; dimension: string; claim: string; evidence: string[]; confidence: Confidence }
  | { type: "report_delta"; delta: string }
  | { type: "exam_point"; point: ExamPoint; index: number }
  | { type: "question"; question: InterviewQuestion; index: number; total?: number; source: "repo" | "kaomian" }
  | { type: "result"; result: AnalyzeResponse }
  | { type: "session"; sessionId: string; question: InterviewQuestion; index: number; total: number }
  | { type: "warning"; message: string }
  | { type: "error"; message: string }
  | { type: "done" };
