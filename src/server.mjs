import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { getRun, listRuns } from "./runs.mjs";

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
  uiDist = UI_DIST,
} = {}) {
  if (!logPath) {
    throw new Error("startApiServer requires logPath");
  }

  const server = createServer((request, response) => {
    handleRequest({ request, response, logPath, uiDist }).catch((error) => {
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

async function handleRequest({ request, response, logPath, uiDist }) {
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
