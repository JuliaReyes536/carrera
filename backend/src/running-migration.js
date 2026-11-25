// Compatibility only: convert earlier installations without deleting source tables.
export const asRunner = (row) => {
  const { alias, ...person } = row;
  return {
    ...person,
    team: row.team || "Independiente",
    category: row.category || "Libre",
  };
};
export const asParticipant = (row) => {
  const { driverId, driverSnapshot, vehicleId, vehicleSnapshot, ...p } = row;
  return {
    ...p,
    runnerId: row.runnerId || driverId,
    ...(row.runnerSnapshot || driverSnapshot
      ? { runnerSnapshot: asRunner(row.runnerSnapshot || driverSnapshot) }
      : {}),
  };
};
export const asResult = (row) => {
  const { driver, vehicle, ...result } = asParticipant(row);
  return {
    ...result,
    runner: asRunner(row.runner || driver),
    distance: row.distance ?? null,
    pace: row.pace ?? null,
  };
};
export function asRace(row) {
  return {
    ...row,
    name: row.name
      .replaceAll("Gran Premio", "Carrera")
      .replaceAll("Time Attack", "Contrarreloj"),
    lapDistance: row.lapDistance ?? null,
    participants: row.participants.map(asParticipant),
    results: (row.results || []).map(asResult),
    attempts: (row.attempts || []).map((a) => ({
      ...a,
      ...(a.participants
        ? { participants: a.participants.map(asParticipant) }
        : {}),
    })),
    revisions: (row.revisions || []).map((r) => ({
      ...r,
      results: (r.results || []).map(asResult),
    })),
  };
}
export function importRunning(db, save) {
  const exists = (table) =>
    !!db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
      .get(table);
  if (
    !exists("tb_pilotos") ||
    db.prepare("SELECT 1 FROM v2_meta WHERE key='running-migration'").get()
  )
    return;
  db.transaction(() => {
    for (const row of db.prepare("SELECT data FROM tb_pilotos").all())
      save("runners", asRunner(JSON.parse(row.data)));
    if (exists("tb_carreras"))
      for (const record of db.prepare("SELECT data FROM tb_carreras").all()) {
        const race = JSON.parse(record.data),
          read = (table) =>
            db
              .prepare(
                `SELECT data FROM ${table} WHERE carrera_id=? ORDER BY rowid`,
              )
              .all(race.id)
              .map((r) => JSON.parse(r.data));
        const timer = JSON.parse(
          db
            .prepare("SELECT data FROM tb_cronometros WHERE intento_id=?")
            .get(`${race.id}:${race.attempt}`).data,
        );
        const results = db
          .prepare(
            "SELECT data FROM tb_resultados WHERE intento_id=? ORDER BY rowid",
          )
          .all(`${race.id}:${race.attempt}`)
          .map((r) => {
            const p = JSON.parse(r.data);
            return { ...p, id: p.participantId };
          });
        save(
          "races",
          asRace({
            ...race,
            timer,
            participants: read("tb_participantes"),
            attempts: read("tb_intentos").filter(
              (a) => a.number !== race.attempt,
            ),
            laps: read("tb_vueltas"),
            penalties: read("tb_penalizaciones"),
            results,
          }),
        );
      }
    db.prepare("INSERT INTO v2_meta VALUES ('running-migration','1')").run();
  })();
}
