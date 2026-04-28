import { test } from "node:test";
import assert from "node:assert/strict";

import { createOllamaProvider } from "../src/providers.mjs";

test("Ollama provider normalizes a final JSON response", async () => {
  const fakeFetch = createFakeFetch({
    responseBody: {
      message: {
        content: JSON.stringify({
          type: "final",
          content: "Local model answered.",
        }),
      },
    },
  });
  const provider = createOllamaProvider({
    baseUrl: "http://ollama.test",
    model: "llama3.2",
    fetchImpl: fakeFetch,
  });

  const response = await provider.complete({
    task: { id: "task-1", goal: "answer locally" },
    transcript: [{ role: "user", content: "answer locally" }],
    tools: {},
  });

  assert.deepEqual(response, {
    type: "final",
    content: "Local model answered.",
  });
  assert.equal(fakeFetch.requests[0].url, "http://ollama.test/api/chat");
  assert.equal(fakeFetch.requests[0].body.model, "llama3.2");
  assert.equal(fakeFetch.requests[0].body.stream, false);
  assert.equal(fakeFetch.requests[0].body.format, "json");
});

test("Ollama provider normalizes a tool call JSON response", async () => {
  const fakeFetch = createFakeFetch({
    responseBody: {
      message: {
        content: JSON.stringify({
          type: "tool_call",
          toolName: "readFile",
          input: { path: "README.md" },
        }),
      },
    },
  });
  const provider = createOllamaProvider({
    baseUrl: "http://ollama.test/",
    model: "qwen2.5-coder:7b",
    fetchImpl: fakeFetch,
  });

  const response = await provider.complete({
    task: { id: "task-2", goal: "read README" },
    transcript: [{ role: "user", content: "read README" }],
    tools: {
      readFile: { name: "readFile", risk: "read" },
    },
  });

  assert.deepEqual(response, {
    type: "tool_call",
    toolName: "readFile",
    input: { path: "README.md" },
  });
  assert.equal(fakeFetch.requests[0].url, "http://ollama.test/api/chat");
});

test("Ollama provider includes useful error details for non-2xx responses", async () => {
  const fakeFetch = createFakeFetch({
    statusCode: 404,
    responseBody: { error: "model not found" },
  });
  const provider = createOllamaProvider({
    baseUrl: "http://ollama.test",
    model: "missing-model",
    fetchImpl: fakeFetch,
  });

  await assert.rejects(
    () =>
      provider.complete({
        task: { id: "task-3", goal: "answer locally" },
        transcript: [{ role: "user", content: "answer locally" }],
        tools: {},
      }),
    /Ollama provider failed with 404: model not found/,
  );
});

function createFakeFetch({ statusCode = 200, responseBody }) {
  const requests = [];
  const fakeFetch = async (url, options) => {
    requests.push({
      url,
      method: options.method,
      headers: options.headers,
      body: JSON.parse(options.body),
    });
    return new Response(JSON.stringify(responseBody), {
      status: statusCode,
      headers: { "content-type": "application/json" },
    });
  };
  fakeFetch.requests = requests;
  return fakeFetch;
}
