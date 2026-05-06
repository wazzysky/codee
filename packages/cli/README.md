# repolain

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
