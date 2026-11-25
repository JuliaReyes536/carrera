import express from "express";
import { randomBytes, createHash, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import PDFDocument from "pdfkit";
import { createRepository } from "./repository.js";
import { asRace, asRunner } from "./running-migration.js";

const error = (message, status = 400) =>
  Object.assign(new Error(message), { status });
const text = (value, name, max = 120) => {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max)
    throw error(`${name}: campo obligatorio, máximo ${max} caracteres.`);
  return value.trim();
};
const integer = (value, name, min = 0, max = 999999) => {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw error(`${name}: usa un entero entre ${min} y ${max}.`);
  return value;
};
const hash = (value) => createHash("sha256").update(value).digest("hex");
const closed = (r) =>
  ["finalizada", "cancelada", "archivada"].includes(r.status);
const elapsed = (r) =>
  r.timer.accumulated +
  (r.status === "en ejecución"
    ? Math.max(0, Date.now() - r.timer.startedAt)
    : 0);
const password = (value) => {
  if (
    typeof value !== "string" ||
    value.length < 10 ||
    Buffer.byteLength(value) > 72
  )
    throw error(
      "La contraseña debe tener al menos 10 caracteres y máximo 72 bytes.",
    );
  return bcrypt.hashSync(value, 12);
};
const safeUser = ({ passwordHash, ...u }) => u;
export function installV2(app, db) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS v2_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
  );
  const { all, find, save, exportRecords, clear } = createRepository(db);
  const audit = (req, action, entity, before, after, reason = "") =>
    save("audit", {
      id: randomUUID(),
      date: new Date().toISOString(),
      user: req.user?.name || "Configuración inicial",
      action,
      entity,
      before,
      after,
      reason,
    });
  // Copy the original catalog and its timing evidence once, without modifying the legacy tables.
  if (!db.prepare("SELECT 1 FROM v2_meta WHERE key='legacy-import'").get())
    db.transaction(() => {
      const legacy = db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='Pilotos'",
        )
        .get()
        ? db.prepare("SELECT * FROM Pilotos").all()
        : [];
      for (const p of legacy) {
        save("runners", {
          id: `legacy-${p.id}`,
          name: p.nombre,
          team: "Independiente",
          category: "Libre",
          active: true,
        });
      }
      if (legacy.length) {
        const laps = db.prepare("SELECT * FROM Vueltas ORDER BY id").all();
        save("races", {
          id: "legacy",
          name: "Historial importado",
          description:
            "Marcas originales conservadas como evidencia. No se calculan duraciones entre posibles reinicios del reloj anterior.",
          date: new Date().toISOString().slice(0, 10),
          mode: "vueltas",
          target: 5,
          duration: 30,
          lapDistance: null,
          status: "archivada",
          attempt: 1,
          attempts: [],
          timer: { accumulated: 0, startedAt: null },
          participants: legacy.map((p) => ({
            id: `legacy-${p.id}`,
            runnerId: `legacy-${p.id}`,
            number: p.numero,
            status: "retirado",
          })),
          laps: laps.map((v) => ({
            id: `legacy-${v.id}`,
            participantId: `legacy-${v.piloto_id}`,
            attempt: 1,
            mark: v.tiempo_registrado,
            duration: 0,
            valid: false,
            reason: "Evidencia histórica sin información de intento.",
            date: v.fecha,
          })),
          penalties: [],
          results: [],
        });
      }
      db.prepare("INSERT INTO v2_meta VALUES ('legacy-import','1')").run();
    })();
  const router = express.Router();
  app.use("/api", router);
  router.use((req, _res, next) => {
    if (
      ["POST", "PUT", "PATCH"].includes(req.method) &&
      (!req.body || typeof req.body !== "object" || Array.isArray(req.body))
    )
      return next(error("Se requiere un objeto JSON."));
    next();
  });
  const loginAttempts = new Map();
  router.use((req, _res, next) => {
    const token = req.headers.authorization?.replace(/^Bearer /, "");
    if (token) {
      const session = db
        .prepare(
          "SELECT * FROM tb_sesiones WHERE token_hash=? AND expires_at>?",
        )
        .get(hash(token), Date.now());
      if (session) {
        const u = find("users", session.user_id);
        if (u.active) req.user = safeUser(u);
      }
    }
    next();
  });
  const auth = (req, _res, next) =>
    req.user
      ? next()
      : next(error("Inicia sesión para realizar esta operación.", 401));
  const admin = (req, _res, next) =>
    !req.user
      ? next(error("Inicia sesión para realizar esta operación.", 401))
      : req.user.role === "administrador"
        ? next()
        : next(
            error("Solo el administrador puede realizar esta operación.", 403),
          );
  router.get("/health", (_req, res) => res.json({ status: "ok", version: 2 }));
  router.get("/auth/status", (_req, res) =>
    res.json({ setupRequired: all("users").length === 0 }),
  );
  router.post("/auth/setup", (req, res) => {
    if (all("users").length) throw error("La cuenta inicial ya existe.", 409);
    const user = userInput(req.body);
    user.role = "administrador";
    db.transaction(() => {
      save("users", user);
      audit(req, "Crear administrador inicial", "users", null, safeUser(user));
    })();
    res.status(201).json(safeUser(user));
  });
  function userInput(body, previous) {
    const email = text(body.email, "Correo", 180).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw error("Correo inválido.");
    if (all("users").some((u) => u.email === email && u.id !== previous?.id))
      throw error("El correo ya está registrado.", 409);
    const role = body.role || "operador";
    if (!["administrador", "operador"].includes(role))
      throw error("Rol inválido.");
    return {
      id: previous?.id || randomUUID(),
      name: text(body.name, "Nombre"),
      email,
      role,
      active: body.active !== false,
      passwordHash: body.password
        ? password(body.password)
        : previous?.passwordHash || password(body.password),
    };
  }
  router.post("/auth/login", (req, res) => {
    const key = req.ip;
    const now = Date.now();
    if (loginAttempts.size > 1000)
      for (const [k, v] of loginAttempts)
        if (v.until < now) loginAttempts.delete(k);
    let tries = loginAttempts.get(key);
    if (!tries || tries.until < now) {
      tries = { count: 0, until: now + 15 * 60000 };
      loginAttempts.set(key, tries);
    }
    if (tries.count >= 10)
      throw error("Demasiados intentos. Espera 15 minutos.", 429);
    tries.count++;
    const u = all("users").find(
      (u) =>
        u.email === String(req.body.email).trim().toLowerCase() && u.active,
    );
    if (
      !u ||
      !bcrypt.compareSync(String(req.body.password || ""), u.passwordHash)
    )
      throw error("Correo o contraseña incorrectos.", 401);
    loginAttempts.delete(key);
    const token = randomBytes(32).toString("hex");
    db.prepare("DELETE FROM tb_sesiones WHERE expires_at<=?").run(now);
    db.prepare("INSERT INTO tb_sesiones VALUES (?,?,?)").run(
      hash(token),
      u.id,
      now + 8 * 3600000,
    );
    res.json({ token, user: safeUser(u) });
  });
  router.get("/auth/me", auth, (req, res) => res.json(req.user));
  router.post("/auth/logout", auth, (req, res) => {
    db.prepare("DELETE FROM tb_sesiones WHERE token_hash=?").run(
      hash(req.headers.authorization.replace(/^Bearer /, "")),
    );
    res.sendStatus(204);
  });
  router.post("/auth/password", auth, (req, res) => {
    const u = find("users", req.user.id);
    if (!bcrypt.compareSync(String(req.body.current || ""), u.passwordHash))
      throw error("La contraseña actual es incorrecta.");
    u.passwordHash = password(req.body.password);
    db.transaction(() => {
      save("users", u);
      db.prepare("DELETE FROM tb_sesiones WHERE user_id=?").run(u.id);
      audit(req, "Cambiar contraseña", "users", null, { id: u.id });
    })();
    res.sendStatus(204);
  });
  router.get("/users", admin, (_req, res) =>
    res.json(all("users").map(safeUser)),
  );
  router.post("/users", admin, (req, res) => {
    const u = userInput(req.body);
    db.transaction(() => {
      save("users", u);
      audit(req, "Crear usuario", "users", null, safeUser(u));
    })();
    res.status(201).json(safeUser(u));
  });
  router.patch("/users/:id", admin, (req, res) => {
    const old = find("users", req.params.id),
      u = userInput({ ...old, ...req.body }, old);
    if (
      old.role === "administrador" &&
      old.active &&
      (!u.active || u.role !== old.role) &&
      all("users").filter((x) => x.active && x.role === "administrador")
        .length < 2
    )
      throw error("Debe permanecer al menos un administrador activo.");
    db.transaction(() => {
      save("users", u);
      db.prepare("DELETE FROM tb_sesiones WHERE user_id=?").run(u.id);
      audit(req, "Editar usuario", "users", safeUser(old), safeUser(u));
    })();
    res.json(safeUser(u));
  });
  for (const kind of ["runners"]) {
    router.get(`/${kind}`, auth, (_req, res) => res.json(all(kind)));
    const input = (body, old) => {
      const row = {
        id: old?.id || randomUUID(),
        name: text(body.name, "Nombre"),
        active: body.active !== false,
      };
      row.team =
        String(body.team || "")
          .trim()
          .slice(0, 120) || "Independiente";
      row.category = text(body.category || "Libre", "Categoría", 60);
      return row;
    };
    router.post(`/${kind}`, auth, (req, res) => {
      const row = input(req.body);
      db.transaction(() => {
        save(kind, row);
        audit(req, "Crear registro", kind, null, row);
      })();
      res.status(201).json(row);
    });
    router.patch(`/${kind}/:id`, auth, (req, res) => {
      const old = find(kind, req.params.id),
        row = input({ ...old, ...req.body }, old);
      if (row.active !== old.active && req.user.role !== "administrador")
        throw error("Solo el administrador puede dar de baja registros.", 403);
      db.transaction(() => {
        save(kind, row);
        audit(req, "Editar registro", kind, old, row);
      })();
      res.json(row);
    });
    router.delete(`/${kind}/:id`, admin, (req, res) => {
      const row = find(kind, req.params.id);
      db.transaction(() => {
        save(kind, { ...row, active: false });
        audit(req, "Baja lógica", kind, row, { ...row, active: false });
      })();
      res.sendStatus(204);
    });
  }
  function raceInput(body) {
    const mode = body.mode || "vueltas";
    if (
      !["vueltas", "contrarreloj", "eliminación", "resistencia"].includes(mode)
    )
      throw error("Modalidad inválida.");
    const date = text(body.date, "Fecha", 10);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(date)) ||
      new Date(date).toISOString().slice(0, 10) !== date
    )
      throw error("Fecha inválida.");
    return {
      name: text(body.name, "Nombre"),
      description: String(body.description || "").slice(0, 1000),
      date,
      mode,
      target: integer(body.target ?? 5, "Vueltas objetivo", 1, 10000),
      duration: integer(body.duration ?? 30, "Duración en minutos", 1, 1440),
      lapDistance: integer(
        body.lapDistance ?? 400,
        "Distancia por vuelta en metros",
        1,
        100000,
      ),
    };
  }
  function leaderboard(r) {
    const rows = r.participants.map((p) => {
      const laps = r.laps.filter(
        (l) => l.participantId === p.id && l.attempt === r.attempt && l.valid,
      );
      const times = laps.map((l) => l.duration),
        mark = laps.at(-1)?.mark || 0;
      const penalties = r.penalties.filter(
        (x) => x.participantId === p.id && x.attempt === r.attempt,
      );
      const penalty = penalties.reduce(
        (s, x) => s + (x.type === "tiempo" ? x.value : 0),
        0,
      );
      const excluded = ["descalificado", "eliminado", "retirado"].includes(
        p.status,
      );
      return {
        ...p,
        runner: p.runnerSnapshot || find("runners", p.runnerId),
        distance: r.lapDistance ? laps.length * r.lapDistance : null,
        pace:
          r.lapDistance && laps.length
            ? ((mark + penalty) * 1000) / (laps.length * r.lapDistance)
            : null,
        laps: laps.length,
        total: mark + penalty,
        best: times.length ? Math.min(...times) : null,
        average: times.length
          ? times.reduce((s, x) => s + x, 0) / times.length
          : null,
        penalty,
        excluded,
        position: null,
        tied: false,
      };
    });
    const compare = (a, b) => {
      const resolution = (p) =>
        r.tieBreaks
          ?.filter((x) => x.attempt === r.attempt && x.participantId === p.id)
          .at(-1)?.priority || 0;
      if (r.mode === "contrarreloj")
        return (
          (a.laps >= r.target ? 0 : 1) - (b.laps >= r.target ? 0 : 1) ||
          (a.laps >= r.target && b.laps >= r.target
            ? a.total - b.total
            : b.laps - a.laps || a.total - b.total) ||
          (a.best ?? Infinity) - (b.best ?? Infinity) ||
          resolution(b) - resolution(a)
        );
      return (
        b.laps - a.laps ||
        a.total - b.total ||
        (a.best ?? Infinity) - (b.best ?? Infinity) ||
        resolution(b) - resolution(a)
      );
    };
    rows.sort(
      (a, b) =>
        Number(a.excluded) - Number(b.excluded) ||
        compare(a, b) ||
        a.number - b.number,
    );
    let position = 0;
    rows.forEach((p, i) => {
      if (!p.excluded) {
        position++;
        p.position = position;
        p.tied = !!rows.some(
          (q, j) => i !== j && !q.excluded && compare(p, q) === 0,
        );
      }
    });
    return rows;
  }
  const view = (r) => ({
    ...r,
    elapsed: elapsed(r),
    serverNow: Date.now(),
    leaderboard: closed(r) && r.results?.length ? r.results : leaderboard(r),
  });
  const clients = new Set();
  function broadcast() {
    for (const client of clients)
      client.write(`event: change\ndata: ${Date.now()}\n\n`);
  }
  router.get("/events", (req, res) => {
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.flushHeaders();
    res.write("event: change\ndata: connected\n\n");
    clients.add(res);
    const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 15000);
    heartbeat.unref();
    req.on("close", () => {
      clearInterval(heartbeat);
      clients.delete(res);
    });
  });
  const visible = (req, r) => {
    const result = view(r);
    if (req.user) return result;
    const { tieBreaks, revisions, ...publicRace } = result;
    return {
      ...publicRace,
      attempts: result.attempts.map(({ reason, ...attempt }) => attempt),
      laps: result.laps.map(({ requestId, reason, ...lap }) => lap),
      penalties: result.penalties.map(
        ({ user, reason, ...penalty }) => penalty,
      ),
    };
  };
  router.get("/races", (req, res) =>
    res.json(all("races").map((r) => visible(req, r))),
  );
  router.get("/races/:id", (req, res) =>
    res.json(visible(req, find("races", req.params.id))),
  );
  router.post("/races", admin, (req, res) => {
    const r = {
      id: randomUUID(),
      ...raceInput(req.body),
      status: "creada",
      attempt: 1,
      attempts: [],
      timer: { accumulated: 0, startedAt: null },
      participants: [],
      laps: [],
      penalties: [],
      results: [],
    };
    db.transaction(() => {
      save("races", r);
      audit(req, "Crear competencia", "races", null, r);
    })();
    res.status(201).json(view(r));
  });
  const changeRace = (req, fn) => {
    const result = db.transaction(() => {
      const r = find("races", req.params.id),
        before = structuredClone(r);
      fn(r);
      save("races", r);
      audit(
        req,
        req.path.split("/").at(-1),
        "races",
        before,
        r,
        req.body?.reason || "",
      );
      return view(r);
    })();
    broadcast();
    return result;
  };
  router.patch("/races/:id", admin, (req, res) =>
    res.json(
      changeRace(req, (r) => {
        if (!["creada", "preparada"].includes(r.status))
          throw error("Las reglas solo pueden editarse antes de iniciar.");
        Object.assign(r, raceInput({ ...r, ...req.body }));
      }),
    ),
  );
  router.post("/races/:id/tie-break", admin, (req, res) =>
    res.json(
      changeRace(req, (r) => {
        if (closed(r))
          throw error("Reabre los resultados antes de resolver un empate.");
        const p = leaderboard(r).find((p) => p.id === req.body.participantId);
        if (!p?.tied || !p.laps)
          throw error("El participante no tiene un empate pendiente.");
        const reason = text(req.body.reason, "Resolución justificada", 1000);
        r.tieBreaks ??= [];
        r.tieBreaks.push({
          participantId: p.id,
          attempt: r.attempt,
          priority: r.tieBreaks.length + 1,
          reason,
          user: req.user.name,
        });
      }),
    ),
  );
  router.post("/races/:id/reopen", admin, (req, res) =>
    res.json(
      changeRace(req, (r) => {
        if (r.status !== "finalizada")
          throw error(
            "Solo pueden reabrirse resultados finalizados sin archivar.",
          );
        const reason = text(
          req.body.reason,
          "Autorización de corrección",
          1000,
        );
        r.revisions ??= [];
        r.revisions.push({
          date: new Date().toISOString(),
          reason,
          user: req.user.name,
          results: r.results,
        });
        r.status = "pausada";
        r.results = [];
      }),
    ),
  );
  router.post("/races/:id/participants", admin, (req, res) =>
    res.status(201).json(
      changeRace(req, (r) => {
        if (!["creada", "preparada"].includes(r.status))
          throw error("Las inscripciones ya están cerradas.");
        const runner = find("runners", req.body.runnerId);
        if (!runner.active) throw error("El corredor debe estar activo.");
        const number = integer(
          req.body.number,
          "Número de competencia",
          0,
          999,
        );
        if (
          r.participants.some(
            (p) => p.runnerId === runner.id || p.number === number,
          )
        )
          throw error(
            "Corredor o dorsal ya inscritos en esta competencia.",
            409,
          );
        r.participants.push({
          id: randomUUID(),
          runnerId: runner.id,
          number,
          status: "activo",
        });
      }),
    ),
  );
  router.delete("/races/:id/participants/:pid", admin, (req, res) =>
    res.json(
      changeRace(req, (r) => {
        if (!["creada", "preparada"].includes(r.status))
          throw error("Solo puedes retirar inscripciones antes de iniciar.");
        if (!r.participants.some((p) => p.id === req.params.pid))
          throw error("Participante no encontrado.", 404);
        if (
          r.laps.some((l) => l.participantId === req.params.pid) ||
          r.penalties.some((p) => p.participantId === req.params.pid)
        )
          r.participants.find((p) => p.id === req.params.pid).status =
            "retirado";
        else
          r.participants = r.participants.filter(
            (p) => p.id !== req.params.pid,
          );
      }),
    ),
  );
  for (const action of [
    "prepare",
    "start",
    "pause",
    "resume",
    "finish",
    "cancel",
    "archive",
    "reset",
  ])
    router.post(
      `/races/:id/${action}`,
      ["cancel", "archive", "reset", "prepare"].includes(action) ? admin : auth,
      (req, res) =>
        res.json(
          changeRace(req, (r) => {
            if (action === "archive") {
              if (!["finalizada", "cancelada"].includes(r.status))
                throw error("Solo puedes archivar competencias cerradas.");
              r.status = "archivada";
              return;
            }
            if (closed(r)) throw error("La competencia está cerrada.");
            if (action === "prepare") {
              if (r.status !== "creada" || r.participants.length < 2)
                throw error("Se requieren al menos dos participantes.");
              r.status = "preparada";
            }
            if (action === "start" || action === "resume") {
              if (
                action === "start"
                  ? !["creada", "preparada"].includes(r.status)
                  : r.status !== "pausada"
              )
                throw error("Transición de estado inválida.");
              if (
                r.participants.filter((p) =>
                  ["activo", "finalizado"].includes(p.status),
                ).length < 2 &&
                action === "start"
              )
                throw error(
                  "Se requieren al menos dos participantes habilitados.",
                );
              if (action === "start")
                for (const p of r.participants) {
                  p.runnerSnapshot = find("runners", p.runnerId);
                  if (p.status === "activo" && !p.runnerSnapshot.active)
                    throw error(
                      "Todos los corredores habilitados deben estar activos en el catálogo.",
                    );
                }
              r.timer.startedAt = Date.now();
              r.status = "en ejecución";
            }
            if (action === "pause") {
              if (r.status !== "en ejecución")
                throw error("La competencia no está en ejecución.");
              r.timer.accumulated = elapsed(r);
              r.timer.startedAt = null;
              r.status = "pausada";
            }
            if (action === "finish") {
              if (!["en ejecución", "pausada"].includes(r.status))
                throw error("Inicia la competencia antes de finalizar.");
              const board = leaderboard(r),
                contenders = board.filter((p) => !p.excluded);
              if (
                contenders.length &&
                contenders[0].tied &&
                contenders[0].laps > 0
              )
                throw error(
                  "Hay un empate pendiente. Aplica una resolución justificada antes de oficializar.",
                );
              r.timer.accumulated = elapsed(r);
              r.timer.startedAt = null;
              r.status = "finalizada";
              r.results = board.map((p, i) => ({
                ...p,
                winner:
                  i === 0 &&
                  !p.excluded &&
                  (r.mode === "eliminación"
                    ? contenders.length === 1
                    : p.laps > 0 &&
                      (r.mode === "resistencia"
                        ? elapsed(r) >= r.duration * 60000
                        : p.laps >= r.target)),
              }));
            }
            if (action === "cancel") {
              r.reason = text(req.body.reason, "Motivo", 1000);
              r.timer.accumulated = elapsed(r);
              r.timer.startedAt = null;
              r.status = "cancelada";
            }
            if (action === "reset") {
              text(req.body.reason, "Motivo del reinicio", 1000);
              r.attempts.push({
                number: r.attempt,
                elapsed: elapsed(r),
                endedAt: new Date().toISOString(),
                reason: req.body.reason,
                participants: structuredClone(r.participants),
              });
              r.attempt++;
              r.timer = { accumulated: 0, startedAt: null };
              r.status = "preparada";
              r.participants.forEach((p) => {
                p.status = "activo";
              });
            }
          }),
        ),
    );
  router.post("/races/:id/laps", auth, (req, res) => {
    let duplicate = false;
    const result = changeRace(req, (r) => {
      const key = text(req.body.requestId, "Identificador de solicitud", 100);
      if (r.laps.some((l) => l.requestId === key && l.attempt === r.attempt)) {
        duplicate = true;
        return;
      }
      if (r.status !== "en ejecución")
        throw error(
          "Solo puedes registrar vueltas con la competencia en ejecución.",
        );
      const p = r.participants.find((p) => p.id === req.body.participantId);
      if (!p || p.status !== "activo")
        throw error("El participante no está habilitado.");
      if (r.mode === "resistencia" && elapsed(r) > r.duration * 60000)
        throw error(
          "El tiempo de resistencia ha terminado. Finaliza la competencia.",
        );
      const laps = r.laps.filter(
        (l) => l.participantId === p.id && l.attempt === r.attempt && l.valid,
      );
      const mark = elapsed(r),
        previous = laps.at(-1)?.mark || 0;
      if (mark <= previous)
        throw error("La marca debe ser mayor que la anterior.");
      if (mark - previous < 300 && laps.length)
        throw error("Registro demasiado cercano a la vuelta anterior.");
      r.laps.push({
        id: randomUUID(),
        requestId: key,
        participantId: p.id,
        attempt: r.attempt,
        mark,
        duration: mark - previous,
        valid: true,
        date: new Date().toISOString(),
      });
      if (
        ["vueltas", "contrarreloj"].includes(r.mode) &&
        laps.length + 1 >= r.target
      )
        p.status = "finalizado";
    });
    res.status(duplicate ? 200 : 201).json(result);
  });
  router.patch("/races/:id/laps/:lapId", admin, (req, res) =>
    res.json(
      changeRace(req, (r) => {
        const reason = text(req.body.reason, "Justificación", 1000);
        if (closed(r))
          throw error(
            "Los resultados cerrados no admiten correcciones ordinarias.",
          );
        const lap = r.laps.find(
          (l) => l.id === req.params.lapId && l.attempt === r.attempt,
        );
        if (!lap)
          throw error("Vuelta no encontrada en el intento actual.", 404);
        if (req.body.valid === false) lap.valid = false;
        else
          lap.mark = integer(
            req.body.mark,
            "Marca acumulada",
            1,
            Math.floor(elapsed(r)),
          );
        lap.reason = reason;
        let previous = 0;
        const valid = r.laps.filter(
          (l) =>
            l.participantId === lap.participantId &&
            l.attempt === r.attempt &&
            l.valid,
        );
        for (const l of valid) {
          if (l.mark <= previous)
            throw error(
              "Las marcas válidas deben ser estrictamente crecientes.",
            );
          l.duration = l.mark - previous;
          previous = l.mark;
        }
        const p = r.participants.find((p) => p.id === lap.participantId);
        if (p.status === "finalizado" && valid.length < r.target)
          p.status = "activo";
      }),
    ),
  );
  router.post("/races/:id/penalties", auth, (req, res) =>
    res.status(201).json(
      changeRace(req, (r) => {
        if (!["en ejecución", "pausada"].includes(r.status))
          throw error(
            "Las sanciones requieren una competencia iniciada y abierta.",
          );
        const p = r.participants.find((p) => p.id === req.body.participantId);
        if (!p) throw error("Participante no encontrado.", 404);
        const type = req.body.type;
        if (
          !["tiempo", "descalificado", "eliminado", "retirado"].includes(type)
        )
          throw error("Tipo de sanción inválido.");
        const penalty = {
          id: randomUUID(),
          participantId: p.id,
          attempt: r.attempt,
          type,
          value:
            type === "tiempo"
              ? integer(
                  req.body.value,
                  "Penalización en milisegundos",
                  1,
                  86400000,
                )
              : 0,
          reason: text(req.body.reason, "Motivo", 1000),
          user: req.user.name,
          date: new Date().toISOString(),
        };
        if (type !== "tiempo") p.status = type;
        r.penalties.push(penalty);
      }),
    ),
  );
  router.get("/audit", admin, (_req, res) => res.json(all("audit").reverse()));
  router.get("/dashboard", auth, (_req, res) => {
    const races = all("races");
    res.json({
      races: races.length,
      activeRaces: races.filter((r) => r.status === "en ejecución").length,
      runners: all("runners").filter((d) => d.active).length,
      laps: races.reduce((s, r) => s + r.laps.filter((l) => l.valid).length, 0),
    });
  });
  router.get("/runners/:id", auth, (req, res) =>
    res.json(find("runners", req.params.id)),
  );
  for (const section of ["timer", "laps", "leaderboard", "results", "stats"])
    router.get(`/races/:id/${section}`, (req, res) => {
      const r = visible(req, find("races", req.params.id));
      res.json(
        section === "timer"
          ? {
              elapsed: r.elapsed,
              status: r.status,
              attempt: r.attempt,
              serverNow: r.serverNow,
            }
          : section === "stats"
            ? {
                participants: r.participants.length,
                laps: r.leaderboard.reduce((s, p) => s + p.laps, 0),
                best:
                  Math.min(...r.leaderboard.map((p) => p.best ?? Infinity)) ||
                  null,
              }
            : r[section],
      );
    });
  router.get("/settings", admin, (_req, res) =>
    res.json(
      all("settings")[0] || {
        id: "system",
        name: "Carrera de la Muerte",
        venue: "",
        season: "2026",
      },
    ),
  );
  router.put("/settings", admin, (req, res) => {
    const row = {
      id: "system",
      name: text(req.body.name, "Nombre"),
      venue: String(req.body.venue || "").slice(0, 120),
      season: text(req.body.season, "Temporada", 30),
    };
    db.transaction(() => {
      audit(
        req,
        "Actualizar configuración",
        "settings",
        all("settings")[0] || null,
        row,
      );
      save("settings", row);
    })();
    res.json(row);
  });
  router.get("/backup", admin, (req, res) => {
    // Synchronous reads and writes share one SQLite connection; transaction provides a consistent snapshot.
    const data = db.transaction(exportRecords)();
    audit(req, "Generar respaldo", "backup", null, { records: data.length });
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="carrera-respaldo.json"',
    );
    res.json({
      version: 3,
      sport: "running",
      createdAt: new Date().toISOString(),
      records: data,
    });
  });
  router.post("/restore", admin, (req, res) => {
    const backup = req.body;
    if (backup.version === 2 && Array.isArray(backup.records)) {
      try {
        backup.records = backup.records
          .filter((row) => row?.kind !== "vehicles")
          .map((row) => {
            if (!row || typeof row.data !== "string") return row;
            const data = JSON.parse(row.data);
            if (row.kind === "drivers")
              return {
                ...row,
                kind: "runners",
                data: JSON.stringify(asRunner(data)),
              };
            if (row.kind === "races")
              return { ...row, data: JSON.stringify(asRace(data)) };
            return row;
          });
        backup.version = 3;
      } catch {
        throw error("No se pudo convertir el respaldo anterior.");
      }
    }
    if (
      backup.version !== 3 ||
      (backup.sport !== undefined && backup.sport !== "running") ||
      !Array.isArray(backup.records) ||
      backup.records.length > 100000
    )
      throw error("Respaldo de carreras a pie inválido.");
    const kinds = ["users", "runners", "races", "settings", "audit"];
    const parsed = backup.records.map((row) => {
      if (
        !row ||
        typeof row !== "object" ||
        !kinds.includes(row.kind) ||
        typeof row.id !== "string" ||
        typeof row.data !== "string"
      )
        throw error("Registro de respaldo inválido.");
      let data;
      try {
        data = JSON.parse(row.data);
      } catch {
        throw error("JSON de respaldo inválido.");
      }
      if (
        !data ||
        typeof data !== "object" ||
        Array.isArray(data) ||
        data.id !== row.id ||
        !row.id ||
        row.id.length > 150
      )
        throw error("Identificadores de respaldo inconsistentes.");
      return { ...row, parsed: data };
    });
    if (new Set(parsed.map((r) => `${r.kind}:${r.id}`)).size !== parsed.length)
      throw error("El respaldo contiene registros duplicados.");
    const records = (kind) =>
      parsed.filter((x) => x.kind === kind).map((x) => x.parsed);
    if (
      !records("users").some(
        (u) =>
          u.active &&
          u.role === "administrador" &&
          typeof u.passwordHash === "string" &&
          u.passwordHash.startsWith("$2"),
      )
    )
      throw error("El respaldo necesita un administrador válido.");
    for (const u of records("users")) {
      text(u.name, "Nombre de usuario");
      text(u.email, "Correo de usuario", 180);
      if (
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u.email) ||
        !["administrador", "operador"].includes(u.role) ||
        typeof u.active !== "boolean" ||
        !/^\$2[aby]\$(10|11|12|13|14)\$[./A-Za-z0-9]{53}$/.test(u.passwordHash)
      )
        throw error("Usuarios de respaldo inválidos.");
    }
    for (const d of records("runners")) {
      text(d.name, "Nombre de corredor");
      text(d.team, "Equipo o club");
      text(d.category, "Categoría", 60);
      if (typeof d.active !== "boolean")
        throw error("Estado de corredor inválido.");
    }

    for (const s of records("settings")) {
      text(s.name, "Nombre del sistema");
      text(s.season, "Temporada", 30);
      if (typeof s.venue !== "string") throw error("Sede inválida.");
    }
    for (const a of records("audit")) {
      text(a.user, "Responsable");
      text(a.action, "Acción");
      text(a.entity, "Entidad");
      if (!Number.isFinite(Date.parse(a.date)) || typeof a.reason !== "string")
        throw error("Auditoría de respaldo inválida.");
    }
    const childIds = {
      participants: new Set(),
      laps: new Set(),
      penalties: new Set(),
    };
    for (const r of records("races")) {
      if (
        !Array.isArray(r.participants) ||
        !Array.isArray(r.laps) ||
        !Array.isArray(r.penalties) ||
        !Array.isArray(r.attempts) ||
        !Array.isArray(r.results) ||
        !r.timer ||
        !Number.isSafeInteger(r.attempt) ||
        r.attempt < 1 ||
        !Number.isSafeInteger(r.timer.accumulated) ||
        r.timer.accumulated < 0 ||
        ![
          "creada",
          "preparada",
          "en ejecución",
          "pausada",
          "finalizada",
          "cancelada",
          "archivada",
        ].includes(r.status)
      )
        throw error("Competencia de respaldo inválida.");
      raceInput(r);
      if (
        r.status === "en ejecución" &&
        (!Number.isSafeInteger(r.timer.startedAt) ||
          r.timer.startedAt <= 0 ||
          r.timer.startedAt > Date.now() + 300000)
      )
        throw error("Inicio de cronómetro inválido.");
      if (
        r.tieBreaks !== undefined &&
        (!Array.isArray(r.tieBreaks) ||
          r.tieBreaks.some(
            (x) =>
              !x ||
              !Number.isSafeInteger(x.attempt) ||
              !Number.isSafeInteger(x.priority) ||
              typeof x.participantId !== "string",
          ))
      )
        throw error("Resoluciones de empate inválidas.");
      if (r.revisions !== undefined && !Array.isArray(r.revisions))
        throw error("Revisiones inválidas.");
      const attempts = new Set([r.attempt]);
      for (const a of r.attempts) {
        if (
          !a ||
          !Number.isSafeInteger(a.number) ||
          a.number < 1 ||
          a.number >= r.attempt ||
          attempts.has(a.number) ||
          !Number.isSafeInteger(a.elapsed) ||
          a.elapsed < 0
        )
          throw error("Intentos de respaldo inválidos.");
        attempts.add(a.number);
      }
      for (const kind of Object.keys(childIds))
        for (const item of r[kind]) {
          if (
            !item ||
            typeof item.id !== "string" ||
            !item.id ||
            childIds[kind].has(item.id)
          )
            throw error("Identificadores secundarios inválidos o duplicados.");
          childIds[kind].add(item.id);
        }
      for (const p of r.participants) {
        if (p.runnerSnapshot) {
          text(p.runnerSnapshot.name, "Nombre histórico de corredor");
          text(p.runnerSnapshot.team, "Equipo histórico");
          text(p.runnerSnapshot.category, "Categoría histórica", 60);
        }

        if (
          !Number.isSafeInteger(p.number) ||
          p.number < 0 ||
          p.number > 999 ||
          ![
            "activo",
            "finalizado",
            "retirado",
            "eliminado",
            "descalificado",
          ].includes(p.status) ||
          !records("runners").some((d) => d.id === p.runnerId)
        )
          throw error("Referencias de participantes incompletas.");
      }
      if (
        new Set(r.participants.map((p) => p.number)).size !==
          r.participants.length ||
        new Set(r.participants.map((p) => p.runnerId)).size !==
          r.participants.length
      )
        throw error("Inscripciones duplicadas en el respaldo.");
      for (const l of r.laps)
        if (
          !attempts.has(l.attempt) ||
          typeof l.valid !== "boolean" ||
          !r.participants.some((p) => p.id === l.participantId) ||
          !Number.isSafeInteger(l.mark) ||
          l.mark < 0 ||
          !Number.isSafeInteger(l.duration) ||
          l.duration < 0
        )
          throw error("Vueltas de respaldo inválidas.");
      for (const p of r.participants)
        for (const attempt of attempts) {
          let previous = 0;
          for (const lap of r.laps.filter(
            (l) => l.participantId === p.id && l.attempt === attempt && l.valid,
          )) {
            if (lap.mark <= previous || lap.duration !== lap.mark - previous)
              throw error("Marcas o duraciones incoherentes en el respaldo.");
            previous = lap.mark;
          }
        }
      for (const penalty of r.penalties) {
        if (
          !r.participants.some((p) => p.id === penalty.participantId) ||
          !attempts.has(penalty.attempt) ||
          !["tiempo", "descalificado", "eliminado", "retirado"].includes(
            penalty.type,
          ) ||
          !Number.isSafeInteger(penalty.value) ||
          penalty.value < 0 ||
          penalty.value > 86400000
        )
          throw error("Penalizaciones inválidas.");
        text(penalty.reason, "Motivo de sanción", 1000);
      }
      if (r.status === "en ejecución") {
        r.timer.accumulated = elapsed(r);
        r.timer.startedAt = null;
        r.status = "pausada";
      }
      if (r.results.length) {
        const board = leaderboard(r),
          count = board.filter((p) => !p.excluded).length;
        r.results = board.map((p, i) => ({
          ...p,
          winner:
            i === 0 &&
            !p.excluded &&
            !p.tied &&
            (r.mode === "eliminación"
              ? count === 1
              : p.laps > 0 &&
                (r.mode === "resistencia"
                  ? elapsed(r) >= r.duration * 60000
                  : p.laps >= r.target)),
        }));
      }
    }
    db.transaction(() => {
      // Preserve a recoverable pre-restore snapshot, including the original protected records.
      db.exec(
        "CREATE TABLE IF NOT EXISTS v2_restore_safety (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, data TEXT NOT NULL)",
      );
      db.prepare("INSERT INTO v2_restore_safety VALUES (?,?,?)").run(
        randomUUID(),
        new Date().toISOString(),
        JSON.stringify(exportRecords()),
      );
      clear();
      for (const kind of ["users", "runners", "races", "settings", "audit"])
        for (const row of parsed.filter((row) => row.kind === kind))
          save(row.kind, row.parsed);
      audit(
        req,
        "Restaurar respaldo",
        "backup",
        null,
        { records: parsed.length },
        text(req.body.reason, "Motivo de restauración", 1000),
      );
    })();
    res.json({ message: "Respaldo restaurado. Inicia sesión nuevamente." });
  });
  router.get("/races/:id/export/:format", auth, (req, res) => {
    const r = view(find("races", req.params.id));
    const rows = r.leaderboard;
    if (req.params.format === "csv") {
      const cell = (x) =>
        `"${String(x ?? "")
          .replace(/^[=+@\-\t\r]/, "'$&")
          .replaceAll('"', '""')}"`;
      const records = [
        [
          "Competencia",
          "Fecha",
          "Posición",
          "Dorsal",
          "Corredor",
          "Equipo o club",
          "Categoría",
          "Distancia m",
          "Ritmo ms/km",
          "Vueltas",
          "Tiempo ajustado ms",
          "Mejor vuelta ms",
          "Penalización ms",
          "Estado",
        ],
        ...rows.map((p) => [
          r.name,
          r.date,
          p.position,
          p.number,
          p.runner.name,
          p.runner.team,
          p.runner.category,
          p.distance,
          p.pace,
          p.laps,
          p.total,
          p.best,
          p.penalty,
          p.status,
        ]),
      ];
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="resultados.csv"',
      );
      res
        .type("text/csv")
        .send(
          "\uFEFF" + records.map((row) => row.map(cell).join(",")).join("\r\n"),
        );
      return;
    }
    if (req.params.format !== "pdf") throw error("Formato inválido.");
    const doc = new PDFDocument({ margin: 45, size: "A4" });
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="resultados.pdf"',
    );
    res.type("application/pdf");
    doc.pipe(res);
    doc
      .fontSize(22)
      .text("Carrera de la Muerte")
      .moveDown()
      .fontSize(16)
      .text(r.name);
    doc
      .fontSize(10)
      .text(`${r.date} | ${r.mode} | ${r.status} | Intento ${r.attempt}`)
      .text(
        r.lapDistance
          ? `Distancia por vuelta: ${r.lapDistance} m`
          : "Distancia histórica no configurada",
      )
      .text(`Emitido: ${new Date().toISOString()}`)
      .moveDown();
    if (!rows.length) doc.text("Sin participantes registrados.");
    for (const p of rows) {
      if (doc.y > 720) doc.addPage();
      doc
        .fontSize(12)
        .text(`${p.position ?? "-"}  Dorsal ${p.number}  ${p.runner.name}`, {
          continued: false,
        });
      doc
        .fontSize(10)
        .text(
          `${p.runner.team} | ${p.runner.category} | Vueltas: ${p.laps} | Distancia: ${p.distance === null ? "-" : (p.distance / 1000).toFixed(2) + " km"} | Ritmo: ${p.pace === null ? "-" : Math.floor(p.pace / 60000) + ":" + String(Math.floor(p.pace / 1000) % 60).padStart(2, "0") + " min/km"} | Total: ${(p.total / 1000).toFixed(3)} s | Mejor: ${p.best === null ? "-" : (p.best / 1000).toFixed(3) + " s"} | ${p.status}`,
        )
        .moveDown(0.7);
    }
    doc.end();
  });
  // Retire the unauthenticated V1 mutation endpoints while retaining the original database.
  router.use((req, _res, next) => {
    if (
      /^\/(drivers|vehicles|pilotos|corredores|vueltas|cronometro)(\/|$)/.test(
        req.path,
      )
    )
      return next(error("Ruta V1 retirada. Utiliza el panel V2.", 410));
    next();
  });
}
