import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createDatabase } from '../src/db.js';
import { createApp } from '../src/app.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('CRUD, validación, vueltas, cronómetro y cascada', async t => {
  const db = createDatabase(':memory:');
  t.after(() => db.close());
  const api = request(createApp(db));
  const input = { nombre: 'Ana', alias: 'Neon', vehiculo: 'Interceptor', numero: 7 };
  const created = await api.post('/api/pilotos').send(input).expect(201);
  const id = created.body.id;
  await api.post('/api/pilotos').send(input).expect(409);
  await api.post('/api/pilotos').send({ ...input, nombre: ' ' }).expect(400);
  await api.put(`/api/pilotos/${id}`).send({ ...input, estado: 'ganador' }).expect(200);
  assert.equal((await api.get(`/api/pilotos/${id}`)).body.estado, 'ganador');
  await api.post('/api/cronometro').expect(200);
  db.prepare('UPDATE Cronometro SET iniciado_en = ? WHERE id = 1').run(Date.now() - 1500);
  const lap = await api.post(`/api/pilotos/${id}/vueltas`).send({ tiempo_registrado: 999999 }).expect(201);
  assert.ok(lap.body.tiempo_registrado >= 1500 && lap.body.tiempo_registrado < 10000);
  const paused = await api.put('/api/cronometro').send({ accion: 'pausar' }).expect(200);
  assert.equal(paused.body.estado, 'pausado');
  const again = await api.get('/api/cronometro').expect(200);
  assert.equal(again.body.tiempo_global, paused.body.tiempo_global);
  const histories = await api.get(`/api/pilotos/${id}/vueltas`).expect(200);
  assert.equal(histories.body.length, 1);
  await api.put(`/api/vueltas/${lap.body.id}`).send({ tiempo_registrado: 42 }).expect(200);
  const second = await api.post(`/api/pilotos/${id}/vueltas`).expect(201);
  await api.delete(`/api/vueltas/${second.body.id}`).expect(204);
  await api.put('/api/cronometro').send({ accion: 'reiniciar' }).expect(200);
  assert.equal((await api.get('/api/cronometro')).body.tiempo_global, 0);
  assert.equal((await api.get(`/api/pilotos/${id}/vueltas`)).body.length, 1);
  await api.delete(`/api/pilotos/${id}`).expect(204);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM Vueltas').get().n, 0);
  await api.get(`/api/pilotos/${id}`).expect(404);
  await api.get('/api/pilotos/abc').expect(400);
  await api.put('/api/cronometro').send({ accion: 'invalid' }).expect(400);
  await api.post('/api/pilotos').set('Content-Type', 'application/json').send('{bad').expect(400);
  const cors = await api.options('/api/pilotos').set('Origin', 'http://localhost:5173').set('Access-Control-Request-Method', 'POST').expect(204);
  assert.equal(cors.headers['access-control-allow-origin'], 'http://localhost:5173');
});

test('persistencia de pilotos, vueltas y reloj al reabrir SQLite', t => {
  const dir = mkdtempSync(join(tmpdir(), 'carrera-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'test.sqlite');
  let db = createDatabase(path);
  db.prepare("INSERT INTO Pilotos(nombre,alias,vehiculo,numero) VALUES ('A','B','C',1)").run();
  db.prepare("INSERT INTO Vueltas(piloto_id,tiempo_registrado,fecha) VALUES (1,123,'2026-10-29T00:00:00Z')").run();
  const start = Date.now() - 2000;
  db.prepare("UPDATE Cronometro SET tiempo_global = 100, estado = 'corriendo', iniciado_en = ? WHERE id = 1").run(start);
  db.close();
  db = createDatabase(path);
  try {
    assert.equal(db.prepare('SELECT nombre FROM Pilotos').get().nombre, 'A');
    assert.equal(db.prepare('SELECT tiempo_registrado FROM Vueltas').get().tiempo_registrado, 123);
    assert.equal(db.prepare('SELECT iniciado_en FROM Cronometro').get().iniciado_en, start);
  } finally { db.close(); }
});
