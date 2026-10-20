import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { fixture } from "./helpers.js";

test("colección Postman: todas las peticiones y sus scripts de verificación", async (t) => {
  const f = await fixture(t);
  const server = await f.start();
  const collection = JSON.parse(
    fs.readFileSync(
      new URL(
        "../../docs/api/ZeroTouch.postman_collection.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.equal(
    collection.info.schema,
    "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
  );
  const variables = new Map(collection.variable.map((v) => [v.key, v.value]));
  variables.set("baseUrl", server.base);
  const substitute = (text) =>
    text.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
      assert.ok(variables.has(key), `Missing variable: ${key}`);
      return variables.get(key);
    });
  // Executes the standard pm APIs used by this collection; not a general Postman emulator.
  for (const item of collection.item)
    await t.test(item.name, async () => {
      const req = item.request;
      const response = await fetch(substitute(req.url), {
        method: req.method,
        headers: Object.fromEntries(
          req.header.map((h) => [h.key, substitute(h.value)]),
        ),
        ...(req.body ? { body: substitute(req.body.raw) } : {}),
        signal: AbortSignal.timeout(10000),
      });
      const text = await response.text();
      const body = text ? JSON.parse(text) : null;
      const pm = {
        test: (name, fn) => {
          try {
            fn();
          } catch (error) {
            error.message = `${name}: ${error.message}`;
            throw error;
          }
        },
        response: {
          json: () => body,
          to: {
            have: { status: (code) => assert.equal(response.status, code) },
          },
        },
        collectionVariables: {
          set: (key, value) => variables.set(key, value),
          get: (key) => variables.get(key),
        },
        expect: (actual) => ({
          to: { eql: (expected) => assert.deepEqual(actual, expected) },
        }),
      };
      for (const event of item.event || []) {
        assert.equal(event.listen, "test");
        vm.runInNewContext(
          event.script.exec.join("\n"),
          { pm },
          {
            timeout: 1000,
            contextCodeGeneration: { strings: false, wasm: false },
          },
        );
      }
    });
});
