import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const VIEWER = fileURLToPath(new URL("./viewer/index.html", import.meta.url));

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
