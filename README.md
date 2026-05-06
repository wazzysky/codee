# Repolain

Repolain is a CLI-first repository understanding tool.

## Install

After publishing, users can install the CLI with:

```bash
npm install -g repolain
```

## Current Phase

Phase 2 currently provides:

- pnpm monorepo scaffold
- `packages/core` repository scanner
- `packages/cli` command entry
- `repolain scan <path>` JSON output
- `repolain summary <path>` project detection JSON output
- `repolain file-map <path>` Markdown or JSON file map output
- `repolain knowledge <path>` Markdown or JSON knowledge matching output
- `repolain explain <file>` rule-based or AI-assisted file explanation
- `repolain index <path>` SQLite index builder and summary output

## Usage

```bash
corepack pnpm install
corepack pnpm build
corepack pnpm test
corepack pnpm pack:cli
node packages/cli/dist/bin.js scan examples/simple-python
node packages/cli/dist/bin.js summary tests/fixtures/node-react-vite
node packages/cli/dist/bin.js file-map tests/fixtures/file-map-demo
node packages/cli/dist/bin.js file-map tests/fixtures/file-map-demo --json
node packages/cli/dist/bin.js knowledge tests/fixtures/knowledge-demo
node packages/cli/dist/bin.js knowledge tests/fixtures/knowledge-demo --json
node packages/cli/dist/bin.js explain tests/fixtures/knowledge-demo/src/ros_node.py
node packages/cli/dist/bin.js explain tests/fixtures/knowledge-demo/src/ros_node.py --ai
node packages/cli/dist/bin.js index tests/fixtures/knowledge-demo
```

## Commands

```bash
repolain scan <path>
repolain summary <path>
repolain file-map <path>
repolain file-map <path> --json
repolain knowledge <path>
repolain knowledge <path> --json
repolain explain <file>
repolain explain <file> --ai
repolain index <path>
```

## LLM Environment

`repolain explain <file> --ai` will try to build an OpenAI-compatible client from:

```bash
REPO_LENS_LLM_BASE_URL
REPO_LENS_LLM_API_KEY
REPO_LENS_LLM_MODEL
```

If any of them are missing, Repolain will print a clear fallback diagnostic and use the rule-based explanation instead.

## Packaging

To create a local installable CLI tarball:

```bash
corepack pnpm pack:cli
```

For the full publishing workflow, see:

- [docs/publishing.md](/home/xhn/Projects/codee/docs/publishing.md:1)
