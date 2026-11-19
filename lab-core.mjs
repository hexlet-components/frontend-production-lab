import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve, sep } from "node:path";

export const defaults = { fallback: true, cors: true, cacheHtml: false };
const products = [{ id: 42, name: "Учебная книга", price: 1200 }];
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
};

export const hash = (data) => createHash("sha256").update(data).digest("hex");
const exists = async (path) =>
  stat(path)
    .then(() => true)
    .catch((error) => {
      if (error.code === "ENOENT") return false;
      throw error;
    });
const readJson = async (path, fallback) => {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
};
const saveJson = async (path, data) => {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`);
  await rename(temporary, path);
};
export const releasePath = (state, release) => {
  if (!/^[a-zA-Z0-9_-]+$/.test(release ?? ""))
    throw new Error("Версия содержит только буквы, цифры, _ и -");
  return join(state, "releases", release);
};
export const listFiles = async (directory, prefix = "") => {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const relative = join(prefix, entry.name);
      return entry.isDirectory() ? listFiles(join(directory, entry.name), relative) : [relative];
    }),
  );
  return nested.flat().sort();
};
export const manifest = async (directory) =>
  Object.fromEntries(
    await Promise.all(
      (await listFiles(directory)).map(async (file) => [
        file.split(sep).join("/"),
        hash(await readFile(join(directory, file))),
      ]),
    ),
  );

export const publish = async (
  state,
  dist,
  release,
  config = { environment: "local", apiBase: "/api" },
) => {
  const destination = releasePath(state, release);
  if (await exists(destination))
    throw new Error(`Релиз ${release} уже существует. Для новой сборки нужно другое имя.`);
  const metadata = await readJson(join(dist, "release.json"));
  if (!metadata || metadata.release !== release)
    throw new Error(`Сначала соберите RELEASE_ID=${release} npm run build`);
  const files = await manifest(dist);
  const temporary = `${destination}.tmp`;
  await rm(temporary, { recursive: true, force: true });
  await mkdir(temporary, { recursive: true });
  for (const file of Object.keys(files)) {
    const target = join(temporary, file);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(dist, file), target);
    if (file.startsWith("assets/")) {
      const shared = join(state, "shared", file);
      await mkdir(dirname(shared), { recursive: true });
      if (await exists(shared)) {
        if (hash(await readFile(shared)) !== files[file])
          throw new Error(`Коллизия имени ресурса ${file}`);
      } else await copyFile(join(dist, file), shared);
    }
  }
  await rename(temporary, destination);
  await saveJson(join(state, "manifests", `${release}.json`), { release, files });
  await saveJson(join(state, "configs", `${release}.json`), config);
  return { release, files };
};

export const activate = async (state, release) => {
  const directory = releasePath(state, release);
  const expected = await readJson(join(state, "manifests", `${release}.json`));
  if (!expected) throw new Error(`Релиз ${release} не опубликован`);
  const actual = await manifest(directory);
  if (JSON.stringify(actual) !== JSON.stringify(expected.files))
    throw new Error(`Файлы релиза ${release} изменились`);
  await saveJson(join(state, "current.json"), { release });
};

export const configure = async (state, key, value) => {
  if (Object.hasOwn(defaults, key)) {
    if (value !== "true" && value !== "false") throw new Error("Ожидается true или false");
    const settings = await readJson(join(state, "settings.json"), defaults);
    await saveJson(join(state, "settings.json"), { ...settings, [key]: value === "true" });
    return;
  }
  if (!["apiBase", "environment"].includes(key))
    throw new Error("Настройки: fallback, cors, cacheHtml, apiBase, environment");
  const current = await readJson(join(state, "current.json"));
  if (!current) throw new Error("Сначала активируйте релиз");
  const path = join(state, "configs", `${current.release}.json`);
  const config = await readJson(path);
  await saveJson(path, { ...config, [key]: value });
};

export const reset = async (state, outputs = []) => {
  for (const path of [state, ...outputs]) await rm(path, { recursive: true, force: true });
};

export const removeAsset = async (state, name) => {
  if (!/^assets\/[a-zA-Z0-9_.-]+$/.test(name ?? ""))
    throw new Error("Передайте путь assets/<имя файла>");
  await rm(join(state, "shared", name));
};

const send = (request, response, status, data, headers = {}) => {
  const body = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const etag = `"${hash(body)}"`;
  response.setHeader("ETag", etag);
  for (const [key, value] of Object.entries(headers)) response.setHeader(key, value);
  if (status === 200 && request.headers["if-none-match"] === etag) {
    response.writeHead(304);
    response.end();
    return;
  }
  response.writeHead(status, { "Content-Length": body.length });
  response.end(request.method === "HEAD" ? undefined : body);
};
const json = (request, response, data, status = 200, headers = {}) =>
  send(request, response, status, JSON.stringify(data), {
    "Content-Type": contentTypes[".json"],
    ...headers,
  });
const listen = (server, port) =>
  new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolvePromise(`http://127.0.0.1:${server.address().port}`);
    });
  });

