# Arquitectura y API de carreras a pie

La aplicación organiza competencias entre personas. El catálogo principal es el de corredores; cada inscripción relaciona una persona, una competencia y un dorsal. Equipo/club y categoría describen al corredor y no son requisitos de equipamiento.

## Capas

React y TypeScript construyen la interfaz. `App.tsx` coordina las pantallas; `Forms.tsx` contiene los formularios y `Leaderboard.tsx` presenta corredores, vueltas, distancia, ritmo y tiempos. `api.ts` centraliza autenticación y descargas. Vite y Tailwind permiten desarrollo y compilación.

Express configura HTTP en `app.js`. `v2.js` valida permisos, datos y estados, calcula la clasificación y ofrece exportaciones y SSE. `repository.js` realiza consultas parametrizadas y transacciones. `db.js` abre SQLite con claves foráneas y WAL. `running-migration.js` adapta datos de versiones anteriores sin eliminar su fuente.

## Modelo de datos

| Tabla | Responsabilidad |
| --- | --- |
| tb_roles | Administrador y operador |
| tb_usuarios | Nombre, correo único, rol, hash y estado |
| tb_sesiones | Hash de token, usuario y expiración |
| tb_corredores | Nombre completo, equipo/club, categoría y estado |
| tb_competencias | Fecha, modalidad, reglas, distancia de vuelta y revisiones |
| tb_inscripciones | Competencia, corredor y dorsal; corredor/dorsal únicos por competencia |
| tb_intentos_corredores | Intentos de cronometraje separados |
| tb_cronometros_corredores | Un cronómetro por intento |
| tb_vueltas_corredores | Marcas, parciales, validez e identificador de solicitud |
| tb_sanciones_corredores | Tipo, valor, motivo y responsable |
| tb_clasificaciones_corredores | Resultados oficiales por inscripción e intento |
| tb_auditoria | Operaciones críticas y cambios |
| tb_configuracion | Organización, sede y temporada |

Las columnas relacionales protegen identidades, relaciones, dorsales y marcas; los atributos y fotografías históricas se guardan en JSON validado. `v2_meta` registra migraciones y `v2_restore_safety` conserva copias previas a restauraciones. Las tablas antiguas pueden permanecer únicamente como evidencia; las instalaciones nuevas no las crean.

## Cronometraje y clasificación

El servidor conserva milisegundos acumulados y el último inicio. Pausar acumula el intervalo, reanudar registra un nuevo inicio y reiniciar abre otro intento. El estado temporal persiste después de reiniciar el servicio. Se necesita un reloj de sistema estable.

La primera vuelta se mide desde cero; las siguientes se calculan por diferencia con la marca válida anterior. Las correcciones deben mantener marcas crecientes. Anular una vuelta conserva la evidencia y recalcula los parciales válidos posteriores. Solicitudes repetidas con el mismo identificador no generan nuevas vueltas en ese intento.

`distancia_m = vueltas_válidas × distancia_por_vuelta_m`. `ritmo_ms_km = tiempo_ajustado_ms × 1000 / distancia_m`. No se muestra ritmo sin vueltas o sin una longitud de vuelta conocida. El indicador usa tiempo ajustado, incluyendo sanciones.

La clasificación general usa más vueltas, menor tiempo ajustado y mejor vuelta. Contrarreloj compara objetivos iguales. Eliminación requiere un único habilitado; resistencia requiere terminar el periodo. Los excluidos carecen de posición competitiva. Un empate pendiente se resuelve con autorización y motivo.

## API

Base `/api`. Los errores devuelven `{ "error": "mensaje" }`. Las operaciones protegidas requieren `Authorization: Bearer <token>`. Fechas ISO, tiempos en milisegundos y distancias en metros.

| Método | Ruta | Permiso |
| --- | --- | --- |
| GET | /health, /auth/status | Público |
| POST | /auth/setup | Solo antes de la primera cuenta |
| POST | /auth/login | Público, con límite de intentos |
| GET | /auth/me | Usuario |
| POST | /auth/logout, /auth/password | Usuario |
| GET, POST | /users | Administrador |
| PATCH | /users/:id | Administrador |
| GET, POST | /runners | Usuario |
| GET | /runners/:id | Usuario |
| PATCH | /runners/:id | Usuario; cambiar estado requiere administrador |
| DELETE | /runners/:id | Administrador; baja lógica |
| GET | /races, /races/:id | Público, sin evidencia administrativa |
| POST | /races | Administrador |
| PATCH | /races/:id | Administrador, antes del inicio |
| POST | /races/:id/participants | Administrador; `runnerId` y `number` (dorsal) |
| DELETE | /races/:id/participants/:pid | Administrador, antes del inicio; conserva inscripciones con evidencia anterior |
| POST | /races/:id/start, /pause, /resume, /finish | Usuario |
| POST | /races/:id/prepare, /cancel, /archive, /reset | Administrador |
| POST | /races/:id/tie-break, /reopen | Administrador con motivo |
| POST | /races/:id/laps | Usuario; `participantId` y `requestId` |
| PATCH | /races/:id/laps/:lapId | Administrador; `mark` o `valid:false`, con `reason` |
| POST | /races/:id/penalties | Usuario; tipo, valor, participante y motivo |
| GET | /races/:id/timer, /laps, /leaderboard, /results, /stats | Público |
| GET | /races/:id/export/csv, /export/pdf | Usuario |
| GET | /dashboard | Usuario |
| GET | /audit | Administrador |
| GET, PUT | /settings | Administrador |
| GET | /backup | Administrador |
| POST | /restore | Administrador; respaldo y motivo |
| GET | /events | Avisos SSE de cambios, sin datos privados |

Registro de corredor: `{ "name": "Ana Martínez", "team": "Club Amanecer", "category": "Libre" }`. Equipo y categoría predeterminados: Independiente y Libre. Configurar una competencia acepta `lapDistance`, metros por vuelta, con valor inicial de 400. Las inscripciones solo requieren corredor y dorsal.

## Persistencia y compatibilidad

La base real es `backend/data/carrera.sqlite`. Las migraciones copian personas y competencias a las nuevas relaciones, conservando marcas y fuentes antiguas. Las distancias desconocidas permanecen nulas; la app muestra un guion para distancia y ritmo en esos casos.

Los respaldos nuevos usan formato 3 y `sport: running`. La restauración admite conversión de formato 2, valida integridad, conserva una copia previa, cierra sesiones y deja pausadas las carreras que estaban corriendo. No incluye sesiones ni las tablas antiguas conservadas como evidencia.

## Validación y ejecución

`npm run dev` inicia interfaz/API; `npm run demo` utiliza SQLite en memoria y personas ficticias. `npm test` ejecuta integración sin tocar los datos reales. `npm run build` verifica TypeScript y crea `frontend/dist`; `npm start` sirve esa compilación y la API en 3001.

La captura manual y la latencia afectan la precisión física. HTTPS, disponibilidad, carga y recuperación operativa requieren validación y configuración del entorno de publicación.
