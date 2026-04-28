import { createServer } from "node:http";

import { getRun, listRuns } from "./runs.mjs";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 4317;

export async function startApiServer({
  host = DEFAULT_HOST,
  port = DEFAULT_PORT,
  logPath,
} = {}) {
  if (!logPath) {
    throw new Error("startApiServer requires logPath");
  }

  const server = createServer((request, response) => {
    handleRequest({ request, response, logPath }).catch((error) => {
      sendJson(response, 500, {
        error: {
          code: "internal_error",
          message: error.message,
        },
      });
    });
  });

  await listen(server, { host, port });
  const address = server.address();
  const resolvedHost = address.address === "::" ? "127.0.0.1" : address.address;

  return {
    host: resolvedHost,
    port: address.port,
    url: `http://${resolvedHost}:${address.port}`,
    server,
    close: () => close(server),
  };
}

async function handleRequest({ request, response, logPath }) {
  setCorsHeaders(response);

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.method !== "GET") {
    sendJson(response, 405, {
      error: {
        code: "method_not_allowed",
        message: "Only GET and OPTIONS are supported",
      },
    });
    return;
  }

  const url = new URL(request.url, "http://127.0.0.1");

  if (url.pathname === "/api/health") {
    sendJson(response, 200, {
      status: "ok",
      readOnly: true,
      logPath,
    });
    return;
  }

  if (url.pathname === "/api/runs") {
    sendJson(response, 200, { runs: await listRuns(logPath) });
    return;
  }

  const runMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/);
  if (runMatch) {
    const runId = decodeURIComponent(runMatch[1]);
    const run = await getRun(logPath, runId);

    if (!run) {
      sendJson(response, 404, {
        error: {
          code: "not_found",
          message: `Run not found: ${runId}`,
        },
      });
      return;
    }

    sendJson(response, 200, { run });
    return;
  }

  sendJson(response, 404, {
    error: {
      code: "not_found",
      message: `Route not found: ${url.pathname}`,
    },
  });
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(`${JSON.stringify(body, null, 2)}\n`);
}

function setCorsHeaders(response) {
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-methods", "GET, OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type");
}

function listen(server, { host, port }) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}
