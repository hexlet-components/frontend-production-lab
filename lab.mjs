import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { activate, configure, createLab, manifest, publish, removeAsset } from "./lab-core.mjs";

const state = resolve(".lab");
const [command = "serve", ...args] = process.argv.slice(2);
await mkdir(state, { recursive: true });

try {
  if (command === "serve") {
    const lab = await createLab({ state });
    console.log(`Origin ${lab.originUrl}\nAPI ${lab.apiUrl}\nОбщий кеш ${lab.cdnUrl}`);
    const stop = async () => {
      await lab.close();
      process.exit(0);
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  } else if (command === "publish") {
    const config = JSON.parse(await readFile("app-config.json", "utf8"));
    const result = await publish(state, resolve("dist"), args[0], config);
    console.log(`Сохранён релиз ${result.release}, файлов ${Object.keys(result.files).length}`);
  } else if (command === "activate") {
    await activate(state, args[0]);
    console.log(`Активен релиз ${args[0]}`);
  } else if (command === "configure") {
    await configure(state, args[0], args[1]);
    console.log(`${args[0]}=${args[1]}`);
  } else if (command === "invalidate") {
    const response = await fetch("http://127.0.0.1:8082/__lab/cache", { method: "PURGE" });
    if (!response.ok) throw new Error(`Кеш ответил ${response.status}`);
    console.log("Общий кеш очищен");
  } else if (command === "remove-asset") {
    await removeAsset(state, args[0]);
    console.log(`Удалён ${args[0]}`);
  } else if (command === "manifest") {
    console.log(JSON.stringify(await manifest(resolve(args[0] ?? "dist")), null, 2));
  } else throw new Error(`Неизвестная команда ${command}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
