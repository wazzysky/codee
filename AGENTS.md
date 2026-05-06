# AGENTS.md

## 中文

### 项目概览

这个仓库实现的是 **Repolain**，一个代码仓库理解工具。

Repolain 会扫描代码仓库，识别语言、框架和工具链，构建结构化索引，解释项目与文件角色，把文件映射到知识点，并支持代码仓库问答。

产品建议按以下顺序演进：

1. CLI 核心
2. 仓库扫描器
3. 项目识别器
4. 文件地图生成器
5. Markdown 报告导出
6. SQLite 索引
7. 符号提取
8. 知识点匹配
9. LLM 辅助解释
10. VS Code 扩展
11. MCP server

第一个可用目标是一个可以生成高质量 `repo-summary.md` 的 CLI。

---

### 架构规则

仓库应组织为 pnpm monorepo。

期望结构：

```text
packages/
  core/              # 扫描、识别、解析、索引、知识匹配
  cli/               # 仅命令行接口
  vscode-extension/  # 仅 VS Code 集成
  mcp-server/        # 仅 MCP 封装
  knowledge-base/    # 内置知识点定义
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

规则：

- 核心逻辑必须放在 `packages/core`
- CLI 只负责解析参数、调用 core API 和格式化输出
- VS Code 扩展不得重复 scanner/parser/indexer 逻辑
- MCP server 必须包装 core API，而不是重写实现
- 所有 LLM 调用必须经过厂商无关的 `LlmClient` 接口
- 测试中绝不能调用真实 LLM API
- 仓库扫描绝不能执行被扫描仓库的代码
- 除非明确要求，否则避免大范围重写

---

### 语言与工具

使用：

- TypeScript
- pnpm workspace
- strict TypeScript
- vitest
- commander
- fast-glob
- zod
- SQLite
- 后续阶段使用 Tree-sitter 或等价解析器做符号提取

优先命令：

```bash
pnpm install
pnpm build
pnpm test
pnpm lint
```

如果某个命令还不存在，在引入相关 package 时一并补上。

---

### 安全规则

Repolain 会读取任意仓库，因此安全性很重要。

禁止：

- 在扫描过程中执行目标仓库脚本
- 读取仓库根目录之外的文件
- 在未显式启用时跟随指向仓库外的符号链接
- 把 secret 发送给 LLM provider
- 记录 API key、token、证书、私钥或 `.env` 内容

默认忽略路径：

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

默认敏感文件：

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

### MVP 范围

当前 MVP：

- `repolain scan <path>`
- `repolain summary <path>`
- `repolain file-map <path>`
- `repolain explain <file>`
- `repolain knowledge <path>`
- `repolain export <path> --format markdown`

MVP 输出应包括：

- 项目类型
- 语言统计
- 框架/工具链识别
- 可疑生成器/模板来源
- 目录角色
- 重要文件
- 文件角色解释
- 入口候选
- 基础知识点匹配
- uncertainties 与 evidence

MVP 不包括：

- 全自动代码修改
- 完整语义类型分析
- 完整调用图
- 所有编程语言支持
- 复杂 Webview UI
- 云同步
- 团队协作特性

---

### 编码规范

- 使用显式 TypeScript 类型
- 外部输入必须通过 `zod` 校验
- `packages/core` 优先采用纯函数
- 副作用尽量留在 CLI / service 边界
- 每个新模块都要补测试
- 为 scanner、detector、parser 添加 fixtures
- 对外函数必须有清晰接口
- 错误信息必须可操作
- 不要静默吞错；用 diagnostics 返回部分失败

---

### 测试要求

每个功能至少覆盖：

- 正常输入
- 空输入
- 非法路径/输入
- 忽略文件
- 跨平台路径
- 确定性输出
- 错误处理

测试中不要使用真实 API key。

AI 相关测试必须使用 mock LLM client。

---

### 输出风格

CLI 输出应支持：

- JSON，供机器使用
- Markdown，供人工阅读
- 简洁终端摘要

所有 AI 生成结论都应包含：

- confidence
- evidence
- 必要时给出 uncertainty
- 源文件路径

不要把猜测表达成事实。

---

### 完成标准

一个任务只有在满足以下条件后才算完成：

- 代码能构建
- 测试通过
- 新行为已文档化
- 相关示例或 fixtures 已更新
- 适用时已对 CLI 输出做手工 sanity check
- 安全假设未被破坏

实现任务时，最后应总结：

- 改动文件
- 新命令
- 新增测试
- 限制
- 推荐的下一步任务

## English

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
