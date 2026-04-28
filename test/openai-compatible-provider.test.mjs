import { test } from "node:test";
import assert from "node:assert/strict";

import { createOpenAICompatibleProvider } from "../src/providers.mjs";

test("OpenAI-compatible provider normalizes a final JSON response", async () => {
  const fakeFetch = createFakeFetch({
    responseBody: {
      choices: [
        {
          message: {
            content: JSON.stringify({
              type: "final",
              content: "The repo has a kernel.",
            }),
          },
        },
      ],
    },
  });

  const provider = createOpenAICompatibleProvider({
    baseUrl: "http://api.test/v1",
    model: "test-model",
    apiKey: "test-key",
    fetchImpl: fakeFetch,
  });

  const response = await provider.complete({
    task: { id: "task-1", goal: "inspect repo" },
    transcript: [{ role: "user", content: "inspect repo" }],
    tools: {},
  });

  assert.deepEqual(response, {
    type: "final",
    content: "The repo has a kernel.",
  });
  assert.equal(fakeFetch.requests[0].url, "http://api.test/v1/chat/completions");
  assert.equal(fakeFetch.requests[0].headers.authorization, "Bearer test-key");
  assert.equal(fakeFetch.requests[0].body.model, "test-model");
  assert.equal(fakeFetch.requests[0].body.response_format.type, "json_object");
});

test("OpenAI-compatible provider normalizes a tool call JSON response", async () => {
  const fakeFetch = createFakeFetch({
    responseBody: {
      choices: [
        {
          message: {
            content: JSON.stringify({
              type: "tool_call",
              toolName: "readFile",
              input: { path: "README.md" },
            }),
          },
        },
      ],
    },
  });

  const provider = createOpenAICompatibleProvider({
    baseUrl: "http://api.test/v1",
    model: "test-model",
    fetchImpl: fakeFetch,
  });

  const response = await provider.complete({
    task: { id: "task-2", goal: "read README" },
    transcript: [
      { role: "user", content: "read README" },
      { role: "tool", name: "listFiles", content: "{\"entries\":[\"README.md\"]}" },
    ],
    tools: {
      readFile: { name: "readFile", risk: "read" },
    },
  });

  assert.deepEqual(response, {
    type: "tool_call",
    toolName: "readFile",
    input: { path: "README.md" },
  });
  assert.equal(fakeFetch.requests[0].headers.authorization, undefined);
  assert.equal(fakeFetch.requests[0].body.messages[2].role, "tool");
});

test("OpenAI-compatible provider includes useful error details for non-2xx responses", async () => {
  const fakeFetch = createFakeFetch({
    statusCode: 401,
    responseBody: { error: { message: "bad key" } },
  });

  const provider = createOpenAICompatibleProvider({
    baseUrl: "http://api.test/v1",
    model: "test-model",
    apiKey: "bad-key",
    fetchImpl: fakeFetch,
  });

  await assert.rejects(
    () =>
      provider.complete({
        task: { id: "task-3", goal: "inspect repo" },
        transcript: [{ role: "user", content: "inspect repo" }],
        tools: {},
      }),
    /OpenAI-compatible provider failed with 401: bad key/,
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
