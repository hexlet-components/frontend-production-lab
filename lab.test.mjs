import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import {
  activate,
  configure,
  createLab,
  manifest,
  publish,
  removeAsset,
  reset,
} from "./lab-core.mjs";

test("выпуск, общий кеш, ошибки ресурсов и откат", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "frontend-production-"));
  const state = join(temporary, "state");
  let lab;
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
    lab = await createLab({ state, ports: { origin: 0, api: 0, cdn: 0 }, log: () => {} });

    const page = await fetch(`${lab.originUrl}/products/42`, { headers: { Accept: "text/html" } });
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type"), /text\/html/);
    const etag = page.headers.get("etag");
    assert.equal(
      (
        await fetch(`${lab.originUrl}/products/42`, {
          headers: { Accept: "text/html", "If-None-Match": etag },
        })
      ).status,
      304,
    );
    assert.equal(
      (await fetch(`${lab.originUrl}/assets/missing.js`, { headers: { Accept: "text/html" } }))
        .status,
      404,
    );
    await configure(state, "fallback", "false");
    assert.equal(
      (await fetch(`${lab.originUrl}/products/42`, { headers: { Accept: "text/html" } })).status,
      404,
    );
    await configure(state, "fallback", "true");

    const cors = await fetch(`${lab.apiUrl}/api/products`, { headers: { Origin: lab.originUrl } });
    assert.equal(cors.headers.get("access-control-allow-origin"), lab.originUrl);
    assert.equal((await cors.json())[0].id, 42);
    await configure(state, "cors", "false");
    assert.equal(
      (
        await fetch(`${lab.apiUrl}/api/products`, { headers: { Origin: lab.originUrl } })
      ).headers.get("access-control-allow-origin"),
      null,
    );
    assert.equal((await fetch(`${lab.originUrl}/api/products`)).status, 200);

    const fileUrl = `${lab.cdnUrl}/${reportsA}`;
    const head = await fetch(fileUrl, { method: "HEAD" });
    assert.equal(
      Number(head.headers.get("content-length")),
      (await readFile(join(state, "releases", "A", reportsA))).length,
    );
    assert.equal((await fetch(fileUrl)).headers.get("x-lab-cache"), "MISS");
    assert.equal((await fetch(fileUrl)).headers.get("x-lab-cache"), "HIT");
    await fetch(`${lab.cdnUrl}/__lab/cache`, { method: "PURGE" });
    assert.equal((await fetch(fileUrl)).headers.get("x-lab-cache"), "MISS");

    await configure(state, "cacheHtml", "true");
    const cachedA = await fetch(lab.cdnUrl);
    assert.equal(cachedA.headers.get("x-lab-cache"), "MISS");
    const htmlA = await cachedA.text();
    await activate(state, "B");
    assert.equal(await (await fetch(lab.cdnUrl)).text(), htmlA);
    const originB = await (await fetch(lab.originUrl)).text();
    assert.notEqual(originB, htmlA);
    await fetch(`${lab.cdnUrl}/__lab/cache`, { method: "PURGE" });
    assert.equal(await (await fetch(lab.cdnUrl)).text(), originB);
    assert.equal((await fetch(`${lab.originUrl}/${reportsA}`)).status, 200);

    await removeAsset(state, reportsA);
    assert.equal((await fetch(`${lab.originUrl}/${reportsA}`)).status, 404);
    await copyFile(join(state, "releases", "A", reportsA), join(state, "shared", reportsA));
    await activate(state, "A");
    await configure(state, "environment", "staging");
    assert.deepEqual(await (await fetch(`${lab.originUrl}/app-config.json`)).json(), {
      environment: "staging",
      apiBase: "/api",
    });
    assert.deepEqual(await manifest(join(state, "releases", "A")), a.files);
    assert.equal(await (await fetch(lab.originUrl)).text(), htmlA);

    const altered = join(state, "releases", "B", "index.html");
    await writeFile(altered, "изменённый артефакт");
    await assert.rejects(activate(state, "B"), /изменились/);
  } finally {
    await lab?.close();
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
