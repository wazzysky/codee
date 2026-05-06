# Repolain v0.1.0

## 中文

Repolain 的首个公开版本。

## 亮点

- 已发布 CLI 包：`repolain`
- 已发布内部包：
  - `@repolain/core`
  - `@repolain/knowledge-base`
- 增加了带稳定文件元数据的仓库扫描能力
- 增加了对常见 Node.js、Python、CMake、ROS、Docker、Rust、Go 和 Java 工具链的项目识别
- 增加了 rule-based 文件地图生成，支持 Markdown 和 JSON 输出
- 增加了带 evidence 和 confidence 的 rule-based 知识点匹配
- 增加了可选 LLM adapter 和安全回退策略的文件解释
- 增加了基于文件 hash 做增量更新的 SQLite 索引存储

## 安装

```bash
npm install -g repolain
```

## 命令

```bash
repolain scan <path>
repolain summary <path>
repolain file-map <path>
repolain knowledge <path>
repolain explain <file>
repolain index <path>
```

## 说明

- `repolain explain <file> --ai` 需要：
  - `REPO_LENS_LLM_BASE_URL`
  - `REPO_LENS_LLM_API_KEY`
  - `REPO_LENS_LLM_MODEL`
- SQLite 索引当前依赖系统中可用的 `sqlite3` 命令
- `v0.1.0` 还不包含符号提取、VS Code 集成和 MCP server 支持

## English

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
