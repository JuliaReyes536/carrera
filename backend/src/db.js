import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function createDatabase(path = process.env.DB_PATH || fileURLToPath(new URL('../data/carrera.sqlite', import.meta.url))) {
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
  const db = new Database(path);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS Pilotos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL CHECK(length(trim(nombre)) BETWEEN 1 AND 100),
      alias TEXT NOT NULL CHECK(length(trim(alias)) BETWEEN 1 AND 100),
      vehiculo TEXT NOT NULL CHECK(length(trim(vehiculo)) BETWEEN 1 AND 100),
      numero INTEGER NOT NULL UNIQUE CHECK(numero BETWEEN 0 AND 999),
      estado TEXT NOT NULL DEFAULT 'activo' CHECK(estado IN ('activo','penalizado','ganador','eliminado'))
    );
    CREATE TABLE IF NOT EXISTS Vueltas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      piloto_id INTEGER NOT NULL REFERENCES Pilotos(id) ON DELETE CASCADE,
      tiempo_registrado INTEGER NOT NULL CHECK(tiempo_registrado >= 0),
      fecha TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_vueltas_piloto ON Vueltas(piloto_id);
    CREATE TABLE IF NOT EXISTS Cronometro (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      tiempo_global INTEGER NOT NULL DEFAULT 0 CHECK(tiempo_global >= 0),
      estado TEXT NOT NULL DEFAULT 'pausado' CHECK(estado IN ('corriendo','pausado')),
      iniciado_en INTEGER
    );
    INSERT OR IGNORE INTO Cronometro(id) VALUES (1);
  `);
  return db;
}
