export const estados = ['activo', 'penalizado', 'ganador', 'eliminado'] as const;
export type Estado = typeof estados[number];
export interface Piloto { id: number; nombre: string; alias: string; vehiculo: string; numero: number; estado: Estado }
export type PilotoInput = Omit<Piloto, 'id'>;
export interface Vuelta { id: number; piloto_id: number; tiempo_registrado: number; fecha: string }
export interface Cronometro { tiempo_global: number; estado: 'corriendo' | 'pausado'; servidor_ahora: number }
export const ordenarPilotos = (pilotos: Piloto[]) => [...pilotos].sort((a, b) => estados.indexOf(a.estado) - estados.indexOf(b.estado) || a.id - b.id);
export function formatTime(ms: number) {
  const t = Math.max(0, Math.floor(ms));
  const pad = (n: number, size = 2) => String(n).padStart(size, '0');
  return `${pad(Math.floor(t / 3600000))}:${pad(Math.floor(t / 60000) % 60)}:${pad(Math.floor(t / 1000) % 60)}.${pad(t % 1000, 3)}`;
}
