export type { KnowledgePoint } from "@repolain/knowledge-base";
export { detectProject } from "./detectProject.js";
export { detectLanguage } from "./language.js";
export { explainFile } from "./explainFile.js";
export { generateFileMap } from "./generateFileMap.js";
export {
  createIndexStore,
  getFile,
  indexRepository,
  listFiles,
  listKnowledgeMatches,
  searchFiles,
  SQLiteIndexStore
} from "./indexStore.js";
export {
  createOpenAICompatibleLlmClientFromEnv,
  MockLlmClient,
  OpenAICompatibleLlmClient
} from "./llm.js";
export { matchKnowledge } from "./matchKnowledge.js";
export { scanRepository } from "./scanRepository.js";
export type {
  Diagnostic,
  DirectorySummary,
  ExplainFileOptions,
  ExplainMode,
  FileSearchResult,
  FileMap,
  FileMapFile,
  FileExplanation,
  FileRole,
  IndexedFileRecord,
  IndexSummary,
  KnowledgeMatch,
  KnowledgeOptions,
  KnowledgeResult,
  LlmClient,
  LlmJsonRequest,
  LlmTextRequest,
  LlmTextResponse,
  ProjectDetection,
  RepoFile,
  ScanOptions,
  ScanResult
} from "./types.js";
