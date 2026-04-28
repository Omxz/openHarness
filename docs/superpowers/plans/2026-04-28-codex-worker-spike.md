# Codex Worker Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Codex worker provider path that can delegate scoped tasks through `codex exec` for users with a signed-in Codex environment.

**Architecture:** Keep Codex as a worker provider, not a raw model provider. Add `src/workers.mjs` for Codex command construction/execution and add `runWorkerTask` to `src/kernel.mjs` so OpenHarness still owns task logging, verification, and final status.

**Tech Stack:** Node.js ESM, child-process spawning, dependency-injected process runner tests, Node's built-in test runner.

---

### Task 1: Codex Worker Config

**Files:**
- Modify: `src/config.mjs`
- Modify: `test/config.test.mjs`

- [x] Write failing tests for default Codex worker config and explicit JSON config.
- [x] Run `node --test test/config.test.mjs` and confirm it fails.
- [x] Implement Codex worker config normalization.
- [x] Run `node --test test/config.test.mjs` and confirm it passes.

### Task 2: Codex Worker Provider

**Files:**
- Create: `src/workers.mjs`
- Create: `test/codex-worker.test.mjs`

- [x] Write failing tests for `codex exec` argument construction, success capture, nonzero exit capture, and availability checks.
- [x] Run `node --test test/codex-worker.test.mjs` and confirm it fails because `src/workers.mjs` does not exist.
- [x] Implement `createCodexWorkerProvider`, `runProcess`, and `detectCodexWorker`.
- [x] Run `node --test test/codex-worker.test.mjs` and confirm it passes.

### Task 3: Worker Kernel And CLI

**Files:**
- Modify: `src/kernel.mjs`
- Modify: `bin/harness.mjs`
- Modify: `test/kernel.test.mjs`
- Modify: `test/cli.test.mjs`
- Modify: `README.md`

- [x] Write failing tests for `runWorkerTask` audit events and CLI help listing `codex-worker`.
- [x] Run the focused tests and confirm they fail.
- [x] Implement worker task orchestration and CLI provider selection.
- [x] Update README with Codex worker config.
- [x] Run focused tests and confirm they pass.

### Task 4: Verification

**Files:**
- Modify: `docs/superpowers/plans/2026-04-28-codex-worker-spike.md`

- [x] Run `npm test`.
- [x] Commit and push the Codex worker spike.
