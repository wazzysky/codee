# Repolain Architecture

## 1. Goal

Repolain is a repository understanding engine.

It should answer:

- What is this repository?
- What languages and frameworks does it use?
- What toolchain or generator may have produced it?
- How is it built, run, and tested?
- What does each directory do?
- What does each important file do?
- Where are the entry points?
- Which files are related to specific knowledge points?
- Which files are relevant to a natural-language question?

The first version should be a CLI-first tool. VS Code and MCP integrations should wrap the core engine later.

---

## 2. Product Shape

Recommended shape:

```text
CLI Core + VS Code Extension + Optional MCP Server
```

The CLI is the foundation.

The VS Code extension should provide:

- sidebar project overview
- file map tree
- current file explanation
- knowledge-point view
- ask-codebase panel

The MCP server should expose Repolain to AI agents.

---

## 3. Data Flow

```text
Repository
  ↓
File scanner
  ↓
Language and project detector
  ↓
Static structure parser
  ↓
Index store
  ↓
Knowledge matcher
  ↓
Retriever
  ↓
LLM summarizer / QA
  ↓
CLI / VS Code / MCP
```

---

## 4. Package Responsibilities

### `packages/core`

Owns:

- file scanning
- language detection
- project detection
- file role inference
- symbol extraction
- dependency extraction
- index storage
- knowledge matching
- retrieval
- prompt context construction

Must not own:

- terminal formatting
- VS Code UI
- MCP protocol code

### `packages/cli`

Owns:

- command parsing
- terminal output
- markdown export command wiring

Must not duplicate core logic.

### `packages/vscode-extension`

Owns:

- VS Code command registration
- tree views
- webviews if needed
- progress UI
- output channel

Must call core or CLI.

### `packages/mcp-server`

Owns:

- MCP tools
- MCP resources
- zod schemas for MCP input
- path sandboxing

Must call core.

---

## 5. Main Modules

### Scanner

Input:

```ts
scanRepository(rootPath: string, options?: ScanOptions): Promise<ScanResult>
```

Output:

- files
- language stats
- ignored paths
- diagnostics

### Project Detector

Input:

```ts
detectProject(rootPath: string, files: RepoFile[]): Promise<ProjectDetection>
```

Output:

- project types
- frameworks
- build tools
- suspected generator
- entry candidates
- evidence
- confidence

### File Map

Input:

```ts
generateFileMap(scanResult: ScanResult): FileMap
```

Output:

- directory groups
- file roles
- important files
- uncertainty flags

### Symbol Extractor

Input:

```ts
analyzeFileStructure(file: RepoFile, content: string): FileAnalysis
```

Output:

- imports/includes
- classes
- functions
- methods
- entry hints
- diagnostics

### Knowledge Matcher

Input:

```ts
matchKnowledge(
  fileAnalysis: FileAnalysis,
  knowledgeBase: KnowledgePoint[]
): KnowledgeMatch[]
```

Output:

- knowledge point id
- name
- domain
- confidence
- evidence

### LLM Layer

All LLM calls go through:

```ts
interface LlmClient {
  completeText(input: LlmTextRequest): Promise<LlmTextResponse>;
  completeJson<T>(input: LlmJsonRequest<T>): Promise<T>;
}
```

Real providers and mock clients must implement this interface.

---

## 6. Database

Use SQLite first.

Tables:

- files
- symbols
- dependencies
- knowledge_points
- file_knowledge
- file_search

Vector search can be added later.

---

## 7. Safety

Repolain must not execute scanned code.

Default behavior:

- read text files only
- ignore secrets
- ignore huge binary/model/data files
- avoid sending full source to LLM unless explicitly requested

---

## 8. MVP Definition

MVP is complete when these commands work:

```bash
repolain scan .
repolain summary .
repolain file-map .
repolain explain src/main.cpp
repolain knowledge .
repolain export . --format markdown
```

The tool should work on:

- small Python project
- small C++ project
- simple TypeScript project
- simple ROS/ROS2-like project

---

## 9. Design Principle

Facts should come from deterministic analysis.

Use:

- rules for factual detection
- AST/LSP for structure
- embeddings for retrieval
- LLM for explanation
- database for cache
- UI only for interaction
