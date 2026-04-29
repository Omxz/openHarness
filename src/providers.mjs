export function createScriptedProvider({ id = "test:scripted", responses }) {
  const remaining = [...responses];

  return {
    id,
    capabilities: {
      chat: true,
      toolCalling: true,
      vision: false,
      embeddings: false,
      jsonMode: true,
      streaming: false,
      contextWindow: 8192,
    },
    async complete(request) {
      const response = remaining.shift();
      if (!response) {
        throw new Error(`Scripted provider "${id}" has no response for ${request.task.id}`);
      }
      return response;
    },
  };
}

export function createOpenAICompatibleProvider({
  id = "openai-compatible",
  baseUrl = "https://api.openai.com/v1",
  model,
  apiKey,
  fetchImpl = fetch,
}) {
  if (!model) {
    throw new Error("OpenAI-compatible provider requires a model");
  }

  return {
    id,
    capabilities: {
      chat: true,
      toolCalling: false,
      vision: false,
      embeddings: false,
      jsonMode: true,
      streaming: false,
      contextWindow: 128000,
    },
    async complete(request) {
      const response = await fetchImpl(`${trimSlash(baseUrl)}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          model,
          response_format: { type: "json_object" },
          messages: buildMessages(request),
        }),
        signal: request.signal,
      });

      const body = await readJson(response);
      if (!response.ok) {
        throw new Error(
          `OpenAI-compatible provider failed with ${response.status}: ${extractErrorMessage(body)}`,
        );
      }

      return normalizeModelResponse(body);
    },
  };
}

export function createOllamaProvider({
  id = "ollama",
  baseUrl = "http://127.0.0.1:11434",
  model,
  fetchImpl = fetch,
}) {
  if (!model) {
    throw new Error("Ollama provider requires a model");
  }

  return {
    id,
    capabilities: {
      chat: true,
      toolCalling: false,
      vision: false,
      embeddings: false,
      jsonMode: true,
      streaming: false,
      contextWindow: 8192,
    },
    async complete(request) {
      const response = await fetchImpl(`${trimSlash(baseUrl)}/api/chat`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          stream: false,
          format: "json",
          messages: buildMessages(request),
        }),
        signal: request.signal,
      });

      const body = await readJson(response);
      if (!response.ok) {
        throw new Error(
          `Ollama provider failed with ${response.status}: ${extractErrorMessage(body)}`,
        );
      }

      return normalizeJsonContent(body.message?.content, "Ollama provider");
    },
  };
}

function buildMessages({ task, transcript, tools }) {
  const toolNames = Object.keys(tools ?? {});
  return [
    {
      role: "system",
      content: [
        "You are running inside OpenHarness.",
        "Respond only as JSON.",
        'For final answers use: {"type":"final","content":"..."}',
        'For tool calls use: {"type":"tool_call","toolName":"readFile","input":{"path":"README.md"}}',
        `Task id: ${task.id}`,
        `Available tools: ${toolNames.length ? toolNames.join(", ") : "none"}`,
      ].join("\n"),
    },
    ...transcript.map((entry) => {
      if (entry.role === "tool") {
        return {
          role: "tool",
          tool_call_id: entry.name ?? "tool",
          content: entry.content,
        };
      }

      return {
        role: entry.role,
        content: entry.content,
      };
    }),
  ];
}

async function readJson(response) {
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

function normalizeModelResponse(body) {
  const content = body.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI-compatible provider response did not include message content");
  }

  return normalizeJsonContent(content, "OpenAI-compatible provider");
}

function normalizeJsonContent(content, providerName) {
  if (!content) {
    throw new Error(`${providerName} response did not include message content`);
  }

  const parsed = JSON.parse(content);
  if (parsed.type === "final" && typeof parsed.content === "string") {
    return {
      type: "final",
      content: parsed.content,
    };
  }

  if (parsed.type === "tool_call" && typeof parsed.toolName === "string") {
    return {
      type: "tool_call",
      toolName: parsed.toolName,
      input: parsed.input ?? {},
    };
  }

  throw new Error(`Unsupported ${providerName} response type "${parsed.type}"`);
}

function extractErrorMessage(body) {
  if (typeof body.error === "string") {
    return body.error;
  }

  return body.error?.message ?? body.message ?? JSON.stringify(body);
}

function trimSlash(value) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