export const createLab = async ({
  state,
  ports = { origin: 8080, api: 8081, cdn: 8082 },
  log = console.log,
}) => {
  const servers = [];
  const cache = new Map();
  const close = async () =>
    Promise.all(
      servers.map(
        (server) =>
          new Promise((resolvePromise) => {
            server.closeAllConnections();
            server.close(resolvePromise);
          }),
      ),
    );
  const open = async (server, port) => {
    servers.push(server);
    try {
      return await listen(server, port);
    } catch (error) {
      await close();
      throw error;
    }
  };
  const settings = async () => ({
    ...defaults,
    ...(await readJson(join(state, "settings.json"), {})),
  });
  let originUrl;
  let apiUrl;
  let cdnUrl;
  const handle = (handler) => (request, response) => {
    handler(request, response).catch((error) => {
      log(`ERROR ${error.message}`);
      if (!response.headersSent) json(request, response, { error: error.message }, 500);
      else response.end();
    });
  };
  const api = createServer(
    handle(async (request, response) => {
      const config = await settings();
      const allowed = [originUrl, cdnUrl, "http://127.0.0.1:5173", "http://127.0.0.1:4173"];
      if (config.cors && allowed.includes(request.headers.origin)) {
        response.setHeader("Access-Control-Allow-Origin", request.headers.origin);
        response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
        response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Demo");
        response.setHeader("Vary", "Origin");
      }
      if (request.method === "OPTIONS") {
        response.writeHead(204);
        response.end();
        return;
      }
      const pathname = new URL(request.url, "http://lab").pathname;
      if (pathname === "/api/products") json(request, response, products);
      else if (pathname === "/api/products/42") json(request, response, products[0]);
      else json(request, response, { error: "Not found" }, 404);
    }),
  );
  apiUrl = await open(api, ports.api);

  const origin = createServer(
    handle(async (request, response) => {
      const path = decodeURIComponent(new URL(request.url, "http://lab").pathname);
      log(`ORIGIN ${request.method} ${path}`);
      if (path.startsWith("/api/")) {
        const result = await fetch(`${apiUrl}${path}`, { headers: { Accept: "application/json" } });
        send(request, response, result.status, Buffer.from(await result.arrayBuffer()), {
          "Content-Type": result.headers.get("content-type"),
          "Cache-Control": "no-store",
        });
        return;
      }
      const current = await readJson(join(state, "current.json"));
      if (path === "/__lab/health") {
        json(request, response, { release: current?.release ?? null, settings: await settings() });
        return;
      }
      if (!current) {
        json(request, response, { error: "Сначала publish и activate" }, 503);
        return;
      }
      if (path === "/app-config.json") {
        json(
          request,
          response,
          await readJson(join(state, "configs", `${current.release}.json`)),
          200,
          { "Cache-Control": "no-cache" },
        );
        return;
      }
      const relative = path.replace(/^\/+/, "");
      const base = path.startsWith("/assets/")
        ? join(state, "shared")
        : releasePath(state, current.release);
      const file = resolve(base, relative || "index.html");
      if (!file.startsWith(`${resolve(base)}${sep}`)) {
        json(request, response, { error: "Invalid path" }, 400);
        return;
      }
      let selected = file;
      if (!(await exists(selected)) || !(await stat(selected)).isFile()) {
        const acceptsHtml = request.headers.accept?.includes("text/html");
        const noExtension = extname(path) === "";
        if ((await settings()).fallback && acceptsHtml && noExtension)
          selected = join(releasePath(state, current.release), "index.html");
        else {
          json(request, response, { error: "Not found" }, 404, { "Cache-Control": "no-store" });
          return;
        }
      }
      const extension = extname(selected);
      const html = extension === ".html";
      const config = await settings();
      const policy = path.startsWith("/assets/")
        ? "public, max-age=31536000, immutable"
        : html && config.cacheHtml
          ? "public, max-age=3600"
          : "no-cache";
      send(request, response, 200, await readFile(selected), {
        "Content-Type": contentTypes[extension] ?? "application/octet-stream",
        "Cache-Control": policy,
      });
    }),
  );
  originUrl = await open(origin, ports.origin);

  const cdn = createServer(
    handle(async (request, response) => {
      if (request.method === "PURGE" && request.url === "/__lab/cache") {
        cache.clear();
        json(request, response, { cleared: true });
        return;
      }
      const key = request.url;
      const cached = cache.get(key);
      if (request.method === "GET" && cached && cached.expires > Date.now()) {
        send(request, response, cached.status, cached.body, {
          ...cached.headers,
          "X-Lab-Cache": "HIT",
          Age: String(Math.floor((Date.now() - cached.saved) / 1000)),
        });
        return;
      }
      const upstream = await fetch(`${originUrl}${request.url}`, {
        method: request.method,
        headers: {
          Accept: request.headers.accept ?? "*/*",
          ...(request.headers["if-none-match"]
            ? { "If-None-Match": request.headers["if-none-match"] }
            : {}),
        },
      });
      const body = Buffer.from(await upstream.arrayBuffer());
      const headers = Object.fromEntries(
        [...upstream.headers].filter(
          ([name]) =>
            !["connection", "keep-alive", "content-length", "transfer-encoding"].includes(name),
        ),
      );
      if (request.method === "HEAD") {
        response.writeHead(upstream.status, {
          ...headers,
          ...(upstream.headers.has("content-length")
            ? { "Content-Length": upstream.headers.get("content-length") }
            : {}),
          "X-Lab-Cache": "BYPASS",
        });
        response.end();
        return;
      }
      const match = headers["cache-control"]?.match(/(?:^|,\s*)max-age=(\d+)/);
      const canStore =
        request.method === "GET" &&
        upstream.status === 200 &&
        match &&
        !headers["cache-control"].includes("no-store");
      if (canStore)
        cache.set(key, {
          body,
          headers,
          status: upstream.status,
          saved: Date.now(),
          expires: Date.now() + Number(match[1]) * 1000,
        });
      if (upstream.status === 304) {
        response.writeHead(304, { ...headers, "X-Lab-Cache": "BYPASS" });
        response.end();
        return;
      }
      send(request, response, upstream.status, body, {
        ...headers,
        "X-Lab-Cache": canStore ? "MISS" : "BYPASS",
      });
    }),
  );
  cdnUrl = await open(cdn, ports.cdn);
  return {
    originUrl,
    apiUrl,
    cdnUrl,
    close,
  };
};
