import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { BadRequestError, layoutToGltf } from "./layout.ts";

export { layoutToGltf };

const VIEWER = fileURLToPath(new URL("./viewer/index.html", import.meta.url));

const MAX_BODY_BYTES = 64 * 1024;

function sendJson(res: ServerResponse, status: number, payload: unknown, extra: Record<string, string> = {}): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    ...extra,
  });
  res.end(body);
}

/** Reads the request body; resolves null (after draining) when it exceeds MAX_BODY_BYTES. */
async function readBody(req: IncomingMessage): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  let tooBig = Number(req.headers["content-length"] ?? 0) > MAX_BODY_BYTES;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) tooBig = true;
    if (!tooBig) chunks.push(chunk);
  }
  return tooBig ? null : Buffer.concat(chunks);
}

async function handleLayout(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const raw = await readBody(req);
  if (raw === null) return sendJson(res, 413, { error: `body exceeds ${MAX_BODY_BYTES} bytes` }, { Connection: "close" });
  let body: unknown;
  try {
    body = JSON.parse(raw.toString("utf8"));
  } catch {
    return sendJson(res, 400, { error: "body is not valid JSON" });
  }
  try {
    sendJson(res, 200, layoutToGltf(body));
  } catch (err) {
    if (err instanceof BadRequestError) return sendJson(res, 400, { error: err.message });
    sendJson(res, 500, { error: "layout failed" });
  }
}

export function serve(opts: { outDir: string; port?: number }): Promise<{ url: string; close: () => void }> {
  const model = join(opts.outDir, "model.gltf");
  const routes: Record<string, { file: string; type: string }> = {
    "/": { file: VIEWER, type: "text/html; charset=utf-8" },
    "/index.html": { file: VIEWER, type: "text/html; charset=utf-8" },
    "/model.gltf": { file: model, type: "model/gltf+json" },
  };

  const server = createServer(async (req, res) => {
    const rawUrl = req.url ?? "/";
    // "//x" would parse as a network-path reference (authority "x"), so reject before parsing.
    const path = rawUrl.startsWith("//") ? "" : new URL(rawUrl, "http://127.0.0.1").pathname;
    if (path === "/layout") {
      if (req.method !== "POST") return void sendJson(res, 405, { error: "Method Not Allowed" }, { Allow: "POST" });
      return void (await handleLayout(req, res));
    }
    const route = Object.hasOwn(routes, path) ? routes[path] : undefined;
    if (!route || (req.method !== "GET" && req.method !== "HEAD")) {
      res.writeHead(route ? 405 : 404, { "Content-Type": "text/plain" }).end(route ? "Method Not Allowed" : "Not Found");
      return;
    }
    try {
      const body = await readFile(route.file);
      res.writeHead(200, { "Content-Type": route.type, "Content-Length": body.length, "Cache-Control": "no-store" });
      res.end(req.method === "HEAD" ? undefined : body);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("Not Found");
    }
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr === null || typeof addr === "string") return reject(new Error("no server address"));
      resolve({
        url: `http://127.0.0.1:${addr.port}/`,
        close: () => {
          server.close();
          server.closeAllConnections();
        },
      });
    });
  });
}
