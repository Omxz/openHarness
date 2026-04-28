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
- `src/providers.mjs`: provider abstraction, scripted provider, OpenAI-compatible provider, and Ollama provider.
- `src/tools.mjs`: read/list/shell tools.
- `src/policy.mjs`: workspace and approval policy.
- `src/audit-log.mjs`: JSONL audit log.
- `src/runs.mjs`: JSONL-backed run summaries and run details.
- `src/verifier.mjs`: command verifier.
- `bin/harness.mjs`: CLI demo.
- `src/workers.mjs`: Codex CLI worker delegation for signed-in Codex subscription environments.

## Current CLI Contract For UI Prototypes

Use the JSON commands instead of parsing raw JSONL in the UI:

```bash
node bin/harness.mjs runs --json
node bin/harness.mjs show <run-id> --json
```

Or start the read-only local API:

```bash
node bin/harness.mjs serve
node bin/harness.mjs serve --port 4317 --log .openharness-events.jsonl
```

API endpoints:

```text
GET http://127.0.0.1:4317/api/health
GET http://127.0.0.1:4317/api/runs
GET http://127.0.0.1:4317/api/runs/<run-id>
GET http://127.0.0.1:4317/api/events/stream
```

The API is read-only for now. `/api/events/stream` is Server-Sent Events:
`openharness.ready` on connect and `openharness.event` for appended JSONL audit
events. Add `?replay=1` if a client needs to replay the existing log.

Do not design the first UI around task submission yet; show the run dashboard
first.

`runs --json` returns:

```json
{
  "runs": [
    {
      "runId": "uuid-or-test-id",
      "goal": "inspect README",
      "providerId": "cli:scripted",
      "workerId": null,
      "status": "done",
      "createdAt": "2026-04-28T10:00:00.000Z",
      "completedAt": "2026-04-28T10:00:03.000Z",
      "durationMs": 3000,
      "final": "Final model or worker output",
      "verification": { "exitCode": 0 },
      "eventCount": 4
    }
  ]
}
```

`show <run-id> --json` returns the same run summary plus the raw `events`
array for the inspector and timeline.

The JSONL audit log remains the source of truth. These commands are a stable
read model for early UI work.
