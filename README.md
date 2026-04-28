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
node bin/harness.mjs run "inspect this repo" --provider scripted
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
