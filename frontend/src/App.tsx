import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { estados, ordenarPilotos, type Piloto, type PilotoInput, type Vuelta, type Cronometro, type Estado } from './types';
import Clock, { type ClockSnapshot } from './Clock';
import PilotForm from './PilotForm';
import PilotCard from './PilotCard';

export default function App() {
  const [pilotos, setPilotos] = useState<Piloto[]>([]);
  const [vueltas, setVueltas] = useState<Record<number, Vuelta[]>>({});
  const [snapshot, setSnapshot] = useState<ClockSnapshot | null>(null);
  const [editing, setEditing] = useState<Piloto | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [clockError, setClockError] = useState('');
  const [notice, setNotice] = useState('');
  const syncClock = useCallback(async () => {
    const data = await api<Cronometro>('/cronometro');
    setSnapshot({ data, receivedAt: performance.now() });
    setClockError('');
  }, []);
  const refresh = useCallback(async () => {
    const rows = await api<Piloto[]>('/pilotos');
    const histories = await Promise.all(rows.map(async p => [p.id, await api<Vuelta[]>(`/pilotos/${p.id}/vueltas`)] as const));
    setPilotos(rows); setVueltas(Object.fromEntries(histories));
  }, []);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { await Promise.all([refresh(), syncClock()]); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [refresh, syncClock]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (busy || loading) return;
    let cancelled = false;
    let inFlight = false;
    const timer = setInterval(() => {
      if (inFlight) return;
      inFlight = true;
      void api<Cronometro>('/cronometro').then(data => {
        if (!cancelled) { setSnapshot({ data, receivedAt: performance.now() }); setClockError(''); }
      }).catch(e => { if (!cancelled) setClockError(e.message); }).finally(() => { inFlight = false; });
    }, 2000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [busy, loading]);
  async function mutate(action: () => Promise<void>, message: string): Promise<boolean> {
    if (busy) return false;
    setBusy(true); setError(''); setNotice('');
    try { await action(); setNotice(message); return true; }
    catch (e) { setError((e as Error).message); return false; }
    finally { setBusy(false); }
  }
  async function save(p: PilotoInput) {
    return mutate(async () => {
      await api(editing ? `/pilotos/${editing.id}` : '/pilotos', editing ? 'PUT' : 'POST', p);
      setEditing(null); await refresh();
    }, editing ? 'Piloto actualizado.' : 'Piloto registrado.');
  }
  function state(p: Piloto, estado: Estado) {
    void mutate(async () => {
      const updated = await api<Piloto>(`/pilotos/${p.id}`, 'PUT', { ...p, estado });
      setPilotos(rows => rows.map(row => row.id === p.id ? updated : row));
      if (editing?.id === p.id) setEditing(updated);
    }, 'Estado actualizado. Dashboard reordenado.');
  }
  function remove(p: Piloto) {
    if (!confirm(`¿Eliminar a ${p.nombre} y todas sus vueltas? Esta acción es permanente.`)) return;
    void mutate(async () => { await api(`/pilotos/${p.id}`, 'DELETE'); if (editing?.id === p.id) setEditing(null); await refresh(); }, 'Piloto y vueltas eliminados.');
  }
  function lap(p: Piloto) {
    void mutate(async () => {
      const v = await api<Vuelta>(`/pilotos/${p.id}/vueltas`, 'POST');
      setVueltas(previous => ({ ...previous, [p.id]: [v, ...(previous[p.id] || [])] }));
    }, `Vuelta registrada para ${p.alias}.`);
  }
  function deleteLap(v: Vuelta) {
    if (!confirm('¿Eliminar esta vuelta del historial?')) return;
    void mutate(async () => { await api(`/vueltas/${v.id}`, 'DELETE'); setVueltas(previous => ({ ...previous, [v.piloto_id]: previous[v.piloto_id].filter(row => row.id !== v.id) })); }, 'Vuelta eliminada.');
  }
  function control(action: string) {
    if (action === 'reiniciar' && !confirm('¿Reiniciar el cronómetro a cero? Se conserva el historial de vueltas.')) return;
    void mutate(async () => {
      const data = await api<Cronometro>('/cronometro', action === 'reanudar' ? 'POST' : 'PUT', action === 'reanudar' ? undefined : { accion: action });
      setSnapshot({ data, receivedAt: performance.now() });
    }, 'Cronómetro actualizado.');
  }
  const sorted = useMemo(() => ordenarPilotos(pilotos), [pilotos]);
  const stats = [{ label: 'Pilotos registrados', value: pilotos.length }, ...estados.map(s => ({ label: s, value: pilotos.filter(p => p.estado === s).length })), { label: 'Vueltas totales', value: Object.values(vueltas).reduce((n, v) => n + v.length, 0) }];
  return <div className="min-h-screen">
    <header className="border-b border-white/10"><div className="max-w-[1440px] mx-auto px-5 md:px-10 py-5 flex flex-wrap items-center justify-between gap-3"><a href="#" className="font-display text-xs tracking-[.25em] text-neon">▰ CDM <span className="text-slate-500 ml-3">RACE CONTROL</span></a><span className="text-xs tracking-widest text-slate-400">CENTRO DE MANDO / TEMPORADA 01</span></div></header>
    <main className="max-w-[1440px] mx-auto px-5 md:px-10 py-10">
      <section className="grid lg:grid-cols-[1fr_1fr] gap-8 mb-8 items-center"><div><p className="text-magenta text-xs tracking-[.35em] uppercase mb-4">Sistema de competición // online</p><h1 className="font-display text-3xl md:text-5xl font-black leading-tight">CARRERA<br/>DE LA <span className="text-neon glow">MUERTE</span><span className="text-magenta">.</span></h1><p className="text-slate-400 mt-5 max-w-md">Cada segundo cuenta. Controla la parrilla, registra vueltas y sigue el pulso de la carrera.</p></div><Clock snapshot={snapshot} busy={busy || !!clockError} control={control}/></section>
      {(error || clockError) && <div role="alert" className="mb-5 p-4 border border-magenta/50 bg-magenta/10 text-pink-200">{error || clockError}<button className="btn ml-4" disabled={busy || loading} onClick={() => void load()}>Reintentar conexión</button></div>}
      <p role="status" aria-live="polite" className="text-acid text-sm min-h-6 mb-4">{busy ? 'Guardando en el servidor…' : notice}</p>
      <section aria-label="Estadísticas" className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-8">{stats.map((s, i) => <div className="panel p-4" key={s.label}><span className="text-xs uppercase tracking-widest text-slate-400">{s.label}</span><p className={`font-display text-3xl mt-2 ${i === 4 ? 'text-magenta' : i === 1 ? 'text-acid' : 'text-neon'}`}>{loading ? '—' : String(s.value).padStart(2, '0')}</p></div>)}</section>
      <PilotForm editing={editing} busy={busy || loading} save={save} cancel={() => setEditing(null)}/>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5"><h2 className="font-display text-lg"><span className="section-code mr-3">02 /</span>Parrilla de pilotos</h2><p className="text-xs text-slate-400">ORDEN AUTOMÁTICO · Activo → Penalizado → Ganador → Eliminado</p></div>
      {loading ? <p className="panel p-12 text-center text-neon" role="status">Conectando con el centro de mando…</p> : sorted.length ? <section aria-label="Pilotos" className="grid md:grid-cols-2 xl:grid-cols-3 gap-5">{sorted.map(p => <PilotCard key={p.id} piloto={p} vueltas={vueltas[p.id] || []} busy={busy || !!clockError} onState={state} onEdit={setEditing} onDelete={remove} onLap={lap} onDeleteLap={deleteLap}/>)}</section> : <div className="empty"><span className="text-neon text-4xl">◇</span><h3 className="font-display mt-4 text-lg">La pista espera.</h3><p className="text-slate-400 mt-2">Registra al primer piloto para comenzar la carrera.</p></div>}
      <footer className="flex justify-between gap-4 mt-12 pt-5 border-t border-white/10 text-xs tracking-widest text-slate-500"><span>CDM / CONTROL DE PILOTOS</span><span>REACT + SQLITE · MARCAS ACUMULADAS</span></footer>
    </main>
  </div>;
}
