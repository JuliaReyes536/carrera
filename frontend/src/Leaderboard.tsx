import type { Race } from "./v2types";
import { formatTime, formatPace } from "./types";
import { Badge, Empty } from "./ui";
export default function Leaderboard({
  race,
  publicView = false,
  busy = false,
  lap,
  remove,
}: {
  race: Race;
  publicView?: boolean;
  busy?: boolean;
  lap?: (id: string) => void;
  remove?: (id: string) => void;
}) {
  const best = Math.min(...race.leaderboard.map((p) => p.best ?? Infinity));
  return !race.leaderboard.length ? (
    <Empty
      title="La salida está por formarse"
      detail="Inscribe al menos dos corredores para preparar la competencia."
    />
  ) : (
    <div className="table-wrap">
      <table
        className={
          publicView ? "leaderboard-table" : "leaderboard-table with-controls"
        }
      >
        <thead>
          <tr>
            <th>POS</th>
            <th>CORREDOR / EQUIPO</th>
            <th>VUELTAS</th>
            <th>DISTANCIA</th>
            <th>RITMO / KM</th>
            <th>MEJOR VUELTA</th>
            <th>PROMEDIO</th>
            <th>TIEMPO AJUSTADO</th>
            <th>ESTADO</th>
            {!publicView && <th>CONTROL</th>}
          </tr>
        </thead>
        <tbody>
          {race.leaderboard.map((p, i) => (
            <tr key={p.id}>
              <td>
                <span className={`position pos-${i + 1}`}>
                  {p.position === null
                    ? "—"
                    : String(p.position).padStart(2, "0")}
                </span>
              </td>
              <td>
                <div className="runner-cell">
                  <span className="race-number">{p.number}</span>
                  <div>
                    <b>{p.runner.name}</b>
                    <small>
                      {p.runner.category} ·{p.runner.team}
                    </small>
                  </div>
                </div>
              </td>
              <td>
                <b className="mono">{p.laps.toString().padStart(2, "0")}</b>
                <span className="muted">
                  {["vueltas", "contrarreloj"].includes(race.mode)
                    ? ` / ${race.target}`
                    : ""}
                </span>
              </td>
              <td>
                {p.distance === null
                  ? "—"
                  : `${(p.distance / 1000).toLocaleString("es-MX")} km`}
              </td>
              <td className="mono">{formatPace(p.pace)}</td>
              <td className={p.best === best ? "best-time mono" : "mono"}>
                {p.best === null ? "—" : formatTime(p.best)}
                {p.best === best && <small>MEJOR VUELTA</small>}
              </td>
              <td className="mono">
                {p.average === null ? "—" : formatTime(p.average)}
              </td>
              <td className="mono">
                {p.laps ? formatTime(p.total) : "—"}
                {p.penalty > 0 && (
                  <small className="warning">
                    +{(p.penalty / 1000).toFixed(3)} s
                  </small>
                )}
              </td>
              <td>
                <Badge>
                  {p.penalty && p.status === "activo" ? "penalizado" : p.status}
                </Badge>
                {p.tied && p.laps > 0 && (
                  <small className="warning">Empate pendiente</small>
                )}
              </td>
              {!publicView && (
                <td>
                  <button
                    className="btn lap-btn"
                    disabled={
                      busy ||
                      race.status !== "en ejecución" ||
                      p.status !== "activo"
                    }
                    onClick={() => lap?.(p.id)}
                  >
                    ＋ Vuelta
                  </button>
                  {remove && ["creada", "preparada"].includes(race.status) && (
                    <button
                      className="text-button danger-text"
                      disabled={busy}
                      onClick={() => remove(p.id)}
                    >
                      Retirar
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
