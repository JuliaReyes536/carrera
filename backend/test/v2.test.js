import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createDatabase } from "../src/db.js";
import { createApp } from "../src/app.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRepository } from "../src/repository.js";

test("convierte respaldos anteriores a corredores sin dependencias de equipamiento", async (t) => {
  const { api, r, client, credentials } = await raceFixture(t);
  const backup = (await api.get("/backup")).body;
  assert.equal(backup.version, 3);
  assert.equal(backup.sport, "running");
  const old = { ...backup, version: 2 };
  delete old.sport;
  old.records = old.records.map((record) => {
    const data = JSON.parse(record.data);
    if (record.kind === "runners")
      return {
        ...record,
        kind: "drivers",
        data: JSON.stringify({
          id: data.id,
          name: data.name,
          alias: "Nombre anterior",
          active: data.active,
        }),
      };
    if (record.kind === "races") {
      data.participants = data.participants.map(({ runnerId, ...p }) => ({
        ...p,
        driverId: runnerId,
        vehicleId: "legacy-equipment",
      }));
      delete data.lapDistance;
      return { ...record, data: JSON.stringify(data) };
    }
    return record;
  });
  old.records.push({
    kind: "vehicles",
    id: "legacy-equipment",
    data: JSON.stringify({ id: "legacy-equipment", name: "Registro anterior" }),
  });
  await api
    .post("/restore", { ...old, reason: "Adaptar respaldo anterior" })
    .expect(200);
  const login = (
    await client.post("/api/auth/login").send(credentials).expect(200)
  ).body;
  const race = (
    await client.get("/api/races/" + r.id).auth(login.token, { type: "bearer" })
  ).body;
  assert.equal(race.participants.length, 2);
  assert.equal(race.participants[0].vehicleId, undefined);
  assert.equal(race.leaderboard[0].runner.category, "Libre");
  assert.equal(race.lapDistance, null);
});

test("corredores con dorsal sin vehículo, distancia y ritmo por kilómetro", async (t) => {
  const { api, db, r, client } = await raceFixture(t);
  const path = `/races/${r.id}`;
  assert.equal(r.participants[0].vehicleId, undefined);
  await client.get("/api/vehicles").expect(410);
  await api
    .post("/runners", { name: "Ana Martínez", category: "Máster" })
    .expect(201);
  const people = (await api.get("/runners")).body;
  assert.equal(people.at(-1).team, "Independiente");
  assert.equal(people.at(-1).category, "Máster");
  await api.patch(path, { lapDistance: 0 }).expect(400);
  await api.post(path + "/start").expect(200);
  shift(db, r.id, 100000);
  const result = (
    await api
      .post(path + "/laps", {
        participantId: r.participants[0].id,
        requestId: "running-distance",
      })
      .expect(201)
  ).body;
  const leader = result.leaderboard[0];
  assert.equal(leader.distance, 400);
  assert.equal(leader.pace, (leader.total * 1000) / 400);
  assert.equal(leader.vehicle, undefined);
  assert.ok(leader.runner.name);
  const csv = (await api.get(path + "/export/csv")).text;
  assert.match(csv, /Corredor/);
  assert.match(csv, /Ritmo ms\/km/);
  assert.doesNotMatch(csv, /vehículo|piloto/i);
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((t) => t.name);
  assert.ok(tables.includes("tb_corredores"));
  assert.ok(!tables.includes("tb_vehiculos"));
});

