import express from 'express';
import cors from 'cors';

const estados = ['activo', 'penalizado', 'ganador', 'eliminado'];
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
function id(value) {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) throw fail('ID inválido');
  return Number(value);
}
function pilotoInput(body, update = false) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail('Se requiere un objeto JSON');
  const out = {};
  for (const key of ['nombre', 'alias', 'vehiculo']) {
    if (typeof body[key] !== 'string' || !body[key].trim() || body[key].trim().length > 100) throw fail(`${key}: obligatorio, máximo 100 caracteres`);
    out[key] = body[key].trim();
  }
  if (!Number.isInteger(body.numero) || body.numero < 0 || body.numero > 999) throw fail('Número: entero entre 0 y 999');
  out.numero = body.numero;
  out.estado = body.estado ?? (update ? null : 'activo');
  if (!estados.includes(out.estado)) throw fail('Estado inválido');
  return out;
}
export function createApp(db) {
  const app = express();
  app.use(cors({ origin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173' }));
  app.use(express.json({ limit: '32kb' }));
  const getPiloto = value => {
    const row = db.prepare('SELECT * FROM Pilotos WHERE id = ?').get(id(value));
    if (!row) throw fail('Piloto no encontrado', 404);
    return row;
  };
  const clock = () => {
    const row = db.prepare('SELECT * FROM Cronometro WHERE id = 1').get();
    const now = Date.now();
    return { id: 1, tiempo_global: row.tiempo_global + (row.estado === 'corriendo' ? Math.max(0, now - row.iniciado_en) : 0), estado: row.estado, servidor_ahora: now };
  };
  const control = db.transaction(action => {
    const current = clock();
    if (action === 'reiniciar') db.prepare("UPDATE Cronometro SET tiempo_global = 0, estado = 'pausado', iniciado_en = NULL WHERE id = 1").run();
    else if (action === 'pausar') db.prepare("UPDATE Cronometro SET tiempo_global = ?, estado = 'pausado', iniciado_en = NULL WHERE id = 1").run(current.tiempo_global);
    else if (current.estado !== 'corriendo') db.prepare("UPDATE Cronometro SET estado = 'corriendo', iniciado_en = ? WHERE id = 1").run(current.servidor_ahora);
    return clock();
  });
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/api/pilotos', (_req, res) => res.json(db.prepare('SELECT * FROM Pilotos ORDER BY id').all()));
  app.get('/api/pilotos/:id', (req, res) => res.json(getPiloto(req.params.id)));
  app.post('/api/pilotos', (req, res) => {
    const p = pilotoInput(req.body);
    const result = db.prepare('INSERT INTO Pilotos(nombre,alias,vehiculo,numero,estado) VALUES (@nombre,@alias,@vehiculo,@numero,@estado)').run(p);
    res.status(201).json(getPiloto(String(result.lastInsertRowid)));
  });
  app.put('/api/pilotos/:id', (req, res) => {
    const previous = getPiloto(req.params.id);
    const p = pilotoInput(req.body, true);
    db.prepare('UPDATE Pilotos SET nombre=@nombre,alias=@alias,vehiculo=@vehiculo,numero=@numero,estado=@estado WHERE id=@id').run({ ...p, id: previous.id });
    res.json(getPiloto(req.params.id));
  });
  app.delete('/api/pilotos/:id', (req, res) => {
    const p = getPiloto(req.params.id);
    db.prepare('DELETE FROM Pilotos WHERE id = ?').run(p.id);
    res.sendStatus(204);
  });
  app.get('/api/pilotos/:id/vueltas', (req, res) => {
    const p = getPiloto(req.params.id);
    res.json(db.prepare('SELECT * FROM Vueltas WHERE piloto_id = ? ORDER BY id DESC').all(p.id));
  });
  app.post('/api/pilotos/:id/vueltas', (req, res) => {
    const row = db.transaction(() => {
      const p = getPiloto(req.params.id);
      const current = clock();
      const result = db.prepare('INSERT INTO Vueltas(piloto_id,tiempo_registrado,fecha) VALUES (?,?,?)').run(p.id, current.tiempo_global, new Date(current.servidor_ahora).toISOString());
      return db.prepare('SELECT * FROM Vueltas WHERE id = ?').get(result.lastInsertRowid);
    })();
    res.status(201).json(row);
  });
  app.put('/api/vueltas/:id', (req, res) => {
    const key = id(req.params.id);
    if (!Number.isSafeInteger(req.body?.tiempo_registrado) || req.body?.tiempo_registrado < 0) throw fail('Tiempo inválido: usa milisegundos enteros positivos o cero');
    const result = db.prepare('UPDATE Vueltas SET tiempo_registrado = ? WHERE id = ?').run(req.body?.tiempo_registrado, key);
    if (!result.changes) throw fail('Vuelta no encontrada', 404);
    res.json(db.prepare('SELECT * FROM Vueltas WHERE id = ?').get(key));
  });
  app.delete('/api/vueltas/:id', (req, res) => {
    if (!db.prepare('DELETE FROM Vueltas WHERE id = ?').run(id(req.params.id)).changes) throw fail('Vuelta no encontrada', 404);
    res.sendStatus(204);
  });
  app.get('/api/cronometro', (_req, res) => res.json(clock()));
  app.post('/api/cronometro', (_req, res) => res.json(control('reanudar')));
  app.put('/api/cronometro', (req, res) => {
    if (!['pausar', 'reiniciar', 'reanudar'].includes(req.body?.accion)) throw fail('Acción inválida');
    res.json(control(req.body?.accion));
  });
  app.use((_req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));
  app.use((err, _req, res, _next) => {
    const duplicate = err.code === 'SQLITE_CONSTRAINT_UNIQUE';
    const status = duplicate ? 409 : err.status || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: duplicate ? 'Ya existe un piloto con ese número' : status >= 500 ? 'Error interno del servidor' : err.message });
  });
  return app;
}
