// Relational SQLite storage. JSON retains flexible snapshots; foreign keys and
// unique constraints enforce identities, inscriptions, attempts and lap requests.
import { randomUUID } from "node:crypto";
import { importRunning, asRace, asRunner } from "./running-migration.js";
const tables = {
  users: "tb_usuarios",
  runners: "tb_corredores",
  races: "tb_competencias",
  audit: "tb_auditoria",
  settings: "tb_configuracion",
};
export function createRepository(db) {
  db.exec(`
 CREATE TABLE IF NOT EXISTS tb_roles(id TEXT PRIMARY KEY, nombre TEXT NOT NULL UNIQUE);
 INSERT OR IGNORE INTO tb_roles VALUES ('administrador','Administrador'),('operador','Operador');
 CREATE TABLE IF NOT EXISTS tb_usuarios(id TEXT PRIMARY KEY, correo TEXT NOT NULL UNIQUE COLLATE NOCASE, rol_id TEXT NOT NULL REFERENCES tb_roles(id), data TEXT NOT NULL CHECK(json_valid(data)));
 CREATE TABLE IF NOT EXISTS tb_sesiones(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES tb_usuarios(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS tb_corredores(id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
 CREATE TABLE IF NOT EXISTS tb_competencias(id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
 CREATE TABLE IF NOT EXISTS tb_inscripciones(id TEXT PRIMARY KEY, carrera_id TEXT NOT NULL REFERENCES tb_competencias(id), corredor_id TEXT NOT NULL REFERENCES tb_corredores(id), numero INTEGER NOT NULL CHECK(numero BETWEEN 0 AND 999), data TEXT NOT NULL CHECK(json_valid(data)), UNIQUE(carrera_id,corredor_id), UNIQUE(carrera_id,numero), UNIQUE(id,carrera_id));
 CREATE TABLE IF NOT EXISTS tb_intentos_corredores(id TEXT PRIMARY KEY, carrera_id TEXT NOT NULL REFERENCES tb_competencias(id), numero INTEGER NOT NULL CHECK(numero>0), data TEXT NOT NULL CHECK(json_valid(data)), UNIQUE(carrera_id,numero), UNIQUE(id,carrera_id));
 CREATE TABLE IF NOT EXISTS tb_cronometros_corredores(id TEXT PRIMARY KEY, intento_id TEXT NOT NULL UNIQUE REFERENCES tb_intentos_corredores(id), data TEXT NOT NULL CHECK(json_valid(data)));
 CREATE TABLE IF NOT EXISTS tb_vueltas_corredores(id TEXT PRIMARY KEY, carrera_id TEXT NOT NULL REFERENCES tb_competencias(id), participante_id TEXT NOT NULL, intento_id TEXT NOT NULL, request_id TEXT, marca_ms INTEGER NOT NULL CHECK(marca_ms>=0), duracion_ms INTEGER NOT NULL CHECK(duracion_ms>=0), data TEXT NOT NULL CHECK(json_valid(data)), FOREIGN KEY(participante_id,carrera_id) REFERENCES tb_inscripciones(id,carrera_id), FOREIGN KEY(intento_id,carrera_id) REFERENCES tb_intentos_corredores(id,carrera_id), UNIQUE(intento_id,request_id));
 CREATE TABLE IF NOT EXISTS tb_sanciones_corredores(id TEXT PRIMARY KEY, carrera_id TEXT NOT NULL REFERENCES tb_competencias(id), participante_id TEXT NOT NULL, intento_id TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)), FOREIGN KEY(participante_id,carrera_id) REFERENCES tb_inscripciones(id,carrera_id), FOREIGN KEY(intento_id,carrera_id) REFERENCES tb_intentos_corredores(id,carrera_id));
 CREATE TABLE IF NOT EXISTS tb_clasificaciones_corredores(id TEXT PRIMARY KEY, carrera_id TEXT NOT NULL REFERENCES tb_competencias(id), participante_id TEXT NOT NULL, intento_id TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)), FOREIGN KEY(participante_id,carrera_id) REFERENCES tb_inscripciones(id,carrera_id), FOREIGN KEY(intento_id,carrera_id) REFERENCES tb_intentos_corredores(id,carrera_id), UNIQUE(participante_id,intento_id));
 CREATE TABLE IF NOT EXISTS tb_auditoria(id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
 CREATE TABLE IF NOT EXISTS tb_configuracion(id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
 CREATE INDEX IF NOT EXISTS idx_running_inscripciones ON tb_inscripciones(carrera_id);
 CREATE INDEX IF NOT EXISTS idx_running_vueltas ON tb_vueltas_corredores(carrera_id,intento_id,participante_id);
 CREATE INDEX IF NOT EXISTS idx_running_sanciones ON tb_sanciones_corredores(carrera_id,intento_id);
 CREATE INDEX IF NOT EXISTS idx_sesiones_expiracion ON tb_sesiones(expires_at);
 `);
  const parse = (row) => JSON.parse(row.data);
  const children = (table, raceId) =>
    db
      .prepare(`SELECT data FROM ${table} WHERE carrera_id=? ORDER BY rowid`)
      .all(raceId)
      .map(parse);
  function hydrate(r) {
    const current = `${r.id}:${r.attempt}`;
    return {
      ...r,
      participants: children("tb_inscripciones", r.id),
      attempts: children("tb_intentos_corredores", r.id).filter(
        (a) => a.number !== r.attempt,
      ),
      timer: parse(
        db
          .prepare(
            "SELECT data FROM tb_cronometros_corredores WHERE intento_id=?",
          )
          .get(current),
      ),
      laps: children("tb_vueltas_corredores", r.id),
      penalties: children("tb_sanciones_corredores", r.id),
      results: db
        .prepare(
          "SELECT data FROM tb_clasificaciones_corredores WHERE intento_id=? ORDER BY rowid",
        )
        .all(current)
        .map(parse),
    };
  }
  const all = (kind) =>
    db
      .prepare(`SELECT data FROM ${tables[kind]} ORDER BY rowid`)
      .all()
      .map(parse)
      .map((row) => (kind === "races" ? hydrate(row) : row));
  const find = (kind, id) => {
    const row = db
      .prepare(`SELECT data FROM ${tables[kind]} WHERE id=?`)
      .get(id);
    if (!row)
      throw Object.assign(new Error("Registro no encontrado."), {
        status: 404,
      });
    return kind === "races" ? hydrate(parse(row)) : parse(row);
  };
  function put(table, row, extra = {}) {
    const values = { id: row.id, ...extra, data: JSON.stringify(row) },
      keys = Object.keys(values);
    db.prepare(
      `INSERT INTO ${table}(${keys.join(",")}) VALUES (${keys.map((k) => "@" + k).join(",")}) ON CONFLICT(id) DO UPDATE SET ${keys
        .filter((k) => k !== "id")
        .map((k) => `${k}=excluded.${k}`)
        .join(",")}`,
    ).run(values);
  }
  const save = db.transaction((kind, row) => {
    if (kind === "users")
      put(tables[kind], row, { correo: row.email, rol_id: row.role });
    else if (kind !== "races") put(tables[kind], row);
    else {
      const {
        participants,
        attempts,
        timer,
        laps,
        penalties,
        results,
        ...base
      } = row;
      put("tb_competencias", base);
      const ids = new Set(participants.map((p) => p.id));
      for (const p of db
        .prepare("SELECT id FROM tb_inscripciones WHERE carrera_id=?")
        .all(row.id))
        if (!ids.has(p.id))
          db.prepare("DELETE FROM tb_inscripciones WHERE id=?").run(p.id);
      for (const p of participants)
        put("tb_inscripciones", p, {
          carrera_id: row.id,
          corredor_id: p.runnerId,
          numero: p.number,
        });
      for (const attempt of [...attempts, { number: row.attempt }]) {
        const key = `${row.id}:${attempt.number}`;
        put(
          "tb_intentos_corredores",
          { ...attempt, id: key },
          { carrera_id: row.id, numero: attempt.number },
        );
        if (attempt.number !== row.attempt)
          put(
            "tb_cronometros_corredores",
            { id: key, accumulated: attempt.elapsed, startedAt: null },
            { intento_id: key },
          );
      }
      const key = `${row.id}:${row.attempt}`;
      put(
        "tb_cronometros_corredores",
        { ...timer, id: key },
        { intento_id: key },
      );
      for (const l of laps)
        put("tb_vueltas_corredores", l, {
          carrera_id: row.id,
          participante_id: l.participantId,
          intento_id: `${row.id}:${l.attempt}`,
          request_id: l.requestId || null,
          marca_ms: l.mark,
          duracion_ms: l.duration,
        });
      for (const p of penalties)
        put("tb_sanciones_corredores", p, {
          carrera_id: row.id,
          participante_id: p.participantId,
          intento_id: `${row.id}:${p.attempt}`,
        });
      db.prepare(
        "DELETE FROM tb_clasificaciones_corredores WHERE intento_id=?",
      ).run(key);
      for (const p of results || [])
        put(
          "tb_clasificaciones_corredores",
          { ...p, id: `${key}:${p.id}`, participantId: p.id },
          { carrera_id: row.id, participante_id: p.id, intento_id: key },
        );
    }
    return row;
  });
  // Result row storage IDs are internal; the API keeps participant IDs stable.
  const fix = (r) => ({
    ...r,
    results: r.results.map((p) => ({ ...p, id: p.participantId })),
  });
  const readAll = (kind) => (kind === "races" ? all(kind).map(fix) : all(kind));
  const readOne = (kind, id) =>
    kind === "races" ? fix(find(kind, id)) : find(kind, id);
  const exportRecords = () =>
    Object.keys(tables).flatMap((kind) =>
      readAll(kind).map((row) => ({
        kind,
        id: row.id,
        data: JSON.stringify(row),
      })),
    );
  const clear = () => {
    for (const table of [
      "tb_sesiones",
      "tb_clasificaciones_corredores",
      "tb_sanciones_corredores",
      "tb_vueltas_corredores",
      "tb_cronometros_corredores",
      "tb_intentos_corredores",
      "tb_inscripciones",
      "tb_competencias",
      "tb_corredores",
      "tb_usuarios",
      "tb_auditoria",
      "tb_configuracion",
    ])
      db.prepare(`DELETE FROM ${table}`).run();
  };
  importRunning(db, save);
  // Upgrade any development V2 aggregate records once; retain that source table as evidence.
  if (
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='v2_records'",
      )
      .get() &&
    !db.prepare("SELECT 1 FROM v2_meta WHERE key='relational-import'").get()
  )
    db.transaction(() => {
      const old = db.prepare("SELECT * FROM v2_records").all();
      for (const r of old.filter((r) => r.kind === "drivers"))
        save("runners", asRunner(JSON.parse(r.data)));
      for (const kind of Object.keys(tables))
        for (const r of old.filter((r) => r.kind === kind))
          save(
            kind,
            kind === "races" ? asRace(JSON.parse(r.data)) : JSON.parse(r.data),
          );
      db.prepare("INSERT INTO v2_meta VALUES ('relational-import',?)").run(
        randomUUID(),
      );
    })();
  return { all: readAll, find: readOne, save, exportRecords, clear };
}
