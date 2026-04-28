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

## Inspecting A Run

Use `doctor` to check local readiness:

```bash
node bin/harness.mjs doctor --config openharness.json
```

Use `log` to pretty-print the JSONL audit trail:

```bash
node bin/harness.mjs log .openharness-events.jsonl
```

## Approval Policy

OpenHarness records every tool decision in the audit log as `approval.decided`.

Current defaults:

- Read tools are allowed.
- Write/network tools require approval before execution.
- Destructive tools are denied by default.

The CLI currently runs without an interactive approval prompt, so risky model tool calls remain blocked unless a future command explicitly wires an approval callback.

## Current Pieces

- `src/kernel.mjs`: task orchestration loop.
- `src/providers.mjs`: provider contract plus scripted test provider.
- `src/tools.mjs`: read, list, and approval-gated shell tools.
- `src/policy.mjs`: workspace and tool-risk policy checks.
- `src/audit-log.mjs`: JSONL event logging.
- `src/verifier.mjs`: command-based verification.

## Next Provider Targets

- OpenAI-compatible HTTP provider.
- Ollama local provider.
- Codex CLI/client worker provider for signed-in Codex subscription environments.

## License

Apache-2.0.
