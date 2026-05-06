# repolain

## 中文

Repolain 是一个以 CLI 为核心的代码仓库理解工具。

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
repolain explain <file> --ai
repolain index <path>
```

## LLM 环境变量

```bash
REPO_LENS_LLM_BASE_URL
REPO_LENS_LLM_API_KEY
REPO_LENS_LLM_MODEL
```

如果这些变量未配置，`repolain explain <file> --ai` 会回退到规则解释。

## English

Repolain is a CLI-first repository understanding tool.

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
repolain explain <file> --ai
repolain index <path>
```

## LLM Environment

```bash
REPO_LENS_LLM_BASE_URL
REPO_LENS_LLM_API_KEY
REPO_LENS_LLM_MODEL
```

If the variables are not configured, `repolain explain <file> --ai` falls back to the rule-based explanation.
