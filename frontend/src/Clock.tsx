import { useEffect, useState } from 'react';
import { formatTime, type Cronometro } from './types';
export interface ClockSnapshot { data: Cronometro; receivedAt: number }
export default function Clock({ snapshot, busy, control }: { snapshot: ClockSnapshot | null; busy: boolean; control: (action: string) => void }) {
  const [now, setNow] = useState(performance.now());
  useEffect(() => { const interval = setInterval(() => setNow(performance.now()), 30); return () => clearInterval(interval); }, []);
  const running = snapshot?.data.estado === 'corriendo';
  const elapsed = snapshot ? snapshot.data.tiempo_global + (running ? Math.max(0, now - snapshot.receivedAt) : 0) : 0;
  return <section className={`panel clock-panel ${running ? 'running' : ''}`} aria-label="Cronómetro global">
    <div className="flex justify-between items-center text-xs tracking-[.2em] text-slate-400"><h2>CRONÓMETRO GLOBAL</h2><span className={running ? 'text-acid' : ''}>● {running ? 'EN CARRERA' : 'PAUSADO'}</span></div>
    <output className="clock-time" aria-live="off">{formatTime(elapsed)}</output>
    <div className="flex flex-wrap justify-center gap-2"><button className="btn primary" disabled={busy || !snapshot || running} onClick={() => control('reanudar')}>{elapsed > 0 ? 'Reanudar' : 'Iniciar'}</button><button className="btn" disabled={busy || !running} onClick={() => control('pausar')}>Pausar</button><button className="btn danger" disabled={busy || !snapshot} onClick={() => control('reiniciar')}>Reiniciar</button></div>
    <p className="text-xs text-slate-500 text-center mt-3">Marcas de vuelta verificadas por el servidor · ms</p>
  </section>;
}
