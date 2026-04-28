# Open Source LLM Harness Plan

Date: 2026-04-28

## Vision

Build an open source, model-agnostic harness for LLM-powered work. The harness should support both paid API models and local models, route tasks intelligently, enforce permissions, log every action, and verify meaningful work before calling it done.

The goal is not just "chat with tools." The goal is a cognitive runtime: a system that turns human intent into scoped plans, executable actions, auditable history, and verified outcomes.

## Core Principles

- Open source from day one.
- Model agnostic: no privileged default provider.
- Local-first: local models and local data should work without cloud dependencies.
- API-friendly: users can bring paid API keys for stronger models.
- Subscription-friendly: users should be able to delegate work through a signed-in Codex client when available, without requiring raw API tokens for that path.
- Permissioned: reads, writes, network access, and destructive actions need clear policy.
- Verifiable: every substantial task should have a check, test, preview, or other evidence.
- Auditable: model calls, tool calls, decisions, and results should be logged.
- Extensible: providers, tools, policies, memory stores, and verifiers should be plugins.
- Privacy-aware: users should be able to choose local-only, API-allowed, or ask-before-API modes.
- No telemetry by default.

## First Product Shape

Start with a CLI, not a full app.

The first working version should run one task through this loop:

1. User gives a task.
2. Harness creates a task object with privacy and workspace settings.
3. Harness selects a model provider.
4. Model proposes a response or tool call.
5. Tool call passes through the policy engine.
6. Tool executes if allowed.
7. Result is written to an event log.
8. Verification runs when configured.
9. Harness returns a final answer with what happened and what was verified.

This loop is the heart of the project. Everything else grows from it.

## Initial Provider Support

Support one API provider and one local provider first. Add Codex subscription support as a worker provider after the direct model providers are stable.

Recommended initial pair:

- API: OpenAI-compatible endpoint
- Local: Ollama

This proves the abstraction works without trying to support every provider immediately.

Recommended follow-up provider:

- Worker: Codex CLI/client provider, using the user's existing signed-in Codex environment when available.

Future providers:

- Codex CLI/client worker
- Anthropic
- Google Gemini
- Mistral
- OpenRouter
- Together
- Fireworks
- llama.cpp
- LM Studio
- vLLM
- Text Generation Inference
- LocalAI
- MLX on Apple Silicon

## Model Provider Contract

Every model provider should expose a small, normalized interface:

```ts
type ModelProvider = {
  id: string
  capabilities: ModelCapabilities
  complete(input: ModelRequest): Promise<ModelResponse>
  stream?(input: ModelRequest): AsyncIterable<ModelChunk>
  embed?(input: EmbeddingRequest): Promise<EmbeddingResponse>
}

type ModelCapabilities = {
  chat: boolean
  toolCalling: boolean
  vision: boolean
  embeddings: boolean
  jsonMode: boolean
  streaming: boolean
  contextWindow: number
}
```

The harness should choose models based on capability, cost, privacy, reliability, and task type.

## Codex Subscription Worker

OpenHarness should support Codex subscription usage without treating it as a raw model API.

The right abstraction is a worker provider:

```ts
type WorkerProvider = {
  id: string
  capabilities: WorkerCapabilities
  runTask(input: WorkerTaskRequest): Promise<WorkerTaskResult>
}
```

Unlike `ModelProvider`, a Codex worker provider may delegate a whole scoped task to a signed-in Codex CLI/client. OpenHarness remains the outer orchestrator: it sets the task boundary, workspace, privacy mode, approval policy, and verifier, then ingests the worker's result and audit artifacts.

This enables users with a Codex subscription to use that subscription path when available, while keeping API-key providers and local model providers as separate, explicit options.

Important requirements:

- Detect whether a usable Codex CLI/client is installed and authenticated.
- Treat Codex as an external worker, not as an interchangeable raw completion endpoint.
- Pass a scoped task brief and workspace boundary.
- Preserve OpenHarness approval, logging, and verification semantics around the delegated work.
- Record worker inputs, outputs, exit status, changed files, and verification results in the audit log.
- Fall back cleanly to API or local providers when Codex is unavailable.

## Task Contract

```ts
type Task = {
  id: string
  goal: string
  workspace: string
  privacyMode: "local-only" | "api-allowed" | "ask-before-api"
  status: "planning" | "running" | "verifying" | "done" | "blocked"
}
```

Tasks should be durable enough to resume later. A future version should let the user say, "Pick up the migration from where we left off," and the harness should know what that means.

## Tool Contract

```ts
type Tool = {
  name: string
  risk: "read" | "write" | "network" | "destructive"
  run(input: unknown, context: TaskContext): Promise<ToolResult>
}
```

Tools should declare their side effects, risk level, input schema, output schema, and permission requirements.

Initial tools:

- Read file
- List files
- Run shell command with approval

Future tools:

- Write file
- Git operations
- Browser automation
- Package manager operations
- Figma/design tools
- Issue tracker tools
- CI/CD tools

## Event Log

Every meaningful event should be written to a JSONL audit log.

```ts
type EventLogEntry = {
  taskId: string
  timestamp: string
  actor: "user" | "model" | "tool" | "system"
  type: string
  data: unknown
}
```

The event log enables replay, debugging, review, and future rollback features.

## Suggested Repository Shape

```txt
harness/
  README.md
  LICENSE
  CONTRIBUTING.md
  SECURITY.md
  CODE_OF_CONDUCT.md
  docs/
    architecture.md
    provider-api.md
    tool-api.md
    privacy-model.md
  examples/
    ollama-local-only/
    api-with-approval/
  packages/
    core/
    cli/
    providers/
      openai-compatible/
      ollama/
      codex-worker/
    tools/
      filesystem/
      shell/
    policy/
    verifier/
    memory/
```

## License Recommendation

Use Apache-2.0.

Reasons:

- Friendly to companies and individual builders.
- Includes a patent grant.
- Encourages adoption.
- Less restrictive than AGPL.

MIT is also acceptable if simplicity matters most. AGPL is worth considering only if the goal is to force hosted derivatives to stay open.

## First Public Milestone

An Apache-2.0 repo with a working CLI that can:

- Configure OpenAI-compatible API or Ollama.
- Accept a task from the user.
- Route the task to the selected provider.
- Use a filesystem read tool.
- Ask before running shell commands.
- Write a JSONL audit log.
- Run a configured verification command.
- Return a final summary with verification status.

Codex subscription support is not required for the first public milestone, but it should be captured as a near-term provider target.

## Later Milestones

1. Provider routing based on capability, cost, privacy, and task type.
2. Codex CLI/client worker provider for users with a signed-in Codex subscription environment.
3. Tool plugin API.
4. Policy engine with workspace zones and risk levels.
5. Memory engine with inspectable project and user memory.
6. Multi-role model runtime: planner, implementer, reviewer, tester, security critic.
7. Browser-based UI with timeline, logs, model routing, and permission controls.
8. Replay and partial rollback.
9. Project graph with codebase indexing, dependency maps, and source-linked context.
10. Team mode with shared policies and reusable workflows.

## First Step

Do not start with the full futuristic agent.

Start with the kernel:

> Make one task run end-to-end through a provider-independent, permissioned, logged, verifiable loop.

That is the seed. Once that loop exists, every ambitious feature has somewhere real to plug in.
