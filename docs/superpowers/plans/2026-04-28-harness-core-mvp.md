# Harness Core MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first end-to-end harness loop: task input, model provider, permissioned tools, JSONL audit log, verifier, and CLI.

**Architecture:** Use a dependency-free Node.js ESM package so the MVP runs without an install step. Keep the kernel separate from provider, tool, policy, verifier, and audit modules. Start with test providers and tools that prove the contracts before adding real API/Ollama adapters.

**Tech Stack:** Node.js built-in test runner, ESM JavaScript, JSONL event logs, CLI via `node bin/harness.mjs`.

---

### Task 1: Core Contracts And Event Log

**Files:**
- Create: `src/audit-log.mjs`
- Create: `src/types.mjs`
- Test: `test/audit-log.test.mjs`

- [x] Write a failing test for appending and reading JSONL audit events.
- [x] Run `node --test test/audit-log.test.mjs` and confirm it fails because `src/audit-log.mjs` does not exist.
- [x] Implement `appendEvent`, `readEvents`, and `createEvent`.
- [x] Run `node --test test/audit-log.test.mjs` and confirm it passes.

### Task 2: Policy And Tools

**Files:**
- Create: `src/policy.mjs`
- Create: `src/tools.mjs`
- Test: `test/policy-tools.test.mjs`

- [x] Write failing tests for read tools being allowed and shell tools requiring approval.
- [x] Run `node --test test/policy-tools.test.mjs` and confirm it fails because modules do not exist.
- [x] Implement `createPolicy`, `readFileTool`, `listFilesTool`, and `shellTool`.
- [x] Run `node --test test/policy-tools.test.mjs` and confirm it passes.

### Task 3: Harness Kernel

**Files:**
- Create: `src/kernel.mjs`
- Create: `src/providers.mjs`
- Create: `src/verifier.mjs`
- Test: `test/kernel.test.mjs`

- [x] Write a failing test that runs one task through a scripted provider, tool call, event log, verifier, and final response.
- [x] Run `node --test test/kernel.test.mjs` and confirm it fails because modules do not exist.
- [x] Implement `runTask`, `createScriptedProvider`, and `runVerifier`.
- [x] Run `node --test test/kernel.test.mjs` and confirm it passes.

### Task 4: CLI And Package Metadata

**Files:**
- Create: `package.json`
- Create: `bin/harness.mjs`
- Create: `README.md`
- Test: `test/cli.test.mjs`

- [x] Write a failing CLI test for `node bin/harness.mjs --help`.
- [x] Run `node --test test/cli.test.mjs` and confirm it fails because the CLI does not exist.
- [x] Implement CLI help and a demo command.
- [x] Run the full test suite with `node --test`.
