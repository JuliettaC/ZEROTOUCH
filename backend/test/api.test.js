import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture, request } from "./helpers.js";
import { openDatabase, validateDatabasePath } from "../src/config/database.js";
import { readConfig, root } from "../src/config/env.js";
import path from "node:path";
const prefix = "/api/v1";

test("CRUD real de perfiles y contextos, relaciones y reinicio del proceso", async (t) => {
  const f = await fixture(t);
  let server = await f.start();
  const call = (method, route, body) =>
    request(server.base, method, prefix + route, body);
  assert.equal((await request(server.base, "GET", "/api/health")).status, 200);
  const created = await call("POST", "/profiles", {
    name: "Persona demo",
    gaze: false,
  });
  assert.equal(created.status, 201);
  assert.ok(created.headers.get("location"));
  const p = created.body.data;
  assert.equal(p.gaze, false);
  assert.equal((await call("GET", "/profiles")).body.data.length, 1);
  assert.equal(
    (await call("GET", `/profiles/${p.id}`)).body.data.name,
    "Persona demo",
  );
  assert.equal(
    (await call("PATCH", `/profiles/${p.id}`, { description: "Prueba" })).body
      .data.description,
    "Prueba",
  );
  const createdContext = await call("POST", "/contexts", {
    profileId: p.id,
    name: " Cocina ",
    pinch: false,
  });
  assert.equal(createdContext.status, 201);
  const c = createdContext.body.data;
  assert.equal(c.name, "Cocina");
  assert.equal(c.pinch, false);
  assert.equal(c.sensitivity, 65);
  assert.equal(
    (await call("GET", `/contexts?profileId=${p.id}`)).body.data.length,
    1,
  );
  assert.equal(
    (await call("GET", `/contexts/${c.id}`)).body.data.profileId,
    p.id,
  );
  assert.equal(
    (
      await call("PATCH", `/contexts/${c.id}`, {
        sensitivity: 90,
        scroll: false,
      })
    ).body.data.sensitivity,
    90,
  );
  const duplicate = await call("POST", "/contexts", {
    profileId: p.id,
    name: "COCINA",
  });
  assert.equal(duplicate.status, 409);
  assert.equal((await call("DELETE", `/profiles/${p.id}`)).status, 409);
  await server.stop();
  server = await f.start();
  assert.equal(
    (await call("GET", `/profiles/${p.id}`)).body.data.description,
    "Prueba",
  );
  const persisted = (await call("GET", `/contexts/${c.id}`)).body.data;
  assert.equal(persisted.sensitivity, 90);
  assert.equal(persisted.scroll, false);
  assert.equal((await call("DELETE", `/contexts/${c.id}`)).status, 204);
  assert.equal((await call("GET", `/contexts/${c.id}`)).status, 404);
  assert.equal((await call("DELETE", `/profiles/${p.id}`)).status, 204);
  assert.equal((await call("GET", `/profiles/${p.id}`)).status, 404);
});

test("errores de contrato, UUID, tipos, relaciones y JSON", async (t) => {
  const f = await fixture(t);
  const server = await f.start();
  const call = (method, route, body, options) =>
    request(server.base, method, prefix + route, body, options);
  const profile = (await call("POST", "/profiles", { name: "Validación" })).body
    .data;
  for (const resource of ["profiles", "contexts"]) {
    await t.test(
      `${resource}: recursos inexistentes y UUID inválido`,
      async () => {
        for (const method of ["GET", "PATCH", "DELETE"]) {
          const body = method === "PATCH" ? { name: "Cambio" } : undefined;
          assert.equal(
            (await call(method, `/${resource}/${randomUUID()}`, body)).status,
            404,
          );
          assert.equal(
            (await call(method, `/${resource}/invalid`, body)).status,
            400,
          );
        }
      },
    );
    const valid =
      resource === "profiles"
        ? { name: "Persona" }
        : { name: "Contexto", profileId: profile.id };
    for (const body of [
      {},
      { ...valid, name: "" },
      { ...valid, name: 4 },
      { ...valid, name: "a".repeat(61) },
      { ...valid, extra: true },
      [],
      null,
    ]) {
      assert.equal((await call("POST", `/${resource}`, body)).status, 400);
    }
    const id = (await call("POST", `/${resource}`, valid)).body.data.id;
    assert.equal((await call("PATCH", `/${resource}/${id}`, {})).status, 400);
    assert.equal(
      (await call("PATCH", `/${resource}/${id}`, { id: randomUUID() })).status,
      400,
    );
    assert.equal(
      (await call("POST", `/${resource}`, "{bad", { raw: true })).status,
      400,
    );
    assert.equal(
      (
        await call("POST", `/${resource}`, valid, {
          headers: { "content-type": "text/plain" },
        })
      ).status,
      415,
    );
    assert.equal((await call("GET", `/${resource}?limit=0`)).status, 400);
    assert.equal((await call("GET", `/${resource}?offset=-1`)).status, 400);
    assert.equal(
      (await call("GET", `/${resource}?limit=2&limit=3`)).status,
      400,
    );
    assert.equal((await call("GET", `/${resource}?unknown=1`)).status, 400);
    assert.equal((await call("PUT", `/${resource}/${id}`, valid)).status, 404);
  }
  for (const body of [
    { gaze: 1 },
    { proximity: "false" },
    { description: null },
    { description: "x".repeat(301) },
  ])
    assert.equal(
      (await call("POST", "/profiles", { name: "Prueba", ...body })).status,
      400,
    );
  for (const body of [
    { sensitivity: -1 },
    { sensitivity: 101 },
    { stability: 1.5 },
    { stability: "40" },
    { pinch: 0 },
    { deskRest: null },
    { scroll: "true" },
  ])
    assert.equal(
      (
        await call("POST", "/contexts", {
          name: "Prueba",
          profileId: profile.id,
          ...body,
        })
      ).status,
      400,
    );
  assert.equal(
    (
      await call("POST", "/contexts", {
        name: "Huérfano",
        profileId: randomUUID(),
      })
    ).status,
    404,
  );
  assert.equal(
    (await call("GET", `/contexts?profileId=${randomUUID()}`)).status,
    404,
  );
  assert.equal(
    (
      await call("POST", "/profiles", {
        name: "x",
        description: "x".repeat(17000),
      })
    ).status,
    413,
  );
  const missing = await call("GET", "/missing");
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, "ROUTE_NOT_FOUND");
});

