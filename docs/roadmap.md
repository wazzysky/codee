# Repolain Roadmap

## Phase 0: Documentation and Project Constraints

Deliverables:

- `AGENTS.md`
- `docs/architecture.md`
- `docs/roadmap.md`
- `docs/prompts.md`
- `.agents/skills/repolain-dev/SKILL.md`

Acceptance:

- Codex can understand the project scope.
- Scope boundaries are clear.
- Security rules are documented.

---

## Phase 1: CLI Skeleton and Scanner

Commands:

```bash
repolain scan <path>
```

Deliverables:

- pnpm monorepo
- `packages/core`
- `packages/cli`
- `scanRepository()`
- language detection
- hash calculation
- line counting
- ignored path handling
- JSON output
- tests

Acceptance:

- scans simple fixture repositories
- ignores common generated folders
- deterministic output
- tests pass

---

## Phase 2: Project Detector

Commands:

```bash
repolain summary <path>
```

Deliverables:

- `package.json` detection
- `pyproject.toml` / `requirements.txt` detection
- CMake detection
- ROS / ROS2 package detection
- Docker detection
- GitHub Actions detection
- entry candidate detection
- evidence and confidence

Acceptance:

- can classify simple Python, Node, C++, and ROS-like projects
- output includes uncertainty when needed

---

## Phase 3: File Map

Commands:

```bash
repolain file-map <path>
```

Deliverables:

- directory grouping
- file role inference
- important file ranking
- Markdown output

Acceptance:

- produces useful file map without LLM
- marks uncertain files

---

## Phase 4: LLM Adapter

Commands:

```bash
repolain explain <file> --ai
```

Deliverables:

- `LlmClient` interface
- OpenAI-compatible adapter
- mock adapter
- `zod` validation
- file explanation prompt
- fallback rule-based explanation

Acceptance:

- tests use mock client only
- no real API dependency
- no crash when LLM env is absent

---

## Phase 5: Index Store

Commands:

```bash
repolain index <path>
```

Deliverables:

- SQLite schema
- file index
- symbol table placeholder
- FTS search
- incremental update by hash

Acceptance:

- creates `.repolain/index.sqlite`
- unchanged files are skipped
- query APIs work

---

## Phase 6: Symbol Extraction

Commands:

```bash
repolain symbols <path>
```

Deliverables:

- imports/includes extraction
- function/class extraction
- entry hints
- diagnostics on parse failure

Acceptance:

- supports Python, TypeScript/JavaScript, and C/C++ initially
- parse failure does not abort whole scan

---

## Phase 7: Knowledge Matching

Commands:

```bash
repolain knowledge <path>
```

Deliverables:

- built-in knowledge base
- rule-based matcher
- confidence scoring
- evidence list
- Markdown table

Acceptance:

- detects PID, EKF, A*, RRT, ROS Node, Sensor Fusion, SLAM, and Trajectory Planning in fixture code

---

## Phase 8: Codebase QA

Commands:

```bash
repolain ask "question"
```

Deliverables:

- FTS retrieval
- context builder
- LLM answer generation
- citation by file path
- no-LLM fallback with relevant files

Acceptance:

- answers include evidence files
- uncertainty is explicit

---

## Phase 9: VS Code Extension

Deliverables:

- command: `Scan Workspace`
- command: `Show Project Summary`
- command: `Explain Current File`
- sidebar file map
- output channel
- progress UI

Acceptance:

- extension works in Extension Development Host
- does not scan automatically on activation

---

## Phase 10: MCP Server

Deliverables:

- `scan_repository` tool
- `get_project_summary` tool
- `explain_file` tool
- `get_file_map` resource
- `knowledge_map` resource
- path sandboxing

Acceptance:

- AI agents can call Repolain through MCP
- no file access outside repo root
