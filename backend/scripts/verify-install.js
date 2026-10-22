import fs from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { root } from "../src/config/env.js";

const temporary = await fs.mkdtemp(path.join(tmpdir(), "zerotouch-install-"));
async function cleanup() {
  if (
    path.dirname(temporary) !== path.resolve(tmpdir()) ||
    !path.basename(temporary).startsWith("zerotouch-install-")
  ) throw new Error("Unsafe cleanup path");
  await fs.rm(temporary, { recursive: true, force: true });
}
async function run(args, cwd) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [process.env.npm_execpath, ...args], {
      cwd,
      stdio: "inherit",
      env: { ...process.env, NODE_ENV: "test" },
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`npm ${args.join(" ")}: ${code}`)),
    );
  });
}
try {
  for (const relative of [
    "backend/package.json",
    "backend/package-lock.json",
    "backend/src",
    "backend/scripts",
    "backend/test",
    "db",
    "backend/api",
  ]) {
    const destination = path.join(temporary, relative);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.cp(path.join(root, relative), destination, { recursive: true });
  }
  console.log(
    `Instalación aislada: ${process.version} ${process.platform}/${process.arch}; sin reutilizar node_modules`,
  );
  await run(["ci", "--no-audit", "--no-fund"], path.join(temporary, "backend"));
  await run(["test"], path.join(temporary, "backend"));
  console.log(
    "Instalación limpia y pruebas completadas en este equipo. No equivale a probar otro sistema operativo.",
  );
} finally {
  await cleanup();
}
