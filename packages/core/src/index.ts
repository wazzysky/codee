export type { KnowledgePoint } from "@repolain/knowledge-base";
export { analyzeFileStructure, extractRepositorySymbols } from "./analyzeFileStructure.js";
export { buildDependencyGraph } from "./buildDependencyGraph.js";
export { buildSymbolLinks } from "./buildSymbolLinks.js";
export { detectProject } from "./detectProject.js";
export { detectLanguage } from "./language.js";
export { explainFile } from "./explainFile.js";
export { generateFileMap } from "./generateFileMap.js";
export { createStructureParserRegistry, StructureParserRegistry } from "./structureParserRegistry.js";
export {
  createIndexStore,
  getFile,
  indexRepository,
  listDependencies,
  listFiles,
  listKnowledgeMatches,
  listSymbolLinks,
  listSymbolReferences,
  listSymbols,
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
export { searchRepository } from "./searchRepository.js";
export type {
  DependencyGraph,
  DependencyGraphEdge,
  DependencyGraphNode,
  DependencyKind,
  DependencyResolution,
  Diagnostic,
  DirectorySummary,
  EntryHint,
  ExplainFileOptions,
  ExplainMode,
  FileAnalysis,
  FileSearchResult,
  FileMap,
  FileMapFile,
  FileExplanation,
  FileRole,
  IndexedFileRecord,
  IndexSummary,
  ImportBinding,
  ImportBindingKind,
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
  ScanResult,
  StructureParseInput,
  StructureParser,
  SymbolLink,
  SymbolLinkGraph,
  SymbolLinkResolution,
  SymbolReference,
  SymbolReferenceKind,
  SymbolDefinition,
  SymbolExtractionResult,
  SymbolKind,
  VariableTypeHint
} from "./types.js";
