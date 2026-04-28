# Doctor And Log Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `harness doctor` and `harness log` so users can inspect local readiness and audit history.

**Architecture:** Keep log formatting in `src/log-viewer.mjs` and diagnostics in `src/doctor.mjs`. The CLI should only parse command arguments and render returned strings. Diagnostics will be dependency-injected in tests to avoid requiring live Ollama, Codex auth, or network access.

**Tech Stack:** Node.js ESM, built-in filesystem/process APIs, Node's built-in test runner.

---

### Task 1: Audit Log Viewer

**Files:**
- Create: `src/log-viewer.mjs`
- Create: `test/log-viewer.test.mjs`
- Modify: `bin/harness.mjs`
- Modify: `test/cli.test.mjs`

- [x] Write failing tests for formatting audit events and CLI `log <path>`.
- [x] Run focused tests and confirm they fail.
- [x] Implement `formatEvents` and `formatLogFile`.
- [x] Wire `harness log <path>` into the CLI.
- [x] Run focused tests and confirm they pass.

### Task 2: Doctor Diagnostics

**Files:**
- Create: `src/doctor.mjs`
- Create: `test/doctor.test.mjs`
- Modify: `bin/harness.mjs`
- Modify: `test/cli.test.mjs`

- [x] Write failing tests for node version, config loading, env-key detection, Ollama check, Codex check, git repo check, and audit log presence.
- [x] Run focused tests and confirm they fail.
- [x] Implement `runDoctor` and `formatDoctorReport`.
- [x] Wire `harness doctor [--config path]` into the CLI.
- [x] Run focused tests and confirm they pass.

### Task 3: Docs And Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-04-28-doctor-log-viewer.md`

- [x] Update README with `doctor` and `log` commands.
- [x] Run `npm test`.
- [x] Commit and push the doctor/log viewer slice.
