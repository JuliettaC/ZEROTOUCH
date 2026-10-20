import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fork } from "node:child_process";
import { once } from "node:events";
import { openDatabase } from "../src/config/database.js";

export async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "zerotouch-test-"));
  const filename = path.join(directory, "test.sqlite");
  const db = openDatabase(filename, { initialize: true });
  db.close();
  const running = new Set();
  t.after(async () => {
    for (const instance of running) await instance.stop();
    // This directory is a uniquely created test fixture, never a user database.
    if (
      path.dirname(directory) !== path.resolve(tmpdir()) ||
      !path.basename(directory).startsWith("zerotouch-test-")
    )
      throw new Error("Unsafe cleanup path");
    await rm(directory, { recursive: true, force: true });
  });
  async function start() {
    const child = fork(new URL("../src/server.js", import.meta.url), [], {
      env: {
        ...process.env,
        NODE_ENV: "test",
        DATABASE_PATH: filename,
        HOST: "127.0.0.1",
        PORT: "0",
      },
      silent: true,
    });
    let output = "";
    let errors = "";
    child.stderr.on("data", (chunk) => {
      errors += chunk;
    });
    const base = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`Startup timeout: ${errors}`));
      }, 10000);
      child.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`Startup exit ${code}: ${errors}`));
      });
      child.stdout.on("data", (chunk) => {
        output += chunk;
        const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
        if (match) {
          clearTimeout(timer);
          resolve(match[0]);
        }
      });
    });
    const instance = {
      base,
      async stop() {
        if (child.exitCode === null && child.signalCode === null) {
          const exited = once(child, "exit");
          child.send("shutdown");
          const timer = setTimeout(() => child.kill(), 7000);
          const [code] = await exited;
          clearTimeout(timer);
          if (code !== 0) throw new Error(`Shutdown failed: ${code}`);
        }
        running.delete(instance);
      },
    };
    running.add(instance);
    return instance;
  }
  return { filename, start };
}
export async function request(
  base,
  method,
  route,
  body,
  { raw = false, headers = {} } = {},
) {
  const response = await fetch(base + route, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: raw ? body : JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(10000),
  });
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    body: text ? JSON.parse(text) : null,
  };
}
