# Repolain v0.1.0

Initial public release of Repolain.

## Highlights

- Published CLI package: `repolain`
- Published internal packages:
  - `@repolain/core`
  - `@repolain/knowledge-base`
- Added repository scanning with deterministic file metadata
- Added project detection for common Node.js, Python, CMake, ROS, Docker, Rust, Go, and Java toolchains
- Added rule-based file map generation with Markdown and JSON output
- Added rule-based knowledge matching with evidence and confidence
- Added file explanation with optional LLM adapter and safe fallback behavior
- Added SQLite index storage with incremental update by file hash

## Install

```bash
npm install -g repolain
```

## Commands

```bash
repolain scan <path>
repolain summary <path>
repolain file-map <path>
repolain knowledge <path>
repolain explain <file>
repolain index <path>
```

## Notes

- `repolain explain <file> --ai` requires:
  - `REPO_LENS_LLM_BASE_URL`
  - `REPO_LENS_LLM_API_KEY`
  - `REPO_LENS_LLM_MODEL`
- SQLite indexing currently depends on the system `sqlite3` command being available
- Symbol extraction, VS Code integration, and MCP server support are not included in `v0.1.0`
