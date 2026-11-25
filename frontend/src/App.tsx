import { useCallback, useEffect, useState } from "react";
import { api, download, setToken } from "./api";
import { formatTime } from "./types";
import type { User, Runner, Race, Audit, Settings } from "./v2types";
import { Badge, Empty, Field, modes, dateLabel, RunningFigure } from "./ui";
import Forms, { type FormKind, type Edit } from "./Forms";
import Leaderboard from "./Leaderboard";

const navigation = [
  ["dashboard", "◫", "Dashboard"],
  ["races", "⚑", "Competencias"],
  ["control", "◷", "Control de carrera"],
  ["runners", "◉", "Corredores"],
  ["penalties", "⚠", "Penalizaciones"],
  ["results", "♜", "Resultados"],
  ["history", "↺", "Historial"],
  ["reports", "▤", "Reportes"],
  ["users", "♙", "Usuarios"],
  ["audit", "≡", "Auditoría"],
  ["settings", "⚙", "Configuración"],
];
export default function App() {
  const [user, setUser] = useState<User | null>(null),
    [ready, setReady] = useState(false),
    [setup, setSetup] = useState(false);
  const [page, setPage] = useState(() => {
    const value = location.hash.slice(1);
    return value === "public" || navigation.some((n) => n[0] === value)
      ? value
      : "dashboard";
  });
  const [races, setRaces] = useState<Race[]>([]),
    [runners, setRunners] = useState<Runner[]>([]);
  const [selected, setSelected] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [date, setDate] = useState("");
  const [modal, setModal] = useState<FormKind | null>(null),
    [edit, setEdit] = useState<Edit>(null);
  const [users, setUsers] = useState<User[]>([]),
    [audits, setAudits] = useState<Audit[]>([]);
  const [settings, setSettings] = useState<Settings>({
    id: "system",
    name: "Carrera de la Muerte",
    venue: "",
    season: "2026",
  });
  const [now, setNow] = useState(performance.now()),
    [lastSync, setLastSync] = useState(0);
  const admin = user?.role === "administrador";
  const race =
    races.find((r) => r.id === selected) ||
    races.find((r) => r.status === "en ejecución") ||
    races.find(
      (r) => !["archivada", "cancelada", "finalizada"].includes(r.status),
    ) ||
    races.at(-1);
  const live = race && ["en ejecución", "pausada"].includes(race.status);
  const locked =
    !race || ["finalizada", "cancelada", "archivada"].includes(race.status);
  const refresh = useCallback(async () => {
    const data = await api<Race[]>("/races");
    setRaces(data);
    setLastSync(performance.now());
    if (user && sessionStorage.getItem("cdm-token")) {
      const d = await api<Runner[]>("/runners");
      setRunners(d);
    }
  }, [user]);
  useEffect(() => {
    void (async () => {
      try {
        const status = await api<{ setupRequired: boolean }>("/auth/status");
        setSetup(status.setupRequired);
        if (sessionStorage.getItem("cdm-token"))
          try {
            setUser(await api<User>("/auth/me"));
          } catch {
            setToken("");
          }
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setReady(true);
      }
    })();
  }, []);
  useEffect(() => {
    if (ready) void refresh().catch((e) => setError(e.message));
  }, [ready, refresh]);
  useEffect(() => {
    let pending = false,
      cancelled = false,
      lastReceived = 0;
    const update = () => {
      if (pending || document.hidden) return;
      pending = true;
      void api<Race[]>("/races")
        .then((data) => {
          if (!cancelled) {
            lastReceived = performance.now();
            setRaces(data);
            setLastSync(lastReceived);
          }
        })
        .catch((e) => {
          if (!cancelled) setError(e.message);
        })
        .finally(() => {
          pending = false;
        });
    };
    const events = new EventSource("/api/events");
    events.addEventListener("change", update);
    let streaming = false;
    events.onopen = () => {
      streaming = true;
    };
    events.onerror = () => {
      streaming = false;
    };
    const timer = setInterval(() => {
      if (!streaming || performance.now() - lastReceived > 2500) update();
    }, 750);
    return () => {
      cancelled = true;
      clearInterval(timer);
      events.close();
    };
  }, []);
  useEffect(() => {
    const timer = setInterval(() => setNow(performance.now()), 43);
    const expired = () => {
      setUser(null);
      setRunners([]);
      setNotice("La sesión terminó. Inicia sesión nuevamente.");
    };
    const changed = () => setPage(location.hash.slice(1) || "dashboard");
    window.addEventListener("cdm-session-expired", expired);
    window.addEventListener("hashchange", changed);
    return () => {
      clearInterval(timer);
      window.removeEventListener("cdm-session-expired", expired);
      window.removeEventListener("hashchange", changed);
    };
  }, []);
  useEffect(() => {
    setQuery("");
    setFilter("all");
    setDate("");
    setError("");
    if (page === "users" && admin)
      void api<User[]>("/users")
        .then(setUsers)
        .catch((e) => setError(e.message));
    if (page === "audit" && admin)
      void api<Audit[]>("/audit")
        .then(setAudits)
        .catch((e) => setError(e.message));
    if (page === "settings" && admin)
      void api<Settings>("/settings")
        .then(setSettings)
        .catch((e) => setError(e.message));
  }, [page, admin]);
  async function run(
    fn: () => Promise<unknown>,
    message = "Cambios guardados.",
  ) {
    if (busy) return false;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      await refresh();
      setNotice(message);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  function go(value: string) {
    setPage(value);
    location.hash = value;
  }
  function open(kind: FormKind, item: Edit = null) {
    setEdit(item);
    setModal(kind);
  }
  async function logout() {
    await run(async () => {
      await api("/auth/logout", "POST");
      setToken("");
      setUser(null);
      setRunners([]);
      go("public");
    }, "Sesión cerrada.");
  }
  async function control(action: string) {
    let reason = "";
    if (["finish", "cancel", "archive", "reset"].includes(action)) {
      if (action === "cancel" || action === "reset") {
        reason =
          prompt(
            action === "reset"
              ? "Motivo del nuevo intento. El historial anterior se conservará:"
              : "Motivo de cancelación:",
          ) || "";
        if (!reason.trim()) return;
      } else if (
        !confirm(
          action === "finish"
            ? "¿Finalizar y publicar los resultados? Se cerrará el registro de vueltas."
            : "¿Archivar la competencia?",
        )
      )
        return;
    }
    await run(
      () => api(`/races/${race!.id}/${action}`, "POST", { reason }),
      action === "finish"
        ? "Competencia finalizada. Resultados publicados."
        : "Estado de competencia actualizado.",
    );
  }
  const elapsed = race
    ? race.elapsed +
      (race.status === "en ejecución" ? Math.max(0, now - lastSync) : 0)
    : 0;
  const allLaps = races.reduce(
    (s, r) => s + r.laps.filter((l) => l.valid).length,
    0,
  );
  const currentLaps = race?.leaderboard.reduce((s, p) => s + p.laps, 0) || 0;
  const best = race?.leaderboard
    .filter((p) => p.best !== null)
    .sort((a, b) => a.best! - b.best!)[0];
  const title =
    page === "public"
      ? "Clasificación en vivo"
      : navigation.find((n) => n[0] === page)?.[2] || "Dashboard";
  const showPicker = [
    "control",
    "penalties",
    "results",
    "reports",
    "public",
  ].includes(page);
  if (!ready)
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <span className="brand-mark">M</span>
          <h1>Conectando con Control de carrera…</h1>
          {error && <p role="alert">{error}</p>}
        </div>
      </div>
    );
  if (!user && page !== "public")
    return (
      <div className="auth-screen">
        <div className="auth-art">
          <div className="brand">
            <span className="brand-mark">M</span>
            <b>
              CARRERA DE
              <br />
              LA MUERTE
            </b>
          </div>
          <span className="eyebrow">EL CONTROL ESTÁ EN TUS MANOS</span>
          <h1>
            Una carrera.
            <br />
            Cada milisegundo.
          </h1>
          <p>
            De la salida al podio. Todo lo que necesitas para dirigir la
            competencia.
          </p>
          <div className="track-art">
            <i />
            <i />
            <i />
          </div>
        </div>
        <div className="auth-card">
          <span className="eyebrow">CONTROL DE CARRERA / ACCESO</span>
          <h2>
            {setup ? "Configura tu centro de mando" : "Bienvenido de vuelta"}
          </h2>
          <p>
            {setup
              ? "Crea la primera cuenta de administrador para comenzar."
              : "Inicia sesión para administrar tus competencias."}
          </p>
          {error && (
            <div className="alert error" role="alert">
              {error}
              <button
                className="text-button"
                disabled={busy}
                onClick={() => {
                  setReady(false);
                  location.reload();
                }}
              >
                Reintentar
              </button>
            </div>
          )}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const body = Object.fromEntries(new FormData(e.currentTarget));
              await run(async () => {
                if (setup) {
                  await api("/auth/setup", "POST", body);
                  setSetup(false);
                }
                const result = await api<{ token: string; user: User }>(
                  "/auth/login",
                  "POST",
                  body,
                );
                setToken(result.token);
                setUser(result.user);
              }, "Sesión iniciada.");
            }}
          >
            {setup && (
              <Field label="Nombre completo">
                <input
                  name="name"
                  required
                  maxLength={120}
                  autoComplete="name"
                />
              </Field>
            )}
            <Field label="Correo electrónico">
              <input
                name="email"
                type="email"
                required
                autoComplete="username"
                placeholder="tu@correo.com"
              />
            </Field>
            <Field label="Contraseña">
              <input
                name="password"
                type="password"
                required
                minLength={setup ? 10 : 1}
                maxLength={72}
                autoComplete={setup ? "new-password" : "current-password"}
                placeholder={setup ? "Mínimo 10 caracteres" : "Tu contraseña"}
              />
            </Field>
            <button className="btn primary full" disabled={busy}>
              {busy
                ? "Conectando…"
                : setup
                  ? "Crear cuenta y entrar"
                  : "Entrar al centro de mando"}
            </button>
          </form>
          <button className="text-button" onClick={() => go("public")}>
            Consultar clasificación pública
          </button>
          <small>Acceso protegido · Sesiones de 8 horas</small>
        </div>
      </div>
    );
  const raceCard = (r: Race) => (
    <article className="race-card" key={r.id}>
      <div className="race-card-top">
        <Badge>{r.status}</Badge>
        <span className="muted">{dateLabel(r.date)}</span>
      </div>
      <div className="race-visual">
        <span>
          {r.mode === "resistencia"
            ? "RESISTENCIA"
            : r.mode === "contrarreloj"
              ? "CONTRARRELOJ"
              : "CARRERA A PIE"}
        </span>
        <div className="track-mini" />
        <b>
          {String(r.participants.length).padStart(2, "0")}
          <small>CORREDORES</small>
        </b>
      </div>
      <div className="race-card-body">
        <span className="eyebrow">{modes[r.mode]}</span>
        <h3>{r.name}</h3>
        <p>{r.description || "Todo listo para la próxima salida."}</p>
        <div className="race-meta">
          <span>
            ◷{" "}
            {r.mode === "resistencia"
              ? `${r.duration} min`
              : `${r.target} vueltas`}
          </span>
          <span>Intento {r.attempt}</span>
        </div>
        <button
          className="btn full"
          onClick={() => {
            setSelected(r.id);
            go(
              ["finalizada", "archivada", "cancelada"].includes(r.status)
                ? "results"
                : "control",
            );
          }}
        >
          {["finalizada", "archivada", "cancelada"].includes(r.status)
            ? "Ver resultados"
            : "Abrir control de carrera"}
        </button>
        {admin && (
          <div className="card-actions">
            {["creada", "preparada"].includes(r.status) && (
              <button className="text-button" onClick={() => open("race", r)}>
                Editar reglas
              </button>
            )}
            <button
              className="text-button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const created = await api<Race>("/races", "POST", {
                    ...r,
                    name: r.name + " · copia",
                  });
                  setSelected(created.id);
                }, "Configuración duplicada. Participantes y tiempos independientes.")
              }
            >
              Duplicar
            </button>
          </div>
        )}
      </div>
    </article>
  );
  return (
    <div className={`app-shell ${page === "public" ? "public-shell" : ""}`}>
      {page !== "public" && (
        <aside className="sidebar">
          <a
            className="brand"
            href="#dashboard"
            onClick={() => go("dashboard")}
          >
            <span className="brand-mark">M</span>
            <b>
              CARRERA DE
              <br />
              LA MUERTE
            </b>
          </a>
          <div className="workspace">
            <span className="workspace-icon">⚑</span>
            <div>
              <b>Control de carrera</b>
              <small>Centro de administración</small>
            </div>
            <span>⌄</span>
          </div>
          <p className="nav-label">COMPETICIÓN</p>
          <nav aria-label="Menú principal">
            {navigation
              .filter((n) => admin || !["users", "audit"].includes(n[0]))
              .map((n, i) => (
                <div key={n[0]}>
                  {n[0] === "users" && admin && (
                    <p className="nav-label">ADMINISTRACIÓN</p>
                  )}
                  <button
                    className={page === n[0] ? "nav-item selected" : "nav-item"}
                    onClick={() => go(n[0])}
                  >
                    <span>{n[1]}</span>
                    {n[2]}
                    {n[0] === "control" &&
                      races.some((r) => r.status === "en ejecución") && (
                        <i className="live-dot" />
                      )}
                  </button>
                </div>
              ))}
          </nav>
          <div className="sidebar-bottom">
            <button className="nav-item" onClick={() => go("public")}>
              <span>◎</span>Vista pública
            </button>
            <div className="user-box">
              <span className="avatar">{user?.name[0]?.toUpperCase()}</span>
              <div>
                <b>{user?.name}</b>
                <small>{user?.role}</small>
              </div>
              <button
                className="icon-btn"
                onClick={() => void logout()}
                title="Cerrar sesión"
                aria-label="Cerrar sesión"
              >
                ⏻
              </button>
            </div>
          </div>
        </aside>
      )}
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            Control de carrera <span>/</span>
            <b>{title}</b>
          </div>
          <div className="topbar-right">
            <span
              className={
                now - lastSync < 4000 ? "connection" : "connection disconnected"
              }
            >
              <i />
              {now - lastSync < 4000
                ? "Servidor conectado"
                : "Sin sincronización"}
            </span>
            <span className="season">TEMPORADA {settings.season}</span>
            {user && (
              <button
                className="icon-btn mobile-account"
                onClick={() => void logout()}
                aria-label="Cerrar sesión"
              >
                ⏻
              </button>
            )}
            {page === "public" && (
              <button className="btn" onClick={() => go("dashboard")}>
                {user ? "Volver al panel" : "Acceso al panel"}
              </button>
            )}
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <span className="eyebrow">
                {page === "dashboard"
                  ? "TU COMPETENCIA, BAJO CONTROL"
                  : "CARRERA DE LA MUERTE / CONTROL DE CARRERA"}
              </span>
              <h1>
                {title}
                <span className="title-dot">.</span>
              </h1>
              <p>
                {page === "dashboard"
                  ? "Todo lo que sucede en la pista, en un solo lugar."
                  : page === "control"
                    ? "Cada vuelta cuenta. Dirige la carrera en tiempo real."
                    : page === "public"
                      ? "Sigue el ritmo de la competencia, vuelta a vuelta."
                      : "Organiza, consulta y administra tu competencia."}
              </p>
            </div>
            {admin && ["dashboard", "races"].includes(page) && (
              <button className="btn primary" onClick={() => open("race")}>
                ＋ Nueva competencia
              </button>
            )}
          </div>
          {error && (
            <div className="alert error" role="alert">
              {error}
              <button
                className="text-button"
                disabled={busy}
                onClick={() => void run(refresh, "Conexión actualizada.")}
              >
                Reintentar
              </button>
            </div>
          )}
          {notice && (
            <div className="alert success" role="status">
              ✓ {notice}
              <button
                className="icon-btn"
                onClick={() => setNotice("")}
                aria-label="Cerrar notificación"
              >
                ×
              </button>
            </div>
          )}
          {busy && (
            <div className="saving" role="status">
              Guardando…
            </div>
          )}
          {showPicker && (
            <div className="race-picker">
              <label htmlFor="race-select">COMPETENCIA SELECCIONADA</label>
              <select
                id="race-select"
                value={race?.id || ""}
                onChange={(e) => setSelected(e.target.value)}
              >
                {!races.length && <option value="">Sin competencias</option>}
                {races.map((r) => (
                  <option value={r.id} key={r.id}>
                    {r.name} · {r.status}
                  </option>
                ))}
              </select>
              {race && <Badge>{race.status}</Badge>}
            </div>
          )}
          {page === "dashboard" && (
            <>
              <div className="stats-grid">
                {[
                  [
                    "Competencias",
                    races.length,
                    "⚑",
                    `${races.filter((r) => r.status === "en ejecución").length} en ejecución`,
                  ],
                  [
                    "Corredores activos",
                    runners.filter((d) => d.active).length,
                    "◉",
                    "Listos para la salida",
                  ],
                  [
                    "Vueltas registradas",
                    allLaps,
                    "↺",
                    "Vueltas válidas en el historial",
                  ],
                  [
                    "Participaciones",
                    races.reduce((n, r) => n + r.participants.length, 0),
                    "◉",
                    "Inscripciones en competencias",
                  ],
                ].map(([label, value, icon, note]) => (
                  <div className="stat-card" key={label}>
                    <div>
                      <span>{label}</span>
                      <i>{icon}</i>
                    </div>
                    <b>{String(value).padStart(2, "0")}</b>
                    <small>{note}</small>
                  </div>
                ))}
              </div>
              <div className="dashboard-columns">
                <section className="panel featured">
                  <div className="panel-heading">
                    <h2>En el centro de la pista</h2>
                    {race && <Badge>{race.status}</Badge>}
                  </div>
                  {race ? (
                    <>
                      <div className="featured-content">
                        <span className="eyebrow">
                          {modes[race.mode]} / {dateLabel(race.date)}
                        </span>
                        <h2>{race.name}</h2>
                        <p>
                          {race.description ||
                            "La siguiente historia se escribe en la pista."}
                        </p>
                        <div className="featured-numbers">
                          <div>
                            <b>
                              {race.participants.length
                                .toString()
                                .padStart(2, "0")}
                            </b>
                            <span>Corredores inscritos</span>
                          </div>
                          <div>
                            <b>{currentLaps.toString().padStart(2, "0")}</b>
                            <span>Vueltas válidas</span>
                          </div>
                          <div>
                            <b>
                              {race.mode === "resistencia"
                                ? `${race.duration}′`
                                : race.target.toString().padStart(2, "0")}
                            </b>
                            <span>
                              {race.mode === "resistencia"
                                ? "Duración"
                                : "Vueltas objetivo"}
                            </span>
                          </div>
                        </div>
                        <button
                          className="btn primary"
                          onClick={() => go(locked ? "results" : "control")}
                        >
                          {locked
                            ? "Consultar resultados"
                            : "Ir al control de carrera"}
                        </button>
                      </div>
                      <div className="circuit-illustration">
                        <div className="circuit-line" />
                        <span className="circuit-start">SALIDA / META</span>
                        <RunningFigure />
                      </div>
                    </>
                  ) : (
                    <Empty
                      title="Tu próxima carrera comienza aquí"
                      detail="Crea una competencia, registra corredores y prepara la salida."
                      action={
                        admin && (
                          <button
                            className="btn primary"
                            onClick={() => open("race")}
                          >
                            Crear primera competencia
                          </button>
                        )
                      }
                    />
                  )}
                </section>
                <section className="panel quick-panel">
                  <div className="panel-heading">
                    <h2>Accesos rápidos</h2>
                    <span>↗</span>
                  </div>
                  {[
                    [
                      "runners",
                      "◉",
                      "Gestionar corredores",
                      "Prepara a tus competidores",
                    ],
                    [
                      "history",
                      "↺",
                      "Historial de carreras",
                      "Consulta tus competencias anteriores",
                    ],
                    [
                      "reports",
                      "▤",
                      "Descargar resultados",
                      "Reportes PDF y CSV",
                    ],
                    [
                      "public",
                      "◎",
                      "Pantalla de espectadores",
                      "Clasificación sin controles",
                    ],
                  ].map(([dest, icon, label, sub]) => (
                    <button
                      className="quick-link"
                      key={dest}
                      onClick={() => go(dest)}
                    >
                      <span>{icon}</span>
                      <div>
                        <b>{label}</b>
                        <small>{sub}</small>
                      </div>
                      <i>›</i>
                    </button>
                  ))}
                </section>
              </div>
              <div className="section-heading">
                <div>
                  <h2>Competencias recientes</h2>
                  <p>De la línea de salida a la meta.</p>
                </div>
                <button className="text-button" onClick={() => go("races")}>
                  Ver todas las competencias
                </button>
              </div>
              <div className="race-grid">
                {races.slice(-3).reverse().map(raceCard)}
              </div>
              {!races.length && (
                <div className="starter-guide">
                  <b>Prepara tu primera competencia</b>
                  <span>1. Registra a los corredores</span>
                  <span>2. Crea la carrera e inscribe participantes</span>
                  <span>3. Inicia el cronómetro y registra vueltas</span>
                </div>
              )}
            </>
          )}
          {["races", "history"].includes(page) && (
            <>
              <div className="toolbar">
                <input
                  aria-label="Buscar competencia"
                  placeholder="Buscar competencia o corredor…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <select
                  aria-label="Filtrar estado"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  <option value="all">Todos los estados</option>
                  {[
                    "creada",
                    "preparada",
                    "en ejecución",
                    "pausada",
                    "finalizada",
                    "cancelada",
                    "archivada",
                  ].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
                <input
                  type="date"
                  aria-label="Filtrar fecha"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
              <div className="race-grid">
                {races
                  .filter(
                    (r) =>
                      (page !== "history" ||
                        ["finalizada", "cancelada", "archivada"].includes(
                          r.status,
                        )) &&
                      (
                        r.name +
                        " " +
                        r.leaderboard
                          .map(
                            (p) =>
                              p.runner.name +
                              " " +
                              p.runner.name +
                              " " +
                              p.number,
                          )
                          .join(" ")
                      )
                        .toLowerCase()
                        .includes(query.toLowerCase()) &&
                      (filter === "all" || r.status === filter) &&
                      (!date || r.date === date),
                  )
                  .reverse()
                  .map(raceCard)}
              </div>
              {!races.length && (
                <Empty
                  title="Todavía no hay competencias"
                  detail="Crea una nueva competencia para empezar a organizar la salida."
                />
              )}
            </>
          )}
          {["control", "public"].includes(page) &&
            (race ? (
              <>
                <section className="race-console panel">
                  <div className="console-info">
                    <span className="eyebrow">
                      {modes[race.mode]} · INTENTO {race.attempt}
                    </span>
                    <h2>{race.name}</h2>
                    <div className="console-meta">
                      <span>
                        {race.lapDistance
                          ? `${race.lapDistance} m por vuelta`
                          : "Distancia histórica sin configurar"}
                      </span>
                      <span>{race.participants.length} corredores</span>
                      <span>{currentLaps} vueltas</span>
                      <span>
                        {race.mode === "resistencia"
                          ? `${race.duration} minutos`
                          : `${race.target} vueltas objetivo`}
                      </span>
                    </div>
                    <Badge>{race.status}</Badge>
                  </div>
                  <div className="timer">
                    <span className="eyebrow">CRONÓMETRO CENTRAL</span>
                    <output>{formatTime(elapsed)}</output>
                    <small>Tiempo acumulado · Pausas descontadas</small>
                  </div>
                  {user && page !== "public" && (
                    <div className="race-controls">
                      {["creada", "preparada"].includes(race.status) && (
                        <button
                          className="btn primary"
                          disabled={busy || now - lastSync > 4000}
                          onClick={() => void control("start")}
                        >
                          ▶ Iniciar carrera
                        </button>
                      )}
                      {race.status === "en ejecución" && (
                        <button
                          className="btn primary"
                          disabled={busy}
                          onClick={() => void control("pause")}
                        >
                          Ⅱ Pausar
                        </button>
                      )}
                      {race.status === "pausada" && (
                        <button
                          className="btn primary"
                          disabled={busy}
                          onClick={() => void control("resume")}
                        >
                          ▶ Reanudar
                        </button>
                      )}
                      {live && (
                        <button
                          className="btn"
                          disabled={busy}
                          onClick={() => void control("finish")}
                        >
                          ⚑ Finalizar
                        </button>
                      )}
                      {admin && !locked && (
                        <button
                          className="btn subtle"
                          disabled={busy}
                          onClick={() => void control("reset")}
                        >
                          Nuevo intento
                        </button>
                      )}
                    </div>
                  )}
                </section>
                <div className="mini-stats">
                  <span>
                    <b>{race.participants.length}</b> Participantes
                  </span>
                  <span>
                    <b>{currentLaps}</b> Vueltas válidas
                  </span>
                  <span>
                    <b>
                      {
                        race.leaderboard.filter((p) => p.status === "activo")
                          .length
                      }
                    </b>{" "}
                    Activos
                  </span>
                  <span>
                    <b>
                      {
                        race.penalties.filter((p) => p.attempt === race.attempt)
                          .length
                      }
                    </b>{" "}
                    Incidencias
                  </span>
                </div>
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Clasificación {locked ? "final" : "en vivo"}</h2>
                      <p>Vueltas válidas · Tiempo ajustado · Mejor vuelta</p>
                    </div>
                    <div className="actions">
                      {admin &&
                        page !== "public" &&
                        ["creada", "preparada"].includes(race.status) && (
                          <button
                            className="btn primary"
                            onClick={() => open("participant")}
                          >
                            ＋ Inscribir corredor
                          </button>
                        )}
                      {user && page !== "public" && live && (
                        <button className="btn" onClick={() => open("penalty")}>
                          Aplicar sanción
                        </button>
                      )}
                      <span className="live-label">
                        {locked ? "RESULTADOS" : "EN VIVO"}
                      </span>
                    </div>
                  </div>
                  <Leaderboard
                    race={race}
                    publicView={page === "public"}
                    busy={busy || now - lastSync > 4000}
                    lap={(id) =>
                      void run(
                        () =>
                          api(`/races/${race.id}/laps`, "POST", {
                            participantId: id,
                            requestId: crypto.randomUUID(),
                          }),
                        "Vuelta registrada.",
                      )
                    }
                    remove={
                      admin
                        ? (id) => {
                            if (confirm("¿Retirar esta inscripción?"))
                              void run(() =>
                                api(
                                  `/races/${race.id}/participants/${id}`,
                                  "DELETE",
                                ),
                              );
                          }
                        : undefined
                    }
                  />
                </section>
                {page !== "public" && (
                  <>
                    <div className="section-heading">
                      <h2>Registro de vueltas</h2>
                      <span className="muted">
                        Intento {race.attempt} ·{" "}
                        {
                          race.laps.filter((l) => l.attempt !== race.attempt)
                            .length
                        }{" "}
                        marcas anteriores conservadas
                      </span>
                    </div>
                    <section className="panel">
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>CORREDOR</th>
                              <th>INTENTO</th>
                              <th>MARCA ACUMULADA</th>
                              <th>DURACIÓN</th>
                              <th>VALIDACIÓN</th>
                              {admin && <th>ACCIONES</th>}
                            </tr>
                          </thead>
                          <tbody>
                            {race.laps
                              .slice()
                              .reverse()
                              .map((l) => (
                                <tr key={l.id}>
                                  <td>
                                    {
                                      race.leaderboard.find(
                                        (p) => p.id === l.participantId,
                                      )?.runner.name
                                    }
                                  </td>
                                  <td>{l.attempt}</td>
                                  <td className="mono">{formatTime(l.mark)}</td>
                                  <td className="mono">
                                    {formatTime(l.duration)}
                                  </td>
                                  <td>
                                    <Badge>
                                      {l.valid ? "válida" : "anulada"}
                                    </Badge>
                                    {l.reason && <small>{l.reason}</small>}
                                  </td>
                                  {admin && (
                                    <td>
                                      {l.valid &&
                                        !locked &&
                                        l.attempt === race.attempt && (
                                          <>
                                            <button
                                              className="text-button"
                                              disabled={busy}
                                              onClick={() => {
                                                const mark = prompt(
                                                  "Nueva marca acumulada en milisegundos:",
                                                  String(l.mark),
                                                );
                                                if (mark === null) return;
                                                const reason = prompt(
                                                  "Justificación de la corrección:",
                                                );
                                                if (reason)
                                                  void run(() =>
                                                    api(
                                                      `/races/${race.id}/laps/${l.id}`,
                                                      "PATCH",
                                                      {
                                                        mark: Number(mark),
                                                        reason,
                                                      },
                                                    ),
                                                  );
                                              }}
                                            >
                                              Corregir
                                            </button>
                                            <button
                                              className="text-button danger-text"
                                              disabled={busy}
                                              onClick={() => {
                                                const reason = prompt(
                                                  "Motivo de anulación. Se conservará la evidencia:",
                                                );
                                                if (reason)
                                                  void run(() =>
                                                    api(
                                                      `/races/${race.id}/laps/${l.id}`,
                                                      "PATCH",
                                                      { valid: false, reason },
                                                    ),
                                                  );
                                              }}
                                            >
                                              Anular
                                            </button>
                                          </>
                                        )}
                                    </td>
                                  )}
                                </tr>
                              ))}
                          </tbody>
                        </table>
                        {!race.laps.length && (
                          <p className="table-empty">
                            Las vueltas aparecerán aquí al registrarlas.
                          </p>
                        )}
                      </div>
                    </section>
                    <div className="bottom-actions">
                      {admin &&
                        !locked &&
                        race.leaderboard.some((p) => p.tied && p.laps > 0) && (
                          <button
                            className="btn"
                            disabled={busy}
                            onClick={() => {
                              const number = prompt(
                                "Dorsal del corredor que tiene prioridad en el empate:",
                              );
                              if (number === null) return;
                              const participant = race.leaderboard.find(
                                (p) => p.number === Number(number),
                              );
                              const reason = prompt("Motivo de la resolución:");
                              if (participant && reason)
                                void run(() =>
                                  api(`/races/${race.id}/tie-break`, "POST", {
                                    participantId: participant.id,
                                    reason,
                                  }),
                                );
                            }}
                          >
                            Resolver empate
                          </button>
                        )}
                      {admin && race.status === "finalizada" && (
                        <button
                          className="btn"
                          disabled={busy}
                          onClick={() => {
                            const reason = prompt(
                              "Justificación para reabrir los resultados oficiales:",
                            );
                            if (
                              reason &&
                              confirm(
                                "¿Reabrir la competencia? Los resultados anteriores quedarán en auditoría.",
                              )
                            )
                              void run(() =>
                                api(`/races/${race.id}/reopen`, "POST", {
                                  reason,
                                }),
                              );
                          }}
                        >
                          Reabrir con autorización
                        </button>
                      )}
                      {admin && race.status === "creada" && (
                        <button
                          className="btn"
                          disabled={busy}
                          onClick={() => void control("prepare")}
                        >
                          Marcar como preparada
                        </button>
                      )}
                      {admin && !locked && (
                        <button
                          className="text-button danger-text"
                          disabled={busy}
                          onClick={() => void control("cancel")}
                        >
                          Cancelar competencia
                        </button>
                      )}
                      {admin &&
                        ["finalizada", "cancelada"].includes(race.status) && (
                          <button
                            className="btn"
                            disabled={busy}
                            onClick={() => void control("archive")}
                          >
                            Archivar competencia
                          </button>
                        )}
                    </div>
                  </>
                )}
              </>
            ) : (
              <Empty
                title="La pista está en espera"
                detail="Crea y selecciona una competencia para abrir su centro de control."
              />
            ))}
          {page === "runners" && (
            <>
              <div className="toolbar">
                <input
                  aria-label="Buscar corredor"
                  placeholder="Buscar nombre, equipo, categoría o dorsal…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <select
                  aria-label="Estado"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  <option value="all">Todos</option>
                  <option value="active">Activos</option>
                  <option value="inactive">Dados de baja</option>
                </select>
                <button className="btn primary" onClick={() => open("runner")}>
                  ＋ Registrar corredor
                </button>
              </div>
              <section className="panel">
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>CORREDOR</th>
                        <th>EQUIPO / CLUB</th>
                        <th>CATEGORÍA</th>
                        <th>PARTICIPACIONES</th>
                        <th>ESTADO</th>
                        <th>ACCIONES</th>
                      </tr>
                    </thead>
                    <tbody>
                      {runners
                        .filter(
                          (d) =>
                            (
                              d.name +
                              " " +
                              d.team +
                              " " +
                              d.category +
                              " " +
                              races
                                .flatMap((r) =>
                                  r.participants
                                    .filter((p) => p.runnerId === d.id)
                                    .map((p) => p.number),
                                )
                                .join(" ")
                            )
                              .toLowerCase()
                              .includes(query.toLowerCase()) &&
                            (filter === "all" ||
                              d.active === (filter === "active")),
                        )
                        .map((d) => (
                          <tr key={d.id}>
                            <td>
                              <div className="runner-cell">
                                <span className="avatar">{d.name[0]}</span>
                                <b>{d.name}</b>
                              </div>
                            </td>
                            <td>{d.team}</td>
                            <td>{d.category}</td>
                            <td>
                              {
                                races.filter((r) =>
                                  r.participants.some(
                                    (p) => p.runnerId === d.id,
                                  ),
                                ).length
                              }
                            </td>
                            <td>
                              <Badge>{d.active ? "activo" : "baja"}</Badge>
                            </td>
                            <td>
                              <button
                                className="text-button"
                                onClick={() => open("runner", d)}
                              >
                                Editar
                              </button>
                              {admin && (
                                <button
                                  className="text-button"
                                  disabled={busy}
                                  onClick={() => {
                                    if (
                                      confirm(
                                        d.active
                                          ? "¿Dar de baja al corredor y conservar su historial?"
                                          : "¿Reactivar al corredor?",
                                      )
                                    )
                                      void run(() =>
                                        api("/runners/" + d.id, "PATCH", {
                                          active: !d.active,
                                        }),
                                      );
                                  }}
                                >
                                  {d.active ? "Dar de baja" : "Reactivar"}
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                {!runners.length && (
                  <Empty
                    title="La salida te espera"
                    detail="Registra a las personas que participarán en tus carreras."
                  />
                )}
              </section>
              <section className="panel comparison">
                <div className="panel-heading">
                  <h2>Rendimiento de corredores</h2>
                </div>
                {runners
                  .filter((d) => d.active)
                  .map((d) => {
                    const rows = races.flatMap((r) =>
                      r.leaderboard.filter((p) => p.runnerId === d.id),
                    );
                    const laps = rows.reduce((n, p) => n + p.laps, 0);
                    return (
                      <div className="performance-row" key={d.id}>
                        <b>{d.name}</b>
                        <div>
                          <i
                            style={{
                              width:
                                Math.max(
                                  1,
                                  Math.min(
                                    100,
                                    (laps / Math.max(1, allLaps)) * 100,
                                  ),
                                ) + "%",
                            }}
                          />
                        </div>
                        <span>{laps} vueltas</span>
                        <span className="mono">
                          {rows.some((p) => p.best !== null)
                            ? formatTime(
                                Math.min(
                                  ...rows.map((p) => p.best ?? Infinity),
                                ),
                              )
                            : "—"}
                        </span>
                      </div>
                    );
                  })}
              </section>
            </>
          )}
          {page === "penalties" && (
            <>
              <div className="section-heading">
                <h2>Incidencias de la competencia</h2>
                <button
                  className="btn primary"
                  disabled={!live}
                  onClick={() => open("penalty")}
                >
                  ＋ Registrar sanción
                </button>
              </div>
              <section className="panel">
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>CORREDOR</th>
                        <th>TIPO</th>
                        <th>VALOR</th>
                        <th>MOTIVO</th>
                        <th>RESPONSABLE</th>
                        <th>INTENTO</th>
                      </tr>
                    </thead>
                    <tbody>
                      {race?.penalties
                        .slice()
                        .reverse()
                        .map((p) => (
                          <tr key={p.id}>
                            <td>
                              {
                                race.leaderboard.find(
                                  (x) => x.id === p.participantId,
                                )?.runner.name
                              }
                            </td>
                            <td>
                              <Badge>{p.type}</Badge>
                            </td>
                            <td>
                              {p.type === "tiempo"
                                ? `+${p.value / 1000} s`
                                : "—"}
                            </td>
                            <td>{p.reason}</td>
                            <td>
                              {p.user}
                              <small>
                                {new Date(p.date).toLocaleString("es-MX")}
                              </small>
                            </td>
                            <td>{p.attempt}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                  {!race?.penalties.length && (
                    <Empty
                      title="Una carrera limpia"
                      detail="Las incidencias se mostrarán aquí con su motivo y responsable."
                    />
                  )}
                </div>
              </section>
            </>
          )}
          {["results", "reports"].includes(page) &&
            (race ? (
              <>
                <section className="panel report-heading">
                  <div>
                    <span className="eyebrow">
                      {race.status === "finalizada" ||
                      race.status === "archivada"
                        ? "RESULTADOS CONSERVADOS"
                        : "CLASIFICACIÓN PROVISIONAL"}
                    </span>
                    <h2>{race.name}</h2>
                    <p>
                      {dateLabel(race.date)} · {modes[race.mode]} · Intento{" "}
                      {race.attempt}
                    </p>
                  </div>
                  <div className="actions">
                    <button
                      className="btn"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () =>
                            download(
                              `/races/${race.id}/export/csv`,
                              "resultados.csv",
                            ),
                          "CSV descargado.",
                        )
                      }
                    >
                      ▤ Exportar CSV
                    </button>
                    <button
                      className="btn primary"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () =>
                            download(
                              `/races/${race.id}/export/pdf`,
                              "resultados.pdf",
                            ),
                          "PDF descargado.",
                        )
                      }
                    >
                      Descargar PDF
                    </button>
                  </div>
                </section>
                {race.results?.some((p) => p.winner) && (
                  <div className="podium">
                    {race.leaderboard
                      .filter((p) => !p.excluded)
                      .slice(0, 3)
                      .map((p, i) => (
                        <div className={`podium-place place-${i}`} key={p.id}>
                          <span>{["♛", "②", "③"][i]}</span>
                          <small>
                            {i === 0 ? "GANADOR" : `${i + 1}.º LUGAR`}
                          </small>
                          <h2>{p.runner.name}</h2>
                          <p>
                            #{p.number} · {p.runner.category}
                          </p>
                          <b className="mono">{formatTime(p.total)}</b>
                        </div>
                      ))}
                  </div>
                )}
                {locked && !race.results?.some((p) => p.winner) && (
                  <div className="alert">
                    No hay ganador oficial: revisa las condiciones de victoria y
                    los registros conservados.
                  </div>
                )}
                <section className="panel">
                  <Leaderboard race={race} publicView />
                </section>
                <div className="stats-grid result-stats">
                  <div className="stat-card">
                    <span>Mejor vuelta</span>
                    <b className="small-value">
                      {best ? formatTime(best.best!) : "—"}
                    </b>
                    <small>{best?.runner.name || "Sin vueltas válidas"}</small>
                  </div>
                  <div className="stat-card">
                    <span>Vueltas válidas</span>
                    <b>{currentLaps}</b>
                    <small>Intento actual</small>
                  </div>
                  <div className="stat-card">
                    <span>Penalizaciones</span>
                    <b>
                      {
                        race.penalties.filter((p) => p.attempt === race.attempt)
                          .length
                      }
                    </b>
                    <small>Con justificación registrada</small>
                  </div>
                  <div className="stat-card">
                    <span>Tiempo de competencia</span>
                    <b className="small-value">{formatTime(elapsed)}</b>
                    <small>Pausas descontadas</small>
                  </div>
                </div>
              </>
            ) : (
              <Empty
                title="Los resultados llegarán a la meta"
                detail="Selecciona o crea una competencia para consultar y exportar sus resultados."
              />
            ))}
          {page === "users" && admin && (
            <>
              <div className="section-heading">
                <h2>Cuentas y permisos</h2>
                <button className="btn primary" onClick={() => open("user")}>
                  ＋ Crear usuario
                </button>
              </div>
              <section className="panel">
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>USUARIO</th>
                        <th>CORREO</th>
                        <th>ROL</th>
                        <th>ESTADO</th>
                        <th>ACCIÓN</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((u) => (
                        <tr key={u.id}>
                          <td>{u.name}</td>
                          <td>{u.email}</td>
                          <td>
                            <Badge>{u.role}</Badge>
                          </td>
                          <td>{u.active ? "Activo" : "Desactivado"}</td>
                          <td>
                            <button
                              className="text-button"
                              onClick={() => open("user", u)}
                            >
                              Editar permisos
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
              <p className="help-text">
                Los operadores registran corredores, vueltas y sanciones. La
                configuración de carreras y la administración requieren rol de
                administrador.
              </p>
            </>
          )}
          {page === "audit" && admin && (
            <>
              <div className="toolbar">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar acción, responsable o entidad…"
                  aria-label="Buscar auditoría"
                />
                <button
                  className="btn"
                  onClick={() =>
                    void run(
                      async () => setAudits(await api<Audit[]>("/audit")),
                      "Auditoría actualizada.",
                    )
                  }
                >
                  Actualizar
                </button>
              </div>
              <section className="panel">
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>FECHA</th>
                        <th>RESPONSABLE</th>
                        <th>ACCIÓN</th>
                        <th>EVIDENCIA</th>
                      </tr>
                    </thead>
                    <tbody>
                      {audits
                        .filter((a) =>
                          JSON.stringify(a)
                            .toLowerCase()
                            .includes(query.toLowerCase()),
                        )
                        .map((a) => (
                          <tr key={a.id}>
                            <td>{new Date(a.date).toLocaleString("es-MX")}</td>
                            <td>{a.user}</td>
                            <td>
                              <b>{a.action}</b>
                              <small>{a.entity}</small>
                              {a.reason && <small>{a.reason}</small>}
                            </td>
                            <td>
                              <details>
                                <summary>Ver cambios</summary>
                                <pre>
                                  {JSON.stringify(
                                    { anterior: a.before, nuevo: a.after },
                                    null,
                                    2,
                                  )}
                                </pre>
                              </details>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
          {page === "settings" && admin && (
            <div className="settings-grid">
              <section className="panel settings-panel">
                <h2>Identidad de la competencia</h2>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run(() => api("/settings", "PUT", settings));
                  }}
                >
                  <Field label="Nombre del sistema">
                    <input
                      value={settings.name}
                      onChange={(e) =>
                        setSettings({ ...settings, name: e.target.value })
                      }
                      required
                      maxLength={120}
                    />
                  </Field>
                  <Field label="Sede">
                    <input
                      value={settings.venue}
                      onChange={(e) =>
                        setSettings({ ...settings, venue: e.target.value })
                      }
                      maxLength={120}
                    />
                  </Field>
                  <Field label="Temporada">
                    <input
                      value={settings.season}
                      onChange={(e) =>
                        setSettings({ ...settings, season: e.target.value })
                      }
                      required
                      maxLength={30}
                    />
                  </Field>
                  <button className="btn primary" disabled={busy}>
                    Guardar configuración
                  </button>
                </form>
              </section>
              <section className="panel settings-panel">
                <h2>Respaldo y recuperación</h2>
                <p>
                  Descarga una copia consistente de los registros V2. El
                  respaldo incluye cuentas y hashes de contraseñas; guárdalo en
                  un lugar privado.
                </p>
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () => download("/backup", "carrera-respaldo.json"),
                      "Respaldo descargado.",
                    )
                  }
                >
                  Descargar respaldo
                </button>
                <hr />
                <h3>Restaurar información</h3>
                <p>
                  Reemplaza los registros V2 y cierra las sesiones. Se conserva
                  una copia previa en SQLite.
                </p>
                <Field label="Archivo de respaldo JSON">
                  <input
                    type="file"
                    accept=".json,application/json"
                    disabled={busy}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const input = e.target;
                      try {
                        const data = JSON.parse(await file.text());
                        const reason = prompt("Motivo de la restauración:");
                        if (!reason) return;
                        if (
                          !confirm(
                            "¿Restaurar este respaldo y reemplazar los registros actuales?",
                          )
                        )
                          return;
                        await run(async () => {
                          await api("/restore", "POST", { ...data, reason });
                          setToken("");
                          setUser(null);
                          go("dashboard");
                        }, "Respaldo restaurado. Inicia sesión de nuevo.");
                      } catch {
                        setError("No se pudo leer el respaldo JSON.");
                      } finally {
                        input.value = "";
                      }
                    }}
                  />
                </Field>
              </section>
            </div>
          )}
          {user && page === "settings" && (
            <section className="panel settings-panel password-panel">
              <h2>Cambiar contraseña</h2>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const body = Object.fromEntries(
                    new FormData(e.currentTarget),
                  );
                  void run(async () => {
                    await api("/auth/password", "POST", body);
                    setToken("");
                    setUser(null);
                  }, "Contraseña actualizada. Inicia sesión de nuevo.");
                }}
              >
                <Field label="Contraseña actual">
                  <input
                    type="password"
                    name="current"
                    autoComplete="current-password"
                    required
                  />
                </Field>
                <Field label="Nueva contraseña">
                  <input
                    type="password"
                    name="password"
                    minLength={10}
                    maxLength={72}
                    autoComplete="new-password"
                    required
                  />
                </Field>
                <button className="btn primary" disabled={busy}>
                  Actualizar contraseña
                </button>
              </form>
            </section>
          )}
          <footer>
            <span>
              CDM <b>/</b> {settings.name.toUpperCase()}
            </span>
            <span>CONTROL DE COMPETENCIA · {settings.season}</span>
          </footer>
        </main>
      </div>
      {modal && (
        <Forms
          kind={modal}
          edit={edit}
          race={race}
          runners={runners}
          busy={busy}
          error={error}
          close={() => setModal(null)}
          save={async (body) => {
            const kind =
              modal === "race"
                ? "races"
                : modal === "runner"
                  ? "runners"
                  : modal === "user"
                    ? "users"
                    : `races/${race!.id}/${modal === "participant" ? "participants" : "penalties"}`;
            const ok = await run(async () => {
              const value = await api<Race>(
                `/${kind}${edit ? `/${edit.id}` : ""}`,
                edit ? "PATCH" : "POST",
                body,
              );
              if (modal === "race") setSelected(value.id);
              if (modal === "user") setUsers(await api<User[]>("/users"));
            });
            if (ok) setModal(null);
          }}
        />
      )}
    </div>
  );
}
