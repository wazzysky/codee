# Repolain

## 中文

Repolain 是一个以 CLI 为核心的代码仓库理解工具。

公开 npm 包：

- `repolain`

## 安装

发布后，用户可以直接安装 CLI：

```bash
npm install -g repolain
```

在一台新机器上首次发布 npm 包前，先执行：

```bash
npm login
npm whoami
```

## 当前能力

当前版本提供：

- pnpm monorepo 工程骨架
- `packages/core` 仓库扫描核心
- `packages/cli` 命令行入口
- `repolain scan <path>` JSON 扫描输出
- `repolain summary <path>` 项目识别 JSON 输出
- `repolain file-map <path>` Markdown 或 JSON 文件地图输出
- `repolain knowledge <path>` Markdown 或 JSON 知识点匹配输出
- `repolain explain <file>` 规则解释或 AI 辅助解释
- `repolain index <path>` SQLite 索引构建与摘要输出

## 使用方式

```bash
corepack pnpm install
corepack pnpm build
corepack pnpm test
corepack pnpm pack:cli
corepack pnpm publish:dry-run
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

## 命令

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

## LLM 环境变量

`repolain explain <file> --ai` 会尝试从以下环境变量构造 OpenAI-compatible client：

```bash
REPO_LENS_LLM_BASE_URL
REPO_LENS_LLM_API_KEY
REPO_LENS_LLM_MODEL
```

如果其中任一变量缺失，Repolain 会输出明确的回退诊断信息，并自动使用 rule-based 解释。

## 打包与发布

生成本地可安装的 CLI tarball：

```bash
corepack pnpm pack:cli
```

在不真正上传的情况下验证发布打包链路：

```bash
corepack pnpm publish:dry-run
```

完整发布流程见：

- [docs/publishing.md](/home/xhn/Projects/codee/docs/publishing.md:1)

`v0.1.0` 的 GitHub Release 文案见：

- [docs/release-v0.1.0.md](/home/xhn/Projects/codee/docs/release-v0.1.0.md:1)

## English

Repolain is a CLI-first repository understanding tool.

Public npm package:

- `repolain`

## Install

After publishing, users can install the CLI with:

```bash
npm install -g repolain
```

Before the first npm release on a new machine:

```bash
npm login
npm whoami
```

## Current Capabilities

Current release provides:

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
corepack pnpm publish:dry-run
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

To validate publish packaging without uploading anything:

```bash
corepack pnpm publish:dry-run
```

For the full publishing workflow, see:

- [docs/publishing.md](/home/xhn/Projects/codee/docs/publishing.md:1)

For the `v0.1.0` GitHub release notes, see:

- [docs/release-v0.1.0.md](/home/xhn/Projects/codee/docs/release-v0.1.0.md:1)
