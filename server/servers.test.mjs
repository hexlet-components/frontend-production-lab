import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import {
  activate,
  configure,
  startServers,
  manifest,
  publish,
  removeAsset,
  reset,
} from "./servers.mjs";

test("выпуск, общий кеш, ошибки ресурсов и откат", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "frontend-production-"));
  const state = join(temporary, "state");
  let servers;
  try {
    for (const release of ["A", "B"]) {
      const dist = join(temporary, release);
      const build = spawnSync(
        process.execPath,
        ["node_modules/vite/bin/vite.js", "build", "--outDir", dist, "--emptyOutDir"],
        {
          cwd: resolve("."),
          env: { ...process.env, RELEASE_ID: release },
          encoding: "utf8",
        },
      );
      assert.equal(build.status, 0, build.stderr);
      const before = await manifest(dist);
      const saved = await publish(state, dist, release);
      assert.deepEqual(saved.files, before);
      assert.deepEqual(await manifest(join(state, "releases", release)), before);
    }
    await assert.rejects(publish(state, join(temporary, "A"), "A"), /уже существует/);
    await activate(state, "A");
    const a = JSON.parse(await readFile(join(state, "manifests", "A.json"), "utf8"));
    const reportsA = Object.keys(a.files).find((file) => /assets\/reports-.*\.js$/.test(file));
    assert.ok(reportsA);
    servers = await startServers({ state, ports: { origin: 0, api: 0, cdn: 0 }, log: () => {} });

    const page = await fetch(`${servers.originUrl}/products/42`, {
      headers: { Accept: "text/html" },
    });
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type"), /text\/html/);
    const etag = page.headers.get("etag");
    assert.equal(
      (
        await fetch(`${servers.originUrl}/products/42`, {
          headers: { Accept: "text/html", "If-None-Match": etag },
        })
      ).status,
      304,
    );
    assert.equal(
      (await fetch(`${servers.originUrl}/assets/missing.js`, { headers: { Accept: "text/html" } }))
        .status,
      404,
    );
    await configure(state, "fallback", "false");
    assert.equal(
      (await fetch(`${servers.originUrl}/products/42`, { headers: { Accept: "text/html" } }))
        .status,
      404,
    );
    await configure(state, "fallback", "true");

    const cors = await fetch(`${servers.apiUrl}/api/products`, {
      headers: { Origin: servers.originUrl },
    });
    assert.equal(cors.headers.get("access-control-allow-origin"), servers.originUrl);
    assert.equal((await cors.json())[0].id, 42);
    await configure(state, "cors", "false");
    assert.equal(
      (
        await fetch(`${servers.apiUrl}/api/products`, { headers: { Origin: servers.originUrl } })
      ).headers.get("access-control-allow-origin"),
      null,
    );
    assert.equal((await fetch(`${servers.originUrl}/api/products`)).status, 200);
    const move = (url, body) =>
      fetch(`${url}/api/movements`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    const received = await move(servers.originUrl, { productId: 42, type: "in", quantity: 6 });
    assert.equal(received.status, 201);
    assert.equal((await received.json()).stock, 30);
    const issued = await move(servers.cdnUrl, { productId: 42, type: "out", quantity: 10 });
    assert.equal(issued.status, 201);
    assert.equal((await issued.json()).stock, 20);
    assert.equal(
      (await move(servers.originUrl, { productId: 42, type: "out", quantity: 99 })).status,
      409,
    );
    assert.equal(
      (await move(servers.originUrl, { productId: 42, type: "in", quantity: 0 })).status,
      400,
    );
    const movements = await (await fetch(`${servers.originUrl}/api/movements`)).json();
    assert.deepEqual(
      movements.map(({ type, quantity }) => [type, quantity]),
      [
        ["in", 6],
        ["out", 10],
      ],
    );
    assert.equal((await (await fetch(`${servers.originUrl}/api/products/42`)).json()).stock, 20);

    const fileUrl = `${servers.cdnUrl}/${reportsA}`;
    const head = await fetch(fileUrl, { method: "HEAD" });
    assert.equal(
      Number(head.headers.get("content-length")),
      (await readFile(join(state, "releases", "A", reportsA))).length,
    );
    assert.equal((await fetch(fileUrl)).headers.get("x-cache"), "MISS");
    assert.equal((await fetch(fileUrl)).headers.get("x-cache"), "HIT");
    await fetch(`${servers.cdnUrl}/__cache`, { method: "PURGE" });
    assert.equal((await fetch(fileUrl)).headers.get("x-cache"), "MISS");

    await configure(state, "cacheHtml", "true");
    const cachedA = await fetch(servers.cdnUrl);
    assert.equal(cachedA.headers.get("x-cache"), "MISS");
    const htmlA = await cachedA.text();
    await activate(state, "B");
    assert.equal(await (await fetch(servers.cdnUrl)).text(), htmlA);
    const originB = await (await fetch(servers.originUrl)).text();
    assert.notEqual(originB, htmlA);
    await fetch(`${servers.cdnUrl}/__cache`, { method: "PURGE" });
    assert.equal(await (await fetch(servers.cdnUrl)).text(), originB);
    assert.equal((await fetch(`${servers.originUrl}/${reportsA}`)).status, 200);

    await removeAsset(state, reportsA);
    assert.equal((await fetch(`${servers.originUrl}/${reportsA}`)).status, 404);
    await copyFile(join(state, "releases", "A", reportsA), join(state, "shared", reportsA));
    await activate(state, "A");
    await configure(state, "environment", "staging");
    assert.deepEqual(await (await fetch(`${servers.originUrl}/app-config.json`)).json(), {
      environment: "staging",
      apiBase: "/api",
    });
    assert.deepEqual(await manifest(join(state, "releases", "A")), a.files);
    assert.equal(await (await fetch(servers.originUrl)).text(), htmlA);

    const altered = join(state, "releases", "B", "index.html");
    await writeFile(altered, "изменённый артефакт");
    await assert.rejects(activate(state, "B"), /изменились/);
  } finally {
    await servers?.close();
    await rm(temporary, { recursive: true, force: true });
  }
});

test("сброс очищает состояние и разрешает повторную публикацию", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "frontend-production-reset-"));
  const state = join(temporary, "state");
  const dist = join(temporary, "dist");
  try {
    await mkdir(join(dist, "assets"), { recursive: true });
    await writeFile(join(dist, "index.html"), "<!doctype html>");
    await writeFile(join(dist, "assets", "app.js"), "console.log(1);");
    await writeFile(join(dist, "release.json"), JSON.stringify({ release: "A" }));
    await publish(state, dist, "A");
    await assert.rejects(publish(state, dist, "A"), /уже существует/);
    const published = join(temporary, "published");
    await mkdir(published);
    await reset(state, [published]);
    await assert.rejects(stat(state), { code: "ENOENT" });
    await assert.rejects(stat(published), { code: "ENOENT" });
    await publish(state, dist, "A");
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
