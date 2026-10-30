import { estados, formatTime, type Piloto, type Estado, type Vuelta } from './types';
export default function PilotCard({ piloto: p, vueltas, busy, onState, onEdit, onDelete, onLap, onDeleteLap }: { piloto: Piloto; vueltas: Vuelta[]; busy: boolean; onState: (p: Piloto, state: Estado) => void; onEdit: (p: Piloto) => void; onDelete: (p: Piloto) => void; onLap: (p: Piloto) => void; onDeleteLap: (v: Vuelta) => void }) {
  return <article className={`pilot-card ${p.estado}`}>
    <div className="flex justify-between items-start gap-3"><span className="status"><span className="status-dot"/>{p.estado}</span><span className="font-display text-3xl text-slate-500">#{String(p.numero).padStart(2, '0')}</span></div>
    <h3 className="mt-5 text-2xl font-bold">{p.nombre}</h3><p className="text-neon tracking-widest uppercase text-sm">« {p.alias} »</p>
    <p className="text-slate-400 mt-3 mb-5 text-sm">↗ {p.vehiculo}</p>
    <label className="text-xs uppercase tracking-widest text-slate-400">Estado del piloto<select disabled={busy} value={p.estado} onChange={e => onState(p, e.target.value as Estado)}>{estados.map(s => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}</select></label>
    <button disabled={busy} className="btn lap w-full mt-4" onClick={() => onLap(p)}>＋ Registrar Vuelta</button>
    <div className="mt-5 border-t border-white/10 pt-4"><div className="flex justify-between text-xs tracking-widest uppercase text-slate-400"><h4>Historial de vueltas</h4><span>{vueltas.length.toString().padStart(2, '0')} REG.</span></div>
      {vueltas.length ? <ol className="lap-list mt-3 max-h-44 overflow-auto">{vueltas.map((v, i) => <li key={v.id} className="flex items-center justify-between gap-2 border-b border-white/5 py-2"><span className="text-slate-500 text-xs">V{vueltas.length - i}</span><div className="text-right"><time className="font-mono text-sm text-neon">{formatTime(v.tiempo_registrado)}</time><p className="text-[11px] text-slate-500">{new Date(v.fecha).toLocaleString('es-MX')}</p></div><button disabled={busy} className="text-slate-500 hover:text-magenta px-2" aria-label={`Eliminar vuelta ${vueltas.length - i} de ${p.nombre}`} onClick={() => onDeleteLap(v)}>×</button></li>)}</ol> : <p className="text-sm text-slate-500 py-5">Sin vueltas registradas todavía.</p>}
    </div>
    <div className="flex gap-2 mt-auto pt-5"><button disabled={busy} className="btn flex-1" onClick={() => onEdit(p)}>Editar</button><button disabled={busy} className="btn danger flex-1" onClick={() => onDelete(p)}>Eliminar</button></div>
  </article>;
}
