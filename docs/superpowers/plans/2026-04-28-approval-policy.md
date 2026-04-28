# Approval Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade tool approval from a hardcoded shell boolean to explicit allow/deny decisions logged in the audit trail.

**Architecture:** Keep risk evaluation in `src/policy.mjs`, but let the kernel own approval prompts and audit logging. Tools should assert that a decision exists; the kernel should create that decision before running risky tools.

**Tech Stack:** Node.js ESM, Node's built-in test runner.

---

### Task 1: Policy Decisions

**Files:**
- Modify: `src/policy.mjs`
- Modify: `test/policy-tools.test.mjs`

- [x] Write failing tests for `decideToolUse`, read auto-allow, shell requiring approval, and destructive deny by default.
- [x] Run `node --test test/policy-tools.test.mjs` and confirm it fails.
- [x] Implement decision objects and `recordApproval`.
- [x] Run `node --test test/policy-tools.test.mjs` and confirm it passes.

### Task 2: Kernel Approval Logging

**Files:**
- Modify: `src/kernel.mjs`
- Modify: `test/kernel.test.mjs`
- Modify: `src/log-viewer.mjs`
- Modify: `test/log-viewer.test.mjs`

- [x] Write failing tests for approval callback, `approval.decided` audit event, denied tool blocking, and log formatting.
- [x] Run focused tests and confirm they fail.
- [x] Implement kernel approval flow.
- [x] Run focused tests and confirm they pass.

### Task 3: Docs And Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-04-28-approval-policy.md`

- [x] Document the current approval semantics.
- [x] Run `npm test`.
- [x] Commit and push the approval policy slice.