test("adaptación de una base anterior conserva personas, vueltas y registros originales", (t) => {
  const db = createDatabase(":memory:");
  t.after(() => db.close());
  db.exec(`CREATE TABLE v2_meta(key TEXT PRIMARY KEY,value TEXT);INSERT INTO v2_meta VALUES ('legacy-import','1');
 CREATE TABLE tb_pilotos(id TEXT PRIMARY KEY,data TEXT);CREATE TABLE tb_carreras(id TEXT PRIMARY KEY,data TEXT);
 CREATE TABLE tb_participantes(carrera_id TEXT,data TEXT);CREATE TABLE tb_intentos(carrera_id TEXT,data TEXT);
 CREATE TABLE tb_cronometros(intento_id TEXT,data TEXT);CREATE TABLE tb_vueltas(carrera_id TEXT,data TEXT);
 CREATE TABLE tb_penalizaciones(carrera_id TEXT,data TEXT);CREATE TABLE tb_resultados(intento_id TEXT,data TEXT);`);
  const person = {
    id: "old-person",
    name: "Ana Martínez",
    alias: "Ana",
    active: true,
  };
  db.prepare("INSERT INTO tb_pilotos VALUES (?,?)").run(
    person.id,
    JSON.stringify(person),
  );
  const race = {
    id: "old-race",
    name: "Gran Premio",
    description: "Registro anterior",
    date: "2026-11-24",
    mode: "vueltas",
    target: 5,
    duration: 30,
    status: "pausada",
    attempt: 1,
  };
  db.prepare("INSERT INTO tb_carreras VALUES (?,?)").run(
    race.id,
    JSON.stringify(race),
  );
  db.prepare("INSERT INTO tb_participantes VALUES (?,?)").run(
    race.id,
    JSON.stringify({
      id: "old-entry",
      driverId: person.id,
      vehicleId: "old-car",
      number: 7,
      status: "activo",
      driverSnapshot: person,
    }),
  );
  db.prepare("INSERT INTO tb_intentos VALUES (?,?)").run(
    race.id,
    JSON.stringify({ number: 1 }),
  );
  db.prepare("INSERT INTO tb_cronometros VALUES (?,?)").run(
    "old-race:1",
    JSON.stringify({ accumulated: 100000, startedAt: null }),
  );
  db.prepare("INSERT INTO tb_vueltas VALUES (?,?)").run(
    race.id,
    JSON.stringify({
      id: "old-lap",
      participantId: "old-entry",
      attempt: 1,
      mark: 100000,
      duration: 100000,
      valid: true,
      date: "2026-11-24T12:00:00Z",
    }),
  );
  const repo = createRepository(db),
    converted = repo.find("races", race.id);
  assert.equal(converted.participants[0].runnerId, person.id);
  assert.equal(converted.participants[0].vehicleId, undefined);
  assert.equal(converted.lapDistance, null);
  assert.equal(converted.laps[0].mark, 100000);
  assert.equal(repo.all("runners")[0].category, "Libre");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM tb_pilotos").get().n, 1);
  createRepository(db);
  assert.equal(repo.all("races").length, 1);
  assert.equal(db.pragma("foreign_key_check").length, 0);
});

test("eliminación declara al último habilitado y resistencia respeta el periodo", async (t) => {
  const f = await raceFixture(t, { mode: "eliminación" }),
    path = `/races/${f.r.id}`;
  await f.api.post(path + "/start").expect(200);
  await f.api
    .post(path + "/penalties", {
      participantId: f.r.participants[1].id,
      type: "eliminado",
      reason: "Regla de eliminación",
    })
    .expect(201);
  const result = (await f.api.post(path + "/finish").expect(200)).body;
  assert.equal(result.results[0].winner, true);
  assert.equal(result.results[0].laps, 0);
  const g = await raceFixture(t, { mode: "resistencia", duration: 1 }),
    base = `/races/${g.r.id}`;
  await g.api.post(base + "/start");
  shift(g.db, g.r.id, 1000);
  await g.api
    .post(base + "/laps", {
      participantId: g.r.participants[0].id,
      requestId: "valid",
    })
    .expect(201);
  shift(g.db, g.r.id, 61000);
  await g.api
    .post(base + "/laps", {
      participantId: g.r.participants[1].id,
      requestId: "too-late",
    })
    .expect(400);
  assert.equal(
    (await g.api.post(base + "/finish").expect(200)).body.results[0].winner,
    true,
  );
});

