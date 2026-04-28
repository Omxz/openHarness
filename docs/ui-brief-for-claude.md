# UI Brief For Claude

OpenHarness is an open source, model-agnostic harness for local-first, verifiable AI work.

It is not a generic chatbot UI. It is closer to a cockpit for AI-driven work: task state, model routing, permissions, tool calls, verification, logs, and workspace context should be visible and understandable.

## Product Idea

Users give OpenHarness a goal. The harness chooses a model provider, asks for permission before risky actions, runs tools, verifies the result, and writes an audit log.

The UI should help users understand and control that loop.

## Core Screens

1. **Task Workspace**
   - Current task goal.
   - Running status: planning, running, verifying, done, blocked.
   - Conversation/output area.
   - Compact timeline of model responses, tool calls, approvals, verifier results.

2. **Permission Queue**
   - Pending risky actions.
   - Tool name, risk level, command/path/network target.
   - Approve once, deny, or approve similar actions.

3. **Model Routing**
   - Active provider.
   - Privacy mode: local-only, API-allowed, ask-before-api.
   - Capability badges: tool calling, vision, embeddings, JSON mode, context window.
   - Cost/privacy hints.

4. **Audit Log**
   - JSONL-backed event stream shown as readable cards/rows.
   - Filter by actor: user, model, tool, system.
   - Filter by type: task, model, tool, verification.

5. **Verification**
   - Last verifier command.
   - Exit code.
   - stdout/stderr preview.
   - Clear pass/fail/skipped state.

## Design Direction

The UI should feel like professional infrastructure software: calm, dense, inspectable, and trustworthy.

Avoid a marketing-style landing page. The first screen should be the usable task cockpit.

Good references:

- Linear for clarity and density.
- GitHub Actions for logs and job state.
- Kubernetes dashboards for resource/state inspection.
- Local dev tools for trust and control.

## Important UX Principles

- Show what the harness is doing, but do not overwhelm the user.
- Make risky actions obvious before approval.
- Make verification status impossible to miss.
- Keep model/provider choices visible without turning the UI into settings soup.
- Treat local-first privacy as a first-class feature.
- Prefer plain language over AI hype.

## Current Backend MVP

The current implementation includes:

- `src/kernel.mjs`: orchestration loop.
- `src/providers.mjs`: provider abstraction and scripted provider.
- `src/tools.mjs`: read/list/shell tools.
- `src/policy.mjs`: workspace and approval policy.
- `src/audit-log.mjs`: JSONL audit log.
- `src/verifier.mjs`: command verifier.
- `bin/harness.mjs`: CLI demo.

The UI does not need to be built yet. The next backend steps are real provider adapters for OpenAI-compatible APIs and Ollama.

