import { useState } from "react";
import { Field, Modal, modes } from "./ui";
import type { Runner, Race, User } from "./v2types";
export type Edit = Runner | Race | User | null;
export type FormKind = "race" | "runner" | "participant" | "penalty" | "user";
export default function Forms({
  kind,
  edit,
  race,
  runners,
  busy,
  error,
  close,
  save,
}: {
  kind: FormKind;
  edit: Edit;
  race?: Race;
  runners: Runner[];
  busy: boolean;
  error: string;
  close: () => void;
  save: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [mode, setMode] = useState(
    edit && "mode" in edit ? edit.mode : "vueltas",
  );
  const titles = {
    race: edit ? "Editar competencia" : "Nueva competencia",
    runner: edit ? "Editar corredor" : "Registrar corredor",
    participant: "Inscribir participante",
    penalty: "Registrar sanción",
    user: edit ? "Editar usuario" : "Crear usuario",
  };
  return (
    <Modal title={titles[kind]} close={close}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const body: Record<string, unknown> = Object.fromEntries(
            new FormData(e.currentTarget),
          );
          if (kind === "race") {
            body.target = Number(body.target || 5);
            body.duration = Number(body.duration || 30);
            body.lapDistance = Number(body.lapDistance || 400);
          }
          if (kind === "participant") body.number = Number(body.number);
          if (kind === "penalty")
            body.value = Math.round(Number(body.value) * 1000);
          if (kind === "user") body.active = body.active === "true";
          void save(body);
        }}
      >
        {kind === "race" && (
          <>
            <Field label="Nombre de la competencia">
              <input
                name="name"
                defaultValue={edit?.name || ""}
                required
                maxLength={120}
                placeholder="Ej. Carrera Nocturna"
                autoFocus
              />
            </Field>
            <Field label="Descripción">
              <textarea
                name="description"
                defaultValue={
                  edit && "description" in edit ? edit.description : ""
                }
                maxLength={1000}
              />
            </Field>
            <div className="form-columns">
              <Field label="Fecha">
                <input
                  name="date"
                  type="date"
                  defaultValue={
                    edit && "date" in edit
                      ? edit.date
                      : new Date().toLocaleDateString("en-CA")
                  }
                  required
                />
              </Field>
              <Field label="Modalidad">
                <select
                  name="mode"
                  value={mode}
                  onChange={(e) => setMode(e.target.value)}
                >
                  {Object.entries(modes).map(([key, label]) => (
                    <option value={key} key={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              {mode !== "resistencia" && (
                <Field label="Vueltas objetivo">
                  <input
                    name="target"
                    type="number"
                    min={1}
                    max={10000}
                    defaultValue={edit && "target" in edit ? edit.target : 5}
                    required
                  />
                </Field>
              )}
              {mode === "resistencia" && (
                <Field label="Duración en minutos">
                  <input
                    name="duration"
                    type="number"
                    min={1}
                    max={1440}
                    defaultValue={
                      edit && "duration" in edit ? edit.duration : 30
                    }
                    required
                  />
                </Field>
              )}
              <Field label="Distancia por vuelta (metros)">
                <input
                  name="lapDistance"
                  type="number"
                  min={1}
                  max={100000}
                  defaultValue={
                    edit && "lapDistance" in edit
                      ? (edit.lapDistance ?? 400)
                      : 400
                  }
                  required
                />
              </Field>
            </div>
            <div className="form-note">
              {mode === "vueltas"
                ? "Gana quien complete las vueltas objetivo en el menor tiempo ajustado."
                : mode === "contrarreloj"
                  ? "Cada corredor completa el mismo objetivo. Gana el menor tiempo ajustado."
                  : mode === "resistencia"
                    ? "Gana quien complete más vueltas válidas dentro del periodo."
                    : "Gana el último participante habilitado; el operador registra las eliminaciones."}{" "}
              Desempate por tiempo ajustado y mejor vuelta. Sanciones de tiempo
              sumadas al total.
            </div>
          </>
        )}
        {kind === "runner" && (
          <>
            <Field label="Nombre completo">
              <input
                name="name"
                defaultValue={edit?.name || ""}
                maxLength={120}
                required
                autoFocus
                placeholder="Ej. Ana Martínez"
              />
            </Field>
            <Field label="Equipo o club (opcional)">
              <input
                name="team"
                defaultValue={edit && "team" in edit ? edit.team : ""}
                maxLength={120}
                placeholder="Independiente"
              />
            </Field>
            <Field label="Categoría">
              <input
                name="category"
                defaultValue={
                  edit && "category" in edit ? edit.category : "Libre"
                }
                required
                maxLength={60}
                placeholder="Ej. Libre, juvenil, máster"
              />
            </Field>
          </>
        )}
        {kind === "participant" && (
          <>
            <Field label="Corredor">
              <select name="runnerId" required defaultValue="">
                <option value="" disabled>
                  Selecciona un corredor
                </option>
                {runners
                  .filter(
                    (d) =>
                      d.active &&
                      !race?.participants.some((p) => p.runnerId === d.id),
                  )
                  .map((d) => (
                    <option value={d.id} key={d.id}>
                      {d.name} · {d.category}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Dorsal">
              <input
                type="number"
                name="number"
                required
                min={0}
                max={999}
                placeholder="07"
              />
            </Field>
            <p className="help-text">
              Registra primero a los corredores en el catálogo. No se permiten
              inscripciones duplicadas.
            </p>
          </>
        )}
        {kind === "penalty" && (
          <>
            <Field label="Participante">
              <select name="participantId" required>
                {race?.leaderboard.map((p) => (
                  <option value={p.id} key={p.id}>
                    #{p.number} {p.runner.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Tipo de incidencia">
              <select name="type">
                <option value="tiempo">Penalización de tiempo</option>
                <option value="descalificado">Descalificación</option>
                <option value="eliminado">Eliminación</option>
                <option value="retirado">Retiro</option>
              </select>
            </Field>
            <Field label="Segundos (solo para penalización de tiempo)">
              <input
                type="number"
                name="value"
                min={0.001}
                max={86400}
                step={0.001}
                defaultValue={5}
                required
              />
            </Field>
            <Field label="Motivo">
              <textarea
                name="reason"
                required
                maxLength={1000}
                placeholder="Describe la incidencia y la regla aplicada"
              />
            </Field>
          </>
        )}
        {kind === "user" && (
          <>
            <Field label="Nombre">
              <input
                name="name"
                required
                defaultValue={edit?.name || ""}
                maxLength={120}
              />
            </Field>
            <Field label="Correo">
              <input
                name="email"
                type="email"
                required
                defaultValue={edit && "email" in edit ? edit.email : ""}
              />
            </Field>
            <Field label={edit ? "Nueva contraseña (opcional)" : "Contraseña"}>
              <input
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={10}
                maxLength={72}
                required={!edit}
              />
            </Field>
            <Field label="Rol">
              <select
                name="role"
                defaultValue={edit && "role" in edit ? edit.role : "operador"}
              >
                <option value="operador">Operador</option>
                <option value="administrador">Administrador</option>
              </select>
            </Field>
            <Field label="Estado">
              <select
                name="active"
                defaultValue={
                  edit && "active" in edit ? String(edit.active) : "true"
                }
              >
                <option value="true">Activo</option>
                <option value="false">Desactivado</option>
              </select>
            </Field>
          </>
        )}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={close}>
            Cancelar
          </button>
          <button className="btn primary" disabled={busy}>
            {busy ? "Guardando…" : "Guardar"}
          </button>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
