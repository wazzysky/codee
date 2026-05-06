---
name: repo-lens-dev
description: Use this skill when implementing or modifying Repo Lens, a TypeScript monorepo for repository scanning, codebase explanation, file mapping, knowledge matching, VS Code integration, and MCP tools.
---

# Repo Lens Development Skill

## Purpose

Use this skill to implement features for Repo Lens.

Repo Lens is a repository understanding tool. It should produce reliable, evidence-based explanations of codebases.

The core principle is:

```text
rules provide facts
AST/LSP provides structure
search provides recall
LLM provides explanation
database provides cache
UI provides interaction
```

---

## Required Workflow

Before making code changes:

- Read `AGENTS.md`.
- Read `docs/architecture.md`.
- Identify the package that owns the change.
- Avoid duplicating logic across packages.
- Define the expected input/output shape.
- Add or update tests.
- Implement the smallest complete version.
- Run tests.
- Summarize changed files, behavior, and limitations.

---

## Package Ownership

### `packages/core`

Put these here:

- scanner
- language detector
- project detector
- file role inference
- symbol extractor
- dependency extractor
- SQLite index
- knowledge matcher
- retriever
- prompt context builder

### `packages/cli`

Put these here:

- command parsing
- terminal output
- JSON/Markdown formatting
- user-facing error messages

Do not put scanning or parsing logic here.

### `packages/vscode-extension`

Put these here:

- VS Code commands
- TreeView providers
- Webview providers
- progress notifications
- output channel

Do not duplicate core logic.

### `packages/mcp-server`

Put these here:

- MCP tools
- MCP resources
- path sandboxing
- `zod` schemas for MCP arguments

Do not duplicate core logic.

---

## Implementation Rules

Use:

- TypeScript strict mode
- `zod` for schemas
- `vitest` for tests
- deterministic outputs
- stable sorting for lists
- explicit diagnostics for partial failures

Avoid:

- hidden global state
- silent failures
- real LLM calls in tests
- executing target repository code
- sending sensitive files to LLMs
- scanning huge binary/model/data files by default

---

## Testing Rules

Every new module needs tests.

Minimum test cases:

- normal input
- empty input
- invalid input
- ignored files
- deterministic output
- error handling
- cross-platform paths when applicable

Use temporary directories or fixtures.

Do not depend on absolute local paths.

---

## Security Rules

When reading files:

- Resolve the path.
- Ensure it is inside the repository root.
- Reject path traversal.
- Skip sensitive files.
- Skip large/binary files unless explicitly enabled.

Never execute scanned repository scripts.

---

## LLM Rules

All LLM access must go through `LlmClient`.

Tests must use mock clients.

LLM output must be validated with `zod`.

LLM answers should include:

- evidence
- file paths
- confidence
- uncertainty

Do not present guesses as facts.

---

## Done Criteria

A task is complete only when:

- code compiles
- tests pass
- docs are updated if behavior changed
- examples/fixtures are updated when relevant
- CLI command is manually checked if applicable
- changed files and limitations are summarized
