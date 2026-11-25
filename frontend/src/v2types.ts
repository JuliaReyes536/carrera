export interface User {
  id: string;
  name: string;
  email: string;
  role: "administrador" | "operador";
  active: boolean;
}
export interface Runner {
  id: string;
  name: string;
  team: string;
  category: string;
  active: boolean;
}
export interface Participant {
  id: string;
  runnerId: string;
  number: number;
  status: string;
}
export interface Row extends Participant {
  distance: number | null;
  pace: number | null;
  runner: Runner;
  laps: number;
  total: number;
  best: number | null;
  average: number | null;
  penalty: number;
  excluded: boolean;
  position: number | null;
  tied: boolean;
  winner?: boolean;
}
export interface Lap {
  id: string;
  participantId: string;
  attempt: number;
  mark: number;
  duration: number;
  valid: boolean;
  reason?: string;
  date: string;
}
export interface Penalty {
  id: string;
  participantId: string;
  attempt: number;
  type: string;
  value: number;
  reason: string;
  user: string;
  date: string;
}
export interface Race {
  id: string;
  name: string;
  description: string;
  date: string;
  mode: string;
  target: number;
  duration: number;
  lapDistance: number | null;
  status: string;
  attempt: number;
  attempts: unknown[];
  participants: Participant[];
  laps: Lap[];
  penalties: Penalty[];
  leaderboard: Row[];
  results: Row[];
  elapsed: number;
  serverNow: number;
}
export interface Audit {
  id: string;
  date: string;
  user: string;
  action: string;
  entity: string;
  before: unknown;
  after: unknown;
  reason: string;
}
export interface Settings {
  id: string;
  name: string;
  venue: string;
  season: string;
}
