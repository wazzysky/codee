# AGENTS.md

## Project Overview

This repository implements **Repolain**, a repository understanding tool.

Repolain scans a codebase, identifies its languages and framework/toolchain, builds structural indexes, explains project and file roles, maps files to knowledge points, and supports codebase Q&A.

The product should evolve in this order:

1. CLI core
2. Repository scanner
3. Project detector
4. File map generator
5. Markdown report exporter
6. SQLite index
7. Symbol extraction
8. Knowledge-point matcher
9. LLM-assisted explanation
10. VS Code extension
11. MCP server

The first usable target is a CLI that can generate a high-quality `repo-summary.md`.

---

## Architecture Rules

The repository should be organized as a pnpm monorepo.

Expected structure:

```text
packages/
  core/              # scanning, detecting, parsing, indexing, knowledge matching
  cli/               # command-line interface only
  vscode-extension/  # VS Code integration only
  mcp-server/        # MCP wrapper only
  knowledge-base/    # built-in knowledge point definitions
docs/
  architecture.md
  roadmap.md
  prompts.md
examples/
  simple-python/
  simple-cpp/
  ros2-demo/
tests/
```

Rules:

- Core logic must live in `packages/core`.
- CLI must only parse arguments, call core APIs, and format output.
- VS Code extension must not duplicate scanner/parser/indexer logic.
- MCP server must wrap core APIs instead of reimplementing them.
- LLM calls must go through a provider-agnostic `LlmClient` interface.
- Tests must never call real LLM APIs.
- Repository scanning must never execute code from the target repository.
- Avoid large rewrites unless explicitly requested.

---

## Language and Tooling

Use:

- TypeScript
- pnpm workspace
- strict TypeScript
- vitest for tests
- commander for CLI
- fast-glob for file scanning
- zod for input/output validation
- SQLite for persistent index
- Tree-sitter or equivalent parsers for symbol extraction in later stages

Preferred commands:

```bash
pnpm install
pnpm build
pnpm test
pnpm lint
```

If a command does not exist yet, add it when introducing the relevant package.

---

## Security Rules

Repolain reads arbitrary repositories, so safety matters.

Never:

- Execute target repository scripts during scan.
- Read files outside the repository root.
- Follow symlinks outside the repository root unless explicitly enabled.
- Send secrets to LLM providers.
- Log API keys, tokens, certificates, private keys, or `.env` contents.

Default ignored paths:

```text
.git
node_modules
dist
build
out
coverage
__pycache__
.venv
venv
.cache
.next
.nuxt
target
*.bag
*.pt
*.pth
*.onnx
*.bin
*.zip
*.tar
*.tar.gz
```

Default sensitive files:

```text
.env
.env.*
*.pem
*.key
*.crt
id_rsa
id_ed25519
credentials.*
secrets.*
```

---

## MVP Scope

Current MVP:

- `repolain scan <path>`
- `repolain summary <path>`
- `repolain file-map <path>`
- `repolain explain <file>`
- `repolain knowledge <path>`
- `repolain export <path> --format markdown`

MVP output should include:

- Project type
- Language statistics
- Framework/toolchain detection
- Suspected generator/template
- Directory roles
- Important files
- File role explanations
- Entry point candidates
- Basic knowledge-point matches
- Uncertainties and evidence

Out of scope for MVP:

- Full automatic code modification
- Full semantic type analysis
- Complete call graph
- Support for every programming language
- Complex Webview UI
- Cloud sync
- Team collaboration features

---

## Coding Standards

- Use explicit TypeScript types.
- Validate external inputs with `zod`.
- Prefer pure functions in `packages/core`.
- Keep side effects at the CLI/service boundary.
- Add tests for every new module.
- Add fixtures for scanners, detectors, and parsers.
- Public functions should have clear interfaces.
- Error messages should be actionable.
- Avoid silently swallowing errors; return diagnostics where appropriate.

---

## Testing Requirements

For every feature, include tests for:

- normal case
- empty input
- invalid path/input
- ignored files
- platform-independent paths
- deterministic output
- error handling

Do not use real API keys in tests.

Use mock LLM clients for AI-related tests.

---

## Output Style

CLI output should support:

- JSON for machine use
- Markdown for human reports
- concise terminal summaries

All AI-generated conclusions should include:

- confidence
- evidence
- uncertainty when applicable
- source file paths

Do not present guesses as facts.

---

## Completion Criteria

A task is not complete until:

- Code builds.
- Tests pass.
- New behavior is documented.
- Relevant examples or fixtures are updated.
- CLI output is manually sanity-checked when applicable.
- Security assumptions are preserved.

When implementing a task, summarize:

- changed files
- new commands
- tests added
- limitations
- next recommended task
