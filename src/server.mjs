import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeConfig } from "./config.mjs";
import { createRunManager } from "./run-manager.mjs";
import { getRun, listRuns } from "./runs.mjs";
import {
  detectClaudeAuth,
  detectClaudeWorker,
  detectCodexWorker,
} from "./workers.mjs";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 4317;
const UI_DIST = fileURLToPath(new URL("../web/dist", import.meta.url));

const CONTENT_TYPES = {
  ".html":  "text/html; charset=utf-8",
  ".js":    "text/javascript; charset=utf-8",
  ".mjs":   "text/javascript; charset=utf-8",
  ".css":   "text/css; charset=utf-8",
  ".json":  "application/json; charset=utf-8",
  ".map":   "application/json; charset=utf-8",
  ".svg":   "image/svg+xml",
  ".png":   "image/png",
  ".jpg":   "image/jpeg",
  ".jpeg":  "image/jpeg",
  ".gif":   "image/gif",
  ".ico":   "image/x-icon",
  ".woff":  "font/woff",
  ".woff2": "font/woff2",
  ".ttf":   "font/ttf",
};

export async function startApiServer({
  host = DEFAULT_HOST,
  port = DEFAULT_PORT,
  logPath,
  workspace = process.cwd(),
  config = normalizeConfig({}),
  runManager,
  uiDist = UI_DIST,
  eventStreamPollMs = 1000,
  workerHealth = defaultWorkerHealth,
} = {}) {
  if (!logPath) {
    throw new Error("startApiServer requires logPath");
  }

  const manager = runManager ?? createRunManager({ workspace, logPath, config });
  const server = createServer((request, response) => {
    handleRequest({
      request,
      response,
      logPath,
      runManager: manager,
      uiDist,
      eventStreamPollMs,
      workerHealth,
      config,
    }).catch((error) => {
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

async function handleRequest({
  request,
  response,
  logPath,
  runManager,
  uiDist,
  eventStreamPollMs,
  workerHealth,
  config,
}) {
  setCorsHeaders(response);

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  const url = new URL(request.url, "http://127.0.0.1");

  if (request.method === "POST" && url.pathname === "/api/runs") {
    if (!isAllowedRequestOrigin(request)) {
      sendJson(response, 403, {
        error: {
          code: "forbidden_origin",
          message: "Cross-origin run creation is not allowed",
        },
      });
      return;
    }

    await createRun({ request, response, runManager });
    return;
  }

  const cancelMatch =
    request.method === "POST"
      ? url.pathname.match(/^\/api\/runs\/([^/]+)\/cancel$/)
      : null;
  if (cancelMatch) {
    if (!isAllowedRequestOrigin(request)) {
      sendJson(response, 403, {
        error: {
          code: "forbidden_origin",
          message: "Cross-origin run cancellation is not allowed",
        },
      });
      return;
    }

    await cancelRunRoute({
      request,
      response,
      runManager,
      runId: decodeURIComponent(cancelMatch[1]),
    });
    return;
  }

  const approvalDecisionMatch =
    request.method === "POST"
      ? url.pathname.match(/^\/api\/approvals\/([^/]+)\/(approve|deny)$/)
      : null;
  if (approvalDecisionMatch) {
    if (!isAllowedRequestOrigin(request)) {
      sendJson(response, 403, {
        error: {
          code: "forbidden_origin",
          message: "Cross-origin approval decisions are not allowed",
        },
      });
      return;
    }

    await decideApproval({
      request,
      response,
      runManager,
      approvalId: decodeURIComponent(approvalDecisionMatch[1]),
      action: approvalDecisionMatch[2],
    });
    return;
  }

  if (request.method !== "GET") {
    sendJson(response, 405, {
      error: {
        code: "method_not_allowed",
        message:
          "Only GET, POST /api/runs, POST /api/runs/:id/cancel, POST /api/approvals/:id/approve, POST /api/approvals/:id/deny, and OPTIONS are supported",
      },
    });
    return;
  }

  if (url.pathname === "/api/approvals") {
    if (!isAllowedRequestOrigin(request)) {
      sendJson(response, 403, {
        error: {
          code: "forbidden_origin",
          message: "Cross-origin approval reads are not allowed",
        },
      });
      return;
    }

    sendJson(response, 200, {
      approvals: runManager.approvalManager?.list?.() ?? [],
    });
    return;
  }

  if (url.pathname === "/api/health") {
    sendJson(response, 200, {
      status: "ok",
      readOnly: false,
      capabilities: {
        createRuns: true,
        cancelRuns: true,
        approvalDecisions: true,
      },
      logPath,
    });
    return;
  }

  if (url.pathname === "/api/health/workers") {
    const result = await workerHealth({ config });
    sendJson(response, 200, result);
    return;
  }

  if (url.pathname === "/api/runs") {
    sendJson(response, 200, { runs: await listRuns(logPath) });
    return;
  }

  if (url.pathname === "/api/events/stream") {
    await streamAuditEvents({
      request,
      response,
      logPath,
      replay: url.searchParams.get("replay") === "1",
      pollMs: eventStreamPollMs,
    });
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

  if (url.pathname.startsWith("/api/")) {
    sendJson(response, 404, {
      error: {
        code: "not_found",
        message: `Route not found: ${url.pathname}`,
      },
    });
    return;
  }

  if (await serveStatic(response, url.pathname, uiDist)) {
    return;
  }

  sendJson(response, 404, {
    error: {
      code: "not_found",
      message: `Route not found: ${url.pathname}`,
    },
  });
}

async function createRun({ request, response, runManager }) {
  let body;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    sendJson(response, 400, {
      error: {
        code: "invalid_json",
        message: error.message,
      },
    });
    return;
  }

  try {
    const run = runManager.startRun(body);
    response.writeHead(202, {
      "content-type": "application/json; charset=utf-8",
      location: `/api/runs/${encodeURIComponent(run.runId)}`,
    });
    response.end(`${JSON.stringify({ run: toRunCreatedResponse(run) }, null, 2)}\n`);
  } catch (error) {
    sendJson(response, 400, {
      error: {
        code: error.code ?? "invalid_request",
        message: error.message,
      },
    });
  }
}

async function cancelRunRoute({ request, response, runManager, runId }) {
  if (typeof runManager.cancelRun !== "function") {
    sendJson(response, 503, {
      error: {
        code: "cancel_unavailable",
        message: "Run cancellation is not configured",
      },
    });
    return;
  }

  let body;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    sendJson(response, 400, {
      error: { code: "invalid_json", message: error.message },
    });
    return;
  }

  const reason =
    typeof body?.reason === "string" && body.reason.trim()
      ? body.reason.trim()
      : undefined;
  const result = runManager.cancelRun(runId, reason ? { reason } : {});

  if (!result.ok) {
    sendJson(response, 404, {
      error: {
        code: "not_found",
        message: `Run not found: ${runId}`,
      },
    });
    return;
  }

  sendJson(response, 200, { run: result.summary });
}

async function decideApproval({ request, response, runManager, approvalId, action }) {
  const manager = runManager.approvalManager;
  if (!manager) {
    sendJson(response, 503, {
      error: {
        code: "approvals_unavailable",
        message: "Approval manager is not configured",
      },
    });
    return;
  }

  let body;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    sendJson(response, 400, {
      error: { code: "invalid_json", message: error.message },
    });
    return;
  }

  const reason =
    typeof body?.reason === "string" && body.reason.trim()
      ? body.reason.trim()
      : undefined;
  const result =
    action === "approve"
      ? manager.approve(approvalId, { reason })
      : manager.deny(approvalId, { reason });

  if (!result.ok) {
    sendJson(response, 404, {
      error: {
        code: "not_found",
        message: `Approval not found: ${approvalId}`,
      },
    });
    return;
  }

  sendJson(response, 200, { approval: result.summary });
}

function toRunCreatedResponse(run) {
  return {
    runId: run.runId,
    status: run.status,
    providerId: run.providerId,
  };
}

async function serveStatic(response, pathname, uiDist) {
  let urlPath;
  try {
    urlPath = decodeURIComponent(pathname);
  } catch {
    return false;
  }
  if (urlPath === "/" || urlPath === "") urlPath = "/index.html";

  const distRoot = resolve(uiDist);
  const candidate = resolve(distRoot, "." + urlPath);
  if (!candidate.startsWith(distRoot + sep) && candidate !== distRoot) {
    return false;
  }

  if (await isFile(candidate)) {
    return sendFile(response, candidate);
  }

  const ext = extname(urlPath);
  if (ext && ext !== ".html") {
    return false;
  }

  const indexPath = join(distRoot, "index.html");
  if (await isFile(indexPath)) {
    return sendFile(response, indexPath);
  }

  sendJson(response, 503, {
    error: {
      code: "ui_not_built",
      message:
        "UI bundle not found. Build it with: npm --prefix web install && npm --prefix web run build",
    },
  });
  return true;
}

async function isFile(path) {
  try {
    const s = await stat(path);
    return s.isFile();
  } catch {
    return false;
  }
}

async function sendFile(response, absolutePath) {
  const buf = await readFile(absolutePath);
  const type = CONTENT_TYPES[extname(absolutePath)] ?? "application/octet-stream";
  response.writeHead(200, {
    "content-type": type,
    "cache-control": "no-cache",
  });
  response.end(buf);
  return true;
}

async function streamAuditEvents({ request, response, logPath, replay, pollMs }) {
  let offset = replay ? 0 : await readLogSize(logPath);
  let pending = "";
  let closed = false;
  let polling = false;

  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  response.flushHeaders?.();
  sendSse(response, "openharness.ready", { logPath, replay });

  async function poll() {
    if (closed || polling) {
      return;
    }

    polling = true;
    try {
      const bytes = await readLogBytes(logPath);
      if (bytes.length < offset) {
        offset = 0;
        pending = "";
      }

      if (bytes.length > offset) {
        const nextBytes = bytes.subarray(offset);
        offset = bytes.length;
        const text = pending + nextBytes.toString("utf8");
        const lines = text.split("\n");
        pending = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) {
            continue;
          }

          try {
            sendSse(response, "openharness.event", JSON.parse(line));
          } catch (error) {
            sendSse(response, "openharness.error", {
              code: "invalid_audit_event",
              message: error.message,
            });
          }
        }
      }
    } finally {
      polling = false;
    }
  }

  const interval = setInterval(poll, pollMs);
  request.on("close", () => {
    closed = true;
    clearInterval(interval);
  });

  if (replay) {
    await poll();
  }
}

function sendSse(response, event, data) {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function readLogSize(logPath) {
  const bytes = await readLogBytes(logPath);
  return bytes.length;
}

async function readLogBytes(logPath) {
  try {
    return await readFile(logPath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return Buffer.alloc(0);
    }

    throw error;
  }
}

async function readJsonBody(request, { limitBytes = 64 * 1024 } = {}) {
  let raw = "";

  for await (const chunk of request) {
    raw += chunk;
    if (Buffer.byteLength(raw, "utf8") > limitBytes) {
      throw new Error("Request body is too large");
    }
  }

  try {
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    throw new Error("Request body must be valid JSON");
  }
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(`${JSON.stringify(body, null, 2)}\n`);
}

function setCorsHeaders(response) {
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type");
}

function isAllowedRequestOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) {
    return true;
  }

  const host = request.headers.host;
  if (!host) {
    return false;
  }

  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

async function defaultWorkerHealth({ config } = {}) {
  const codexCommand = config?.workers?.["codex-worker"]?.command ?? "codex";
  const claudeCommand = config?.workers?.["claude-worker"]?.command ?? "claude";

  const [codex, claude, claudeAuth] = await Promise.all([
    safeDetect(() => detectCodexWorker({ command: codexCommand }), { command: codexCommand }),
    safeDetect(() => detectClaudeWorker({ command: claudeCommand }), { command: claudeCommand }),
    safeDetect(() => detectClaudeAuth({ command: claudeCommand }), { command: claudeCommand }),
  ]);

  return {
    codex: {
      available: codex.available,
      command: codex.command,
      detail: codex.detail,
    },
    claude: {
      available: claude.available,
      command: claude.command,
      detail: claude.detail,
      authenticated: claudeAuth.available,
      authDetail: claudeAuth.detail,
    },
  };
}

async function safeDetect(detect, fallback, timeoutMs = 3000) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      resolve({ available: false, command: fallback.command, detail: "detection timed out" });
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      detect().catch((error) => ({
        available: false,
        command: fallback.command,
        detail: error?.message ?? "detection failed",
      })),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
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
