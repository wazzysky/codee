export type DiagnosticLevel = "info" | "warning" | "error";

export interface Diagnostic {
  level: DiagnosticLevel;
  message: string;
  path?: string;
}

export interface RepoFile {
  path: string;
  absPath: string;
  language: string;
  size: number;
  lineCount: number;
  hash: string;
}

export interface ScanOptions {
  ignore?: string[];
}

export interface ScanResult {
  root: string;
  files: RepoFile[];
  languageStats: Record<string, number>;
  diagnostics: Diagnostic[];
}

export interface ProjectDetection {
  projectTypes: string[];
  languages: string[];
  frameworks: string[];
  buildTools: string[];
  generatedBy: string[];
  entryCandidates: string[];
  confidence: number;
  evidence: string[];
  uncertainties: string[];
}

export type FileRole =
  | "entrypoint"
  | "config"
  | "test"
  | "source"
  | "component"
  | "utility"
  | "documentation"
  | "build"
  | "script"
  | "asset"
  | "generated"
  | "unknown";

export interface FileMapFile {
  path: string;
  directory: string;
  role: FileRole;
  explanation: string;
  confidence: number;
  important: boolean;
  language: string;
}

export interface DirectorySummary {
  path: string;
  description: string;
  fileCount: number;
  roles: Partial<Record<FileRole, number>>;
  files: FileMapFile[];
}

export interface FileMap {
  root: string;
  directories: DirectorySummary[];
  files: FileMapFile[];
  importantFiles: FileMapFile[];
  uncertainties: string[];
}

export interface KnowledgeMatch {
  filePath: string;
  knowledgeId: string;
  name: string;
  domain: string;
  confidence: number;
  evidence: string[];
}

export interface KnowledgeOptions {
  maxFileSizeBytes?: number;
}

export interface KnowledgeResult {
  root: string;
  matches: KnowledgeMatch[];
  diagnostics: Diagnostic[];
}

export interface LlmTextRequest {
  systemPrompt?: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
}

export interface LlmTextResponse {
  text: string;
  model: string;
  raw?: unknown;
}

export interface LlmJsonRequest<T> extends LlmTextRequest {
  schema: {
    parse: (input: unknown) => T;
  };
}

export interface LlmClient {
  completeText(request: LlmTextRequest): Promise<LlmTextResponse>;
  completeJson<T>(request: LlmJsonRequest<T>): Promise<T>;
}

export type ExplainMode = "rule-based" | "ai";

export interface FileExplanation {
  filePath: string;
  repoRoot: string;
  mode: ExplainMode;
  summary: string;
  role: FileRole;
  keyEvidence: string[];
  possibleKnowledgePoints: string[];
  confidence: number;
  uncertainties: string[];
  diagnostics: Diagnostic[];
}

export interface ExplainFileOptions {
  useAi?: boolean;
  llmClient?: LlmClient;
  env?: NodeJS.ProcessEnv;
  maxLlmFileSizeBytes?: number;
}

export interface IndexedFileRecord {
  path: string;
  absPath: string;
  language: string;
  size: number;
  lineCount: number;
  hash: string;
  role?: string;
  explanation?: string;
  confidence?: number;
  important?: boolean;
}

export interface FileSearchResult {
  path: string;
  language: string;
  role?: string;
  explanation?: string;
  score: number;
}

export interface IndexSummary {
  root: string;
  dbPath: string;
  totalFiles: number;
  changedFiles: number;
  removedFiles: number;
  knowledgeMatchCount: number;
  diagnosticCount: number;
  projectTypes: string[];
}
