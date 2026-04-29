# OpenHarness

OpenHarness is an open source, model-agnostic harness for local-first, verifiable AI work.

The initial goal is a working kernel loop:

1. Accept a task.
2. Route it to a model provider.
3. Execute tool calls through policy.
4. Write every meaningful event to JSONL.
5. Run verification.
6. Return a final result.

## Run

```bash
npm test
npm run demo
node bin/harness.mjs doctor
node bin/harness.mjs run "inspect this repo" --provider scripted
node bin/harness.mjs runs
node bin/harness.mjs show <run-id>
node bin/harness.mjs serve
node bin/harness.mjs log .openharness-events.jsonl
```

The demo uses a scripted local provider, so it does not need API keys or a local model server yet.

## Provider Config

OpenHarness can load a JSON config file for provider settings:

```json
{
  "provider": "openai-compatible",
  "privacyMode": "ask-before-api",
  "providers": {
    "openai-compatible": {
      "baseUrl": "https://api.openai.com/v1",
      "model": "gpt-4.1-mini",
      "apiKeyEnv": "OPENAI_API_KEY"
    }
  }
}
```

Run with:

```bash
node bin/harness.mjs run "summarize README" --config openharness.json
```

For local-only Ollama usage:

```json
{
  "provider": "ollama",
  "privacyMode": "local-only",
  "providers": {
    "ollama": {
      "baseUrl": "http://127.0.0.1:11434",
      "model": "llama3.2"
    }
  }
}
```

For Codex subscription delegation through a signed-in Codex CLI:

```json
{
  "provider": "codex-worker",
  "privacyMode": "ask-before-api",
  "workers": {
    "codex-worker": {
      "command": "codex",
      "args": [
        "exec",
        "--json",
        "--color",
        "never",
        "--sandbox",
        "workspace-write",
        "--skip-git-repo-check"
      ]
    }
  }
}
```

Run with:

```bash
node bin/harness.mjs run "inspect README" --provider codex-worker
```

For Claude subscription delegation through a signed-in Claude Code CLI:

```json
{
  "provider": "claude-worker",
  "privacyMode": "ask-before-api",
  "workers": {
    "claude-worker": {
      "command": "claude",
      "args": [
        "-p",
        "--output-format",
        "text",
        "--permission-mode",
        "dontAsk"
      ],
      "model": "sonnet"
    }
  }
}
```

Run with:

```bash
node bin/harness.mjs run "inspect README" --provider claude-worker
```

The Claude worker uses `claude -p` non-interactive print mode. The default
permission mode is conservative so the worker does not hang waiting for terminal
approval prompts.

Check local Claude readiness with:

```bash
claude auth status
node bin/harness.mjs doctor
```

If `claude-auth` is not ready, sign in with `claude auth login`. Subscription
setups that need a long-lived token can run `claude setup-token`.

## Inspecting A Run

Use `doctor` to check local readiness:

```bash
node bin/harness.mjs doctor --config openharness.json
```

Use `log` to pretty-print the JSONL audit trail:

```bash
node bin/harness.mjs log .openharness-events.jsonl
```

Use `runs` for a UI-friendly summary grouped by run ID:

```bash
node bin/harness.mjs runs
node bin/harness.mjs runs --json
```

Use `show` to inspect one run and its full event timeline:

```bash
node bin/harness.mjs show <run-id>
node bin/harness.mjs show <run-id> --json
```

The JSON commands are intended for local dashboards and other UI clients. The
JSONL audit log remains the source of truth.

## Local API

Start the local API and dashboard:

```bash
node bin/harness.mjs serve
node bin/harness.mjs serve --port 4317 --log .openharness-events.jsonl
node bin/harness.mjs serve --config openharness.json
```

The server binds to `127.0.0.1` by default. It serves the dashboard at `/` and
exposes JSON endpoints:

```text
GET /api/health
GET /api/runs
GET /api/runs/<run-id>
POST /api/runs
GET /api/approvals
POST /api/approvals/<approval-id>/approve
POST /api/approvals/<approval-id>/deny
GET /api/events/stream
```

`POST /api/runs` starts a background run from the dashboard or another local
same-origin client:

```json
{
  "goal": "Read README.md and summarize it",
  "provider": "scripted",
  "privacyMode": "local-only"
}
```

The initial API-started provider set is `scripted`, `ollama`, and
`openai-compatible`. When an API-started run requests a write-risk tool,
execution pauses until the dashboard or another same-origin local client posts
an approve or deny decision. Worker runs, cancellation, and output streaming are
still deliberate follow-up slices.

`/api/events/stream` is a Server-Sent Events stream. It emits
`openharness.ready` on connect and `openharness.event` for each appended JSONL
audit event. Add `?replay=1` to replay existing events from the log.

## Approval Policy

OpenHarness records approval requests as `approval.requested` and every tool
decision as `approval.decided`.

Current defaults:

- Read tools are allowed.
- Write/network tools require approval before execution.
- Destructive tools are denied by default.

For one-off CLI runs:

```bash
node bin/harness.mjs run "write a note" --provider scripted --approve
node bin/harness.mjs run "write a note" --provider scripted --auto-approve writeFile
node bin/harness.mjs run "write a note" --provider scripted --deny shell
```

`--approve` requires an interactive TTY. `--auto-approve writeFile` is powerful:
it allows the model to write files during that run, so use it only in workspaces
you are comfortable modifying.

## Built-in Tools

- `readFile`: reads a UTF-8 file inside the workspace.
- `listFiles`: lists entries inside a workspace directory.
- `shell`: runs a command inside the workspace after approval.
- `writeFile`: writes UTF-8 text inside the workspace after approval.

`writeFile` accepts `{ "path", "content", "overwrite", "createDirs" }`.
`overwrite` defaults to `false`, so existing files are not clobbered unless the
model explicitly asks for it. `createDirs` defaults to `false`. Audit events
record path, byte count, and hash metadata, but not full file content.

## Current Pieces

- `src/kernel.mjs`: task orchestration loop.
- `src/providers.mjs`: provider contract plus scripted test provider.
- `src/tools.mjs`: read, list, approval-gated shell, and safe write tools.
- `src/policy.mjs`: workspace and tool-risk policy checks.
- `src/audit-log.mjs`: JSONL event logging.
- `src/runs.mjs`: JSONL-backed run summaries for UI clients.
- `src/server.mjs`: read-only local JSON API for UI clients.
- `src/verifier.mjs`: command-based verification.
- `src/workers.mjs`: subscription-backed CLI workers for Codex and Claude.

## Next Provider Targets

- OpenAI-compatible HTTP provider.
- Ollama local provider.
- Codex CLI/client worker provider for signed-in Codex subscription environments.
- Claude Code/client worker provider for signed-in Claude subscription environments.

## License

Apache-2.0.
