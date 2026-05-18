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
- `repolain symbols <path>` 符号提取输出
- `repolain graph <path>` 文件级依赖图输出，支持 Mermaid
- `repolain search <path> <query>` 基于路径、文件角色、知识点、symbols、core symbol ranking、namespace graph、scope bindings、symbol references、symbol links、symbol calls、imports 和 dependency graph 的相关文件搜索
  - 如果检测到本地 SQLite 结构索引版本过旧，会自动回退到临时结构分析

当前结构分析优先尝试 Tree-sitter parser，在不可用或失败时自动回退到 regex parser。npm 全局安装 `repolain` 时默认不会额外安装这些原生 parser 依赖，因此开箱即用行为是稳定的 regex fallback；如果你需要更强的结构分析精度，可以在运行环境里额外安装 `tree-sitter`、`tree-sitter-python`、`tree-sitter-typescript`、`tree-sitter-javascript`、`tree-sitter-c`、`tree-sitter-cpp`。当前支持的结构分析语言包括：

- Python
- TypeScript / JavaScript
- C / C++

当前 `symbols` JSON 除了符号定义，也会输出：

- `references`：这个文件里调用/使用了哪些符号
- `exportBindings`：这个文件对外导出了哪些符号，以及是否来自 re-export
- `namespaces`：由 nested object export / namespace export 推导出的显式 namespace symbol graph
- `scopeBindings`：这个文件里当前可见的作用域绑定，例如 import、parameter、variable、implicit this/self
- `links`：这些引用进一步解析后，指向了哪个内部定义或外部依赖
- `referenceEdges`：显式的 symbol-to-symbol 引用边，覆盖 call、new、component、type 引用
- `calls`：基于引用解析出的 symbol-level call edges
- `coreSymbols`：结合 reference graph、call graph 和 namespace graph 计算出的核心符号排名，可用于 search/index 排序

当前 symbol link 解析会优先利用：

- imports/includes
- export/re-export 链
- namespace import 和 `export * as ...` 链
- `import type`、`export type`、`export { foo as default }`
- `export =`、`module.exports = Foo`、`module.exports = { default: Foo, named: bar }`、`exports.foo = bar`
- nested / computed CommonJS 导出，以及 namespace member linking，例如 `module.exports.nested = { createRunner }`、`exports["factory"] = fn`、`ObjectModule.nested.createRunner()`
- qualifier 上下文
- 局部变量类型提示，例如 `engine.start()`、`planner.step()`、`foo.run()`

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
node packages/cli/dist/bin.js symbols tests/fixtures/knowledge-demo
node packages/cli/dist/bin.js graph tests/fixtures/knowledge-demo
node packages/cli/dist/bin.js search tests/fixtures/knowledge-demo EKF
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
repolain symbols <path>
repolain symbols <path> --json
repolain graph <path>
repolain graph <path> --json
repolain graph <path> --mermaid
repolain search <path> <query>
repolain search <path> <query> --json
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
- `repolain symbols <path>` symbol extraction output
- `repolain graph <path>` file-level dependency graph output with Mermaid support
- `repolain search <path> <query>` repository search using paths, file roles, knowledge matches, symbols, core symbol ranking, namespace graph, scope bindings, symbol references, symbol links, symbol calls, imports, and dependency graph hints
  - If the persisted SQLite structure index is stale, search automatically falls back to temporary structure analysis.

Structure analysis now prefers Tree-sitter parsers and automatically falls back to regex parsers when Tree-sitter is unavailable or fails. The published npm CLI does not install those native parser packages by default, so the out-of-the-box behavior is stable regex fallback; if you want higher-accuracy native parsing, install `tree-sitter`, `tree-sitter-python`, `tree-sitter-typescript`, `tree-sitter-javascript`, `tree-sitter-c`, and `tree-sitter-cpp` in the runtime environment. Current structure-aware languages:

- Python
- TypeScript / JavaScript
- C / C++

The `symbols` JSON output now includes:

- `references`, representing which symbols are called or used inside each file
- `exportBindings`, representing which symbols the file exports and whether they come from a re-export chain
- `namespaces`, representing an explicit namespace symbol graph derived from nested object exports and namespace exports
- `scopeBindings`, representing visible scope bindings such as imports, parameters, variables, and implicit `this/self`
- `links`, representing where those references resolve, such as internal symbol definitions or external dependencies
- `referenceEdges`, representing explicit symbol-to-symbol reference edges across files
- `calls`, representing symbol-level call edges derived from resolved references
- `coreSymbols`, a core-symbol ranking derived from the reference graph, call graph, and namespace graph for search/index ranking

Symbol link resolution now prioritizes:

- imports/includes
- export/re-export chains
- namespace imports and `export * as ...` chains
- `import type`, `export type`, and `export { foo as default }`
- `export =`, `module.exports = Foo`, `module.exports = { default: Foo, named: bar }`, and `exports.foo = bar`
- nested/computed CommonJS exports and namespace member linking such as `module.exports.nested = { createRunner }`, `exports["factory"] = fn`, and `ObjectModule.nested.createRunner()`
- qualifier context
- local variable type hints such as `engine.start()`, `planner.step()`, and `foo.run()`

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
node packages/cli/dist/bin.js symbols tests/fixtures/knowledge-demo
node packages/cli/dist/bin.js graph tests/fixtures/knowledge-demo
node packages/cli/dist/bin.js search tests/fixtures/knowledge-demo EKF
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
repolain symbols <path>
repolain symbols <path> --json
repolain graph <path>
repolain graph <path> --json
repolain graph <path> --mermaid
repolain search <path> <query>
repolain search <path> <query> --json
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
