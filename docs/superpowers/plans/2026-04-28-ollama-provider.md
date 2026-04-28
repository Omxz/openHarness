# Ollama Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add local Ollama provider support so OpenHarness can run against local models without API tokens.

**Architecture:** Extend `src/config.mjs` with normalized Ollama defaults, add `createOllamaProvider` in `src/providers.mjs`, and wire `ollama` into the CLI provider factory. The Ollama provider will call `/api/chat` with `stream: false` and `format: "json"`, then normalize the JSON content into the existing kernel response protocol.

**Tech Stack:** Node.js ESM, built-in `fetch`, Node's built-in test runner, fake fetch transport tests.

---

### Task 1: Ollama Config

**Files:**
- Modify: `src/config.mjs`
- Modify: `test/config.test.mjs`

- [x] Write failing tests for Ollama defaults and explicit JSON config loading.
- [x] Run `node --test test/config.test.mjs` and confirm it fails.
- [x] Implement Ollama config normalization.
- [x] Run `node --test test/config.test.mjs` and confirm it passes.

### Task 2: Ollama Provider

**Files:**
- Modify: `src/providers.mjs`
- Create: `test/ollama-provider.test.mjs`

- [x] Write failing tests using fake fetch for final responses, tool-call responses, and non-2xx errors.
- [x] Run `node --test test/ollama-provider.test.mjs` and confirm it fails because `createOllamaProvider` does not exist.
- [x] Implement `createOllamaProvider`.
- [x] Run `node --test test/ollama-provider.test.mjs` and confirm it passes.

### Task 3: CLI And Docs

**Files:**
- Modify: `bin/harness.mjs`
- Modify: `test/cli.test.mjs`
- Modify: `README.md`

- [x] Write failing CLI help test requiring `ollama` in provider options.
- [x] Run `node --test test/cli.test.mjs` and confirm it fails.
- [x] Wire `ollama` into CLI provider selection.
- [x] Update README with Ollama config example.
- [x] Run `node --test test/cli.test.mjs` and confirm it passes.

### Task 4: Verification

**Files:**
- Modify: `docs/superpowers/plans/2026-04-28-ollama-provider.md`

- [x] Run `npm test`.
- [x] Commit and push the Ollama provider slice.
