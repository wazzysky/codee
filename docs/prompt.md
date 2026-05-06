# Codex Prompts for Repolain

## Prompt Style

Each task should include:

1. Goal
2. Scope
3. Files/packages to modify
4. Required APIs
5. Tests
6. Acceptance criteria
7. Out-of-scope items

Avoid asking Codex to implement the entire product in one task.

---

## General Constraints

- Do not duplicate core logic.
- Do not call real LLM APIs in tests.
- Do not execute target repository code.
- Do not access files outside the repo root.
- Add tests for every new module.
- Keep each change small and reviewable.