test("empate justificado, reapertura autorizada y versiones oficiales conservadas", async (t) => {
  const { db, api, r } = await raceFixture(t, {
    mode: "contrarreloj",
    target: 1,
  });
  const path = `/races/${r.id}`;
  await api.post(path + "/start");
  const repo = createRepository(db),
    current = repo.find("races", r.id);
  current.timer = { accumulated: 2000, startedAt: null };
  current.status = "pausada";
  current.participants.forEach((p, i) => {
    p.status = "finalizado";
    current.laps.push({
      id: "tie-" + i,
      requestId: "tie-" + i,
      participantId: p.id,
      attempt: 1,
      mark: 1000,
      duration: 1000,
      valid: true,
      date: new Date().toISOString(),
    });
  });
  repo.save("races", current);
  await api.post(path + "/finish").expect(400);
  await api
    .post(path + "/tie-break", {
      participantId: r.participants[1].id,
      reason: "Decisión de comisarios",
    })
    .expect(200);
  let out = (await api.post(path + "/finish").expect(200)).body;
  assert.equal(out.results[0].id, r.participants[1].id);
  assert.equal(out.results[0].winner, true);
  await api.post(path + "/reopen", { reason: "" }).expect(400);
  out = (
    await api
      .post(path + "/reopen", { reason: "Revisión oficial autorizada" })
      .expect(200)
  ).body;
  assert.equal(out.status, "pausada");
  assert.equal(out.results.length, 0);
  assert.equal(out.revisions.length, 1);
  assert.equal((await api.get(path)).body.results.length, 0);
  await api.post(path + "/finish").expect(200);
  const publicRace = (await request(createApp(db)).get("/api" + path)).body;
  assert.equal(publicRace.revisions, undefined);
  assert.equal(publicRace.tieBreaks, undefined);
});

test("sesión expirada y respaldos inválidos no alteran la base", async (t) => {
  const { db, api, r } = await raceFixture(t);
  const backup = (await api.get("/backup")).body;
  for (const records of [[null], [{ kind: "users", id: "x", data: "null" }]])
    await api
      .post("/restore", { version: 2, reason: "Prueba", records })
      .expect(400);
  const broken = structuredClone(backup);
  const race = broken.records.find((x) => x.kind === "races");
  const data = JSON.parse(race.data);
  data.timer.accumulated = -1;
  race.data = JSON.stringify(data);
  await api.post("/restore", { ...broken, reason: "Prueba" }).expect(400);
  assert.equal((await api.get("/races/" + r.id)).body.participants.length, 2);
  db.prepare("UPDATE tb_sesiones SET expires_at=0").run();
  await api.get("/auth/me").expect(401);
});

