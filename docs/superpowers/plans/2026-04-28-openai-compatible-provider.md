# OpenAI-Compatible Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add provider configuration and a token-free-tested OpenAI-compatible provider path.

**Architecture:** Keep config parsing in `src/config.mjs`, provider implementations in `src/providers.mjs`, and CLI command parsing in `bin/harness.mjs`. The OpenAI-compatible provider will call `/chat/completions`, request JSON responses, and normalize model output into the existing `{ type: "final" }` / `{ type: "tool_call" }` kernel protocol.

**Tech Stack:** Node.js ESM, built-in `fetch`, Node's built-in test runner, fake fetch transport tests.

---

### Task 1: Provider Config

**Files:**
- Create: `src/config.mjs`
- Test: `test/config.test.mjs`

- [x] Write failing tests for default config values, explicit JSON config loading, and environment API-key resolution.
- [x] Run `node --test test/config.test.mjs` and confirm it fails because `src/config.mjs` does not exist.
- [x] Implement `normalizeConfig` and `loadConfig`.
- [x] Run `node --test test/config.test.mjs` and confirm it passes.

### Task 2: OpenAI-Compatible Provider

**Files:**
- Modify: `src/providers.mjs`
- Test: `test/openai-compatible-provider.test.mjs`

- [x] Write failing tests using a fake fetch transport for final responses, tool-call responses, API key headers, and non-2xx errors.
- [x] Run `node --test test/openai-compatible-provider.test.mjs` and confirm it fails because `createOpenAICompatibleProvider` does not exist.
- [x] Implement `createOpenAICompatibleProvider`.
- [x] Run `node --test test/openai-compatible-provider.test.mjs` and confirm it passes.

### Task 3: CLI Run Command

**Files:**
- Modify: `bin/harness.mjs`
- Modify: `README.md`
- Test: `test/cli.test.mjs`

- [x] Write failing CLI tests for `run` with the scripted provider and for help text mentioning config.
- [x] Run `node --test test/cli.test.mjs` and confirm it fails.
- [x] Implement `harness run <goal> --provider scripted`.
- [x] Update README usage notes.
- [x] Run `node --test test/cli.test.mjs` and confirm it passes.

### Task 4: Verification

**Files:**
- Modify: `docs/superpowers/plans/2026-04-28-openai-compatible-provider.md`

- [x] Run `npm test`.
- [x] Commit and push the provider config and OpenAI-compatible provider slice.
