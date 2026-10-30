import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Piloto, PilotoInput } from './types';
const blank = { nombre: '', alias: '', vehiculo: '', numero: '' };
export default function PilotForm({ editing, busy, save, cancel }: { editing: Piloto | null; busy: boolean; save: (p: PilotoInput) => Promise<boolean>; cancel: () => void }) {
  const [form, setForm] = useState(blank);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setForm(editing ? { nombre: editing.nombre, alias: editing.alias, vehiculo: editing.vehiculo, numero: String(editing.numero) } : blank);
    if (editing) { first.current?.focus(); first.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  }, [editing]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (await save({ ...form, numero: Number(form.numero), estado: editing?.estado || 'activo' })) setForm(blank);
  }
  return <form onSubmit={submit} className="panel mb-10 p-5 md:p-6">
    <div className="mb-5 flex items-center gap-3"><span className="section-code">01 /</span><h2 className="font-display text-sm">{editing ? 'Editar piloto' : 'Registro de pilotos'}</h2></div>
    <fieldset disabled={busy} className="grid gap-4 md:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_120px_auto] items-end">
      {(['nombre', 'alias', 'vehiculo', 'numero'] as const).map((key, i) => <label key={key} className="text-sm text-slate-400">{['Nombre del piloto', 'Alias', 'Vehículo', 'Número'][i]}<input ref={i === 0 ? first : undefined} required maxLength={100} type={key === 'numero' ? 'number' : 'text'} min={0} max={999} value={form[key]} placeholder={['Ej. Alex Morgan', 'Ej. Ghost', 'Ej. Interceptor', '007'][i]} onChange={e => setForm({ ...form, [key]: e.target.value })}/></label>)}
      <div className="flex gap-2"><button className="btn primary" type="submit">{editing ? 'Guardar cambios' : '+ Registrar piloto'}</button>{editing && <button className="btn" type="button" onClick={cancel}>Cancelar</button>}</div>
    </fieldset>
  </form>;
}