test("SSE notifica cambios de carrera sin transmitir evidencia privada", async (t) => {
  const { db, token, r } = await raceFixture(t);
  const server = createApp(db).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const controller = new AbortController();
  t.after(() => {
    controller.abort();
    server.closeAllConnections();
    server.close();
  });
  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/api/events`,
    { signal: controller.signal },
  );
  assert.match(response.headers.get("content-type"), /text\/event-stream/);
  const reader = response.body.getReader();
  assert.match(
    new TextDecoder().decode((await reader.read()).value),
    /connected/,
  );
  await request(server)
    .post(`/api/races/${r.id}/start`)
    .auth(token, { type: "bearer" })
    .send({})
    .expect(200);
  const update = new TextDecoder().decode((await reader.read()).value);
  assert.match(update, /event: change/);
  assert.doesNotMatch(update, /password|corredor|reason/i);
  await reader.cancel();
});

async function fixture(t, path = ":memory:") {
  const db = createDatabase(path);
  t.after(() => db.close());
  const client = request(createApp(db));
  const credentials = {
    name: "Administración",
    email: "admin@example.test",
    password: "Testing-12345",
  };
  await client.post("/api/auth/setup").send(credentials).expect(201);
  const login = await client
    .post("/api/auth/login")
    .send(credentials)
    .expect(200);
  const token = login.body.token;
  const api = {
    get: (p) => client.get("/api" + p).auth(token, { type: "bearer" }),
    post: (p, b = {}) =>
      client
        .post("/api" + p)
        .auth(token, { type: "bearer" })
        .send(b),
    patch: (p, b) =>
      client
        .patch("/api" + p)
        .auth(token, { type: "bearer" })
        .send(b),
    delete: (p) => client.delete("/api" + p).auth(token, { type: "bearer" }),
  };
  return { db, client, api, token, credentials };
}
async function raceFixture(t, options = {}) {
  const f = await fixture(t),
    { api } = f;
  const runners = [],
    vehicles = [];
  for (let i = 0; i < 2; i++) {
    runners.push(
      (
        await api
          .post("/runners", { name: `Corredor ${i}`, team: `Alias ${i}` })
          .expect(201)
      ).body,
    );
  }
  let r = (
    await api
      .post("/races", {
        name: "Competencia de prueba",
        date: "2026-11-24",
        mode: "vueltas",
        target: 2,
        duration: 30,
        ...options,
      })
      .expect(201)
  ).body;
  for (let i = 0; i < 2; i++)
    r = (
      await api
        .post(`/races/${r.id}/participants`, {
          runnerId: runners[i].id,
          number: i + 1,
        })
        .expect(201)
    ).body;
  return { ...f, r, runners };
}
function shift(db, id, ms) {
  const race = JSON.parse(
    db.prepare("SELECT data FROM tb_competencias WHERE id=?").get(id).data,
  );
  const key = `${id}:${race.attempt}`;
  const timer = JSON.parse(
    db
      .prepare("SELECT data FROM tb_cronometros_corredores WHERE intento_id=?")
      .get(key).data,
  );
  timer.startedAt = Date.now() - ms;
  db.prepare(
    "UPDATE tb_cronometros_corredores SET data=? WHERE intento_id=?",
  ).run(JSON.stringify(timer), key);
}

test("autenticación, roles, sesiones, baja de usuarios y bloqueo de rutas antiguas", async (t) => {
  const { client, api, credentials, token } = await fixture(t);
  await client
    .post("/api/runners")
    .send({ name: "Intruso", team: "X" })
    .expect(401);
  await client.get("/api/users").expect(401);
  await client.post("/api/corredores").send({}).expect(410);
  await client.post("/api/auth/setup").send(credentials).expect(409);
  await client
    .post("/api/auth/login")
    .send({ ...credentials, password: "incorrecta" })
    .expect(401);
  const op = (
    await api
      .post("/users", {
        name: "Operador",
        email: "op@example.test",
        password: "Testing-12345",
        role: "operador",
      })
      .expect(201)
  ).body;
  assert.equal(op.passwordHash, undefined);
  const login = await client
    .post("/api/auth/login")
    .send({ email: op.email, password: "Testing-12345" })
    .expect(200);
  await client
    .post("/api/races")
    .auth(login.body.token, { type: "bearer" })
    .send({})
    .expect(403);
  await client
    .get("/api/audit")
    .auth(login.body.token, { type: "bearer" })
    .expect(403);
  await client
    .post("/api/runners")
    .auth(login.body.token, { type: "bearer" })
    .send({ name: "Ana", team: "Ghost" })
    .expect(201);
  await api.patch(`/users/${op.id}`, { active: false }).expect(200);
  await client
    .get("/api/auth/me")
    .auth(login.body.token, { type: "bearer" })
    .expect(401);
  const me = (await api.get("/auth/me")).body;
  await api.patch(`/users/${me.id}`, { active: false }).expect(400);
  await api.post("/auth/logout").expect(204);
  await client.get("/api/auth/me").auth(token, { type: "bearer" }).expect(401);
});

test("inscripciones únicas, estados, vueltas válidas, idempotencia y nuevos intentos", async (t) => {
  const { db, api, r, runners } = await raceFixture(t);
  const path = `/races/${r.id}`;
  await api
    .post(path + "/participants", {
      runnerId: runners[0].id,
      number: 1,
    })
    .expect(409);
  await api
    .post(path + "/laps", {
      participantId: r.participants[0].id,
      requestId: "paused",
    })
    .expect(400);
  const empty = (
    await api.post("/races", { name: "Vacía", date: "2026-11-24" })
  ).body;
  await api.post(`/races/${empty.id}/start`).expect(400);
  await api.post(path + "/prepare").expect(200);
  await api.patch(`/runners/${runners[0].id}`, { active: false }).expect(200);
  await api.post(path + "/start").expect(400);
  await api.patch(`/runners/${runners[0].id}`, { active: true }).expect(200);
  await api.post(path + "/start").expect(200);
  await api.post(path + "/start").expect(400);
  await api.patch(path, { target: 7 }).expect(400);
  shift(db, r.id, 1000);
  let out = (
    await api
      .post(path + "/laps", {
        participantId: r.participants[0].id,
        requestId: "lap-1",
        mark: -50,
      })
      .expect(201)
  ).body;
  assert.ok(out.laps[0].mark >= 1000);
  assert.equal(out.laps[0].duration, out.laps[0].mark);
  out = (
    await api
      .post(path + "/laps", {
        participantId: r.participants[0].id,
        requestId: "lap-1",
      })
      .expect(200)
  ).body;
  assert.equal(out.laps.length, 1);
  const paused = (await api.post(path + "/pause").expect(200)).body;
  const again = (await api.get(path).expect(200)).body;
  assert.equal(paused.elapsed, again.elapsed);
  await api
    .post(path + "/laps", {
      participantId: r.participants[0].id,
      requestId: "bad",
    })
    .expect(400);
  await api.post(path + "/resume").expect(200);
  shift(db, r.id, 2000);
  out = (
    await api
      .post(path + "/laps", {
        participantId: r.participants[0].id,
        requestId: "lap-2",
      })
      .expect(201)
  ).body;
  assert.equal(out.leaderboard[0].laps, 2);
  assert.equal(out.leaderboard[0].status, "finalizado");
  await api
    .post(path + "/laps", {
      participantId: r.participants[0].id,
      requestId: "lap-3",
    })
    .expect(400);
  await api.post(path + "/reset", { reason: "Nueva salida" }).expect(200);
  out = (await api.get(path)).body;
  assert.equal(out.attempt, 2);
  assert.equal(out.elapsed, 0);
  assert.equal(out.laps.length, 2);
  assert.equal(out.leaderboard[0].laps, 0);
  assert.equal(out.attempts.length, 1);
  const history = (
    await api.delete(path + "/participants/" + r.participants[0].id).expect(200)
  ).body;
  assert.equal(history.laps.length, 2);
  assert.equal(
    history.participants.find((p) => p.id === r.participants[0].id).status,
    "retirado",
  );
});

test("penalizaciones, correcciones auditadas, ganador y exportaciones", async (t) => {
  const { db, api, r, client } = await raceFixture(t, { target: 1 });
  const path = `/races/${r.id}`;
  await api.post(path + "/start");
  shift(db, r.id, 1000);
  const one = (
    await api.post(path + "/laps", {
      participantId: r.participants[0].id,
      requestId: "one",
    })
  ).body;
  shift(db, r.id, 2000);
  await api
    .post(path + "/laps", {
      participantId: r.participants[1].id,
      requestId: "two",
    })
    .expect(201);
  await api
    .post(path + "/penalties", {
      participantId: r.participants[0].id,
      type: "tiempo",
      value: 5000,
      reason: "",
    })
    .expect(400);
  let out = (
    await api
      .post(path + "/penalties", {
        participantId: r.participants[0].id,
        type: "tiempo",
        value: 5000,
        reason: "Salida anticipada",
      })
      .expect(201)
  ).body;
  assert.equal(out.leaderboard[0].id, r.participants[1].id);
  await api
    .patch(path + `/laps/${one.laps[0].id}`, { mark: -1, reason: "Corrección" })
    .expect(400);
  await api
    .patch(path + `/laps/${one.laps[0].id}`, {
      mark: 900,
      reason: "Corrección validada",
    })
    .expect(200);
  out = (await api.post(path + "/finish").expect(200)).body;
  assert.equal(out.results[0].winner, true);
  assert.equal(out.results[0].id, r.participants[1].id);
  await api
    .post(path + "/laps", {
      participantId: r.participants[0].id,
      requestId: "closed",
    })
    .expect(400);
  await api
    .patch(path + `/laps/${one.laps[0].id}`, { valid: false, reason: "Tardío" })
    .expect(400);
  const csv = await api.get(path + "/export/csv").expect(200);
  assert.match(csv.headers["content-type"], /text\/csv/);
  assert.match(csv.text, /Competencia de prueba/);
  const pdf = await api.get(path + "/export/pdf").expect(200);
  assert.match(pdf.headers["content-type"], /application\/pdf/);
  assert.ok(pdf.body.length > 1000);
  await client.get("/api" + path + "/export/pdf").expect(401);
  const audits = (await api.get("/audit")).body;
  assert.ok(audits.some((a) => a.reason === "Corrección validada"));
  await api.post(path + "/archive").expect(200);
  await api.post(path + "/start").expect(400);
});

test("descalificación excluida, anulación conserva evidencia y recalcula duraciones", async (t) => {
  const { db, api, r } = await raceFixture(t, { target: 5 });
  const path = `/races/${r.id}`;
  await api.post(path + "/start");
  shift(db, r.id, 1000);
  const a = (
    await api.post(path + "/laps", {
      participantId: r.participants[0].id,
      requestId: "a",
    })
  ).body.laps[0];
  shift(db, r.id, 2000);
  await api.post(path + "/laps", {
    participantId: r.participants[0].id,
    requestId: "b",
  });
  let out = (
    await api
      .patch(path + `/laps/${a.id}`, {
        valid: false,
        reason: "Captura duplicada",
      })
      .expect(200)
  ).body;
  assert.equal(out.laps.length, 2);
  assert.equal(out.laps[0].valid, false);
  assert.equal(out.laps[1].duration, out.laps[1].mark);
  out = (
    await api
      .post(path + "/penalties", {
        participantId: r.participants[0].id,
        type: "descalificado",
        reason: "Infracción",
      })
      .expect(201)
  ).body;
  assert.equal(
    out.leaderboard.find((p) => p.id === r.participants[0].id).position,
    null,
  );
  await api
    .post(path + "/laps", {
      participantId: r.participants[0].id,
      requestId: "c",
    })
    .expect(400);
});

test("respaldo, restauración validada, copia previa y revocación de sesiones", async (t) => {
  const { api, r, db, client, credentials } = await raceFixture(t);
  const backup = (await api.get("/backup").expect(200)).body;
  await api
    .post("/restore", {
      ...backup,
      reason: "Restauración de prueba",
      records: backup.records.filter((x) => x.kind !== "runners"),
    })
    .expect(400);
  assert.equal((await api.get("/races")).body.length, 1);
  await api
    .post("/restore", { ...backup, reason: "Restauración de prueba" })
    .expect(200);
  await api.get("/auth/me").expect(401);
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM v2_restore_safety").get().n,
    1,
  );
  const login = await client
    .post("/api/auth/login")
    .send(credentials)
    .expect(200);
  const race = (await client.get("/api/races/" + r.id)).body;
  assert.equal(race.participants.length, 2);
  assert.ok(login.body.token);
});

test("importación no destructiva del historial V1 y persistencia tras reinicio", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "cdm-v2-"));
  const path = join(dir, "test.sqlite");
  let db = createDatabase(path);
  db.exec(
    `CREATE TABLE Pilotos(id INTEGER PRIMARY KEY,nombre TEXT,alias TEXT,vehiculo TEXT,numero INTEGER);CREATE TABLE Vueltas(id INTEGER PRIMARY KEY,piloto_id INTEGER,tiempo_registrado INTEGER,fecha TEXT);`,
  );
  db.prepare(
    "INSERT INTO Pilotos(nombre,alias,vehiculo,numero) VALUES ('Ana','Ghost','Interceptor',7)",
  ).run();
  db.prepare(
    "INSERT INTO Vueltas(piloto_id,tiempo_registrado,fecha) VALUES (1,1234,'2026-11-24T12:00:00Z')",
  ).run();
  let client = request(createApp(db));
  let out = (await client.get("/api/races").expect(200)).body;
  assert.equal(out[0].status, "archivada");
  assert.equal(out[0].laps[0].mark, 1234);
  assert.equal(out[0].laps[0].valid, false);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM Pilotos").get().n, 1);
  db.close();
  db = createDatabase(path);
  t.after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  client = request(createApp(db));
  out = (await client.get("/api/races")).body;
  assert.equal(out.length, 1);
  assert.equal(out[0].participants.length, 1);
});
