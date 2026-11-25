// Disposable, local-only demonstration. Never opens the user's database.
import bcrypt from "bcryptjs";
import { createDatabase } from "../src/db.js";
import { createApp } from "../src/app.js";
import { createRepository } from "../src/repository.js";
const db = createDatabase(":memory:");
const app = createApp(db);
const repo = createRepository(db);
repo.save("users", {
  id: "demo-admin",
  name: "Alex Morgan",
  email: "demo@carrera.local",
  passwordHash: bcrypt.hashSync("CarreraDemo2026", 12),
  role: "administrador",
  active: true,
});
const names = [
  ["Ana Martínez", "Atletismo Centro", "Libre femenil"],
  ["Diego Ríos", "Corredores del Norte", "Libre varonil"],
  ["Valeria Cruz", "Independiente", "Libre femenil"],
  ["Marco Vega", "Club Amanecer", "Máster"],
];
names.forEach(([name, team, category], i) => {
  repo.save("runners", { id: "d" + i, name, team, category, active: true });
});
const participants = names.map((_, i) => ({
  id: "p" + i,
  runnerId: "d" + i,
  number: [7, 12, 21, 9][i],
  status: "activo",
}));
const laps = [];
[
  [112500, 110200, 108100, 109900, 107540],
  [116100, 114100, 113100, 112500, 112130],
  [118400, 115400, 113450, 114300],
  [119000, 116100, 114820],
].forEach((times, i) => {
  let mark = 0;
  times.forEach((duration, j) => {
    mark += duration;
    laps.push({
      id: `l${i}-${j}`,
      requestId: `demo-${i}-${j}`,
      participantId: "p" + i,
      attempt: 1,
      mark,
      duration,
      valid: true,
      date: new Date().toISOString(),
    });
  });
});
repo.save("races", {
  id: "demo-night",
  name: "Carrera Nocturna",
  description:
    "Carrera a pie · Circuito de 400 m. Diez vueltas para alcanzar tu mejor marca.",
  date: "2026-11-24",
  mode: "vueltas",
  target: 10,
  duration: 30,
  lapDistance: 400,
  status: "pausada",
  attempt: 1,
  attempts: [],
  timer: { accumulated: 605540, startedAt: null },
  participants,
  laps,
  penalties: [
    {
      id: "penalty1",
      participantId: "p3",
      attempt: 1,
      type: "tiempo",
      value: 5000,
      reason: "Salida anticipada",
      user: "Alex Morgan",
      date: new Date().toISOString(),
    },
  ],
  results: [],
});
for (const [id, name, date, mode, target, duration] of [
  [
    "demo-endurance",
    "Desafío de Resistencia",
    "2026-11-28",
    "resistencia",
    5,
    60,
  ],
  [
    "demo-time",
    "Contrarreloj · Pista Norte",
    "2026-12-02",
    "contrarreloj",
    3,
    30,
  ],
])
  repo.save("races", {
    id,
    name,
    description:
      mode === "resistencia"
        ? "Sesenta minutos para dejar tu marca en la pista."
        : "Precisión, velocidad y una oportunidad contra el reloj.",
    date,
    mode,
    target,
    duration,
    lapDistance: 400,
    status: "creada",
    attempt: 1,
    attempts: [],
    timer: { accumulated: 0, startedAt: null },
    participants: [],
    laps: [],
    penalties: [],
    results: [],
  });
const server = app.listen(3002, "127.0.0.1", () =>
  console.log(
    "Demostración temporal: http://127.0.0.1:5174 | demo@carrera.local / CarreraDemo2026",
  ),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () =>
    server.close(() => {
      db.close();
      process.exit(0);
    }),
  );