test("unicidad por perfil, PATCH atómico y entradas SQL tratadas como datos", async (t) => {
  const f = await fixture(t);
  const server = await f.start();
  const call = (m, r, b) => request(server.base, m, prefix + r, b);
  const p = (
    await call("POST", "/profiles", {
      name: "Robert'); DROP TABLE profiles;--",
    })
  ).body.data;
  const p2 = (await call("POST", "/profiles", { name: "Otro" })).body.data;
  const a = (
    await call("POST", "/contexts", { name: "Cocina", profileId: p.id })
  ).body.data;
  const b = (
    await call("POST", "/contexts", { name: "Taller", profileId: p.id })
  ).body.data;
  assert.equal(
    (await call("POST", "/contexts", { name: "Cocina", profileId: p2.id }))
      .status,
    201,
  );
  assert.equal(
    (
      await call("PATCH", `/contexts/${b.id}`, {
        name: " cocina ",
        sensitivity: 99,
      })
    ).status,
    409,
  );
  assert.equal(
    (await call("GET", `/contexts/${b.id}`)).body.data.sensitivity,
    65,
  );
  assert.equal(
    (await call("PATCH", `/contexts/${a.id}`, { profileId: p2.id })).status,
    400,
  );
  const list = await call("GET", "/profiles?limit=1&offset=1");
  assert.equal(list.body.data.length, 1);
  assert.equal((await call("GET", `/profiles/${p.id}`)).body.data.name, p.name);
});

test("integridad SQL e inicialización no destructiva", async (t) => {
  const f = await fixture(t);
  const db = openDatabase(f.filename);
  t.after(() => {
    if (db.open) db.close();
  });
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO profiles (id,name,created_at,updated_at) VALUES (?,?,?,?)",
  ).run(id, "SQL", now, now);
  const insert = db.prepare(
    "INSERT INTO contexts (id,profile_id,name,name_key,sensitivity,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
  );
  assert.throws(
    () => insert.run(randomUUID(), randomUUID(), "x", "x", 65, now, now),
    /FOREIGN KEY/,
  );
  assert.throws(
    () => insert.run(randomUUID(), id, "x", "x", 200, now, now),
    /CHECK/,
  );
  insert.run(randomUUID(), id, "x", "x", 65, now, now);
  assert.throws(
    () => insert.run(randomUUID(), id, "x", "x", 65, now, now),
    /UNIQUE/,
  );
  assert.throws(
    () => db.prepare("DELETE FROM profiles WHERE id=?").run(id),
    /FOREIGN KEY/,
  );
  assert.equal(db.pragma("integrity_check", { simple: true }), "ok");
  db.close();
  const reopened = openDatabase(f.filename, { initialize: true });
  assert.equal(
    reopened.prepare("SELECT count(*) AS n FROM contexts").get().n,
    1,
  );
  reopened.close();
});

test("configuración segura y ubicación fuera de OneDrive", () => {
  for (const PORT of ["abc", "70000", "-1", "1.5", ""])
    assert.throws(() => readConfig({ PORT }), /PORT/);
  assert.throws(() => readConfig({ NODE_ENV: "other" }), /NODE_ENV/);
  assert.throws(() => readConfig({ HOST: "0.0.0.0" }), /HOST/);
  assert.throws(() => validateDatabasePath(":memory:"), /absoluta/);
  assert.throws(
    () => validateDatabasePath(path.join(root, "OneDrive", "database.sqlite")),
    /OneDrive/,
  );
  assert.ok(
    !validateDatabasePath(readConfig().databasePath)
      .toLowerCase()
      .includes("onedrive"),
  );
});
