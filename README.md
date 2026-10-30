# Carrera de la Muerte

Aplicación de administración de carreras con React, TypeScript, Tailwind, Vite, Express y SQLite. La arquitectura, los casos de uso, las tablas y el contrato REST están en [DOCUMENTACION.md](DOCUMENTACION.md).

## Requisitos
Node.js 20.19+ (o 22.12+) y npm. `better-sqlite3` usa binarios nativos; si tu plataforma no tiene uno precompilado necesitarás Python 3 y herramientas de compilación (en macOS, Xcode Command Line Tools).

## Instalación y ejecución local
1. Abre una terminal en el proyecto:
   ```sh
   cd /Users/yait/Desktop/carrera
   npm install
   ```
   Se instalan ambos proyectos mediante npm workspaces.
2. Inicia el backend en esa terminal:
   ```sh
   npm run dev:backend
   ```
   API: `http://localhost:3001/api`. Las tablas y `backend/data/carrera.sqlite` se crean automáticamente.
3. Abre otra terminal:
   ```sh
   cd /Users/yait/Desktop/carrera
   npm run dev:frontend
   ```
4. Abre http://localhost:5173. Vite reenvía `/api` al backend. Mantén ambos procesos activos. Usa Ctrl+C para detenerlos.

Si el puerto 5173 está ocupado, usa `npm run dev:frontend -- --port 5174` y abre http://localhost:5174. El proxy de Vite permite comunicar con la API desde ese puerto sin cambiar CORS. Si accedes directamente a la API desde otro origen, configura FRONTEND_ORIGIN.

También puedes ejecutar desde cada carpeta: `cd backend && npm run dev` y `cd frontend && npm run dev`. Instala primero desde la raíz.

## Pruebas automáticas y compilación
Desde la raíz:
```sh
npm test
npm run build
```
Las pruebas usan SQLite temporal y en memoria; no modifican la base de uso real. Verifican CRUD, validación, números duplicados, tiempos calculados por servidor, pausa, reinicio, cascada, CORS y persistencia al reabrir el archivo. La compilación verifica TypeScript y genera `frontend/dist`.

Para revisar la compilación local sin desplegarla, mantén backend activo y ejecuta:
```sh
npm run preview -w frontend -- --host 127.0.0.1
```
El proxy `/api` configurado en Vite también funciona en preview. Abre la URL que indique la terminal (normalmente http://localhost:4173). Para producción, sirve `frontend/dist` mediante un servidor web que reenvíe `/api` al backend. `npm start -w backend` ejecuta la API sin modo watch.

## Comprobación manual
1. Registra cuatro pilotos con números diferentes. Intenta repetir un número y verifica el error.
2. Edita nombre, alias o vehículo y guarda; recarga para comprobar persistencia.
3. Asigna un piloto a cada estado. Verifica el orden activo → penalizado → ganador → eliminado; cambia un estado y observa el reordenamiento.
4. Inicia el reloj y pulsa **Registrar Vuelta** en dos tarjetas. Deben aparecer marcas acumuladas de milisegundos con fecha.
5. Pausa: el tiempo debe permanecer fijo. Reanuda y vuelve a registrar una vuelta.
6. Reinicia el backend y recarga la página. Pilotos e historial permanecen; el reloj que estaba corriendo continúa contando el tiempo transcurrido.
7. Reinicia el reloj y confirma: queda a cero y pausado, conservando vueltas previas.
8. Borra una vuelta con ×. Elimina un piloto con confirmación y comprueba que se actualizan los contadores y desaparece su historial.
9. Detén backend: el cliente mostrará un error de conexión. Inícialo y pulsa **Reintentar conexión**.

Las vueltas son marcas acumuladas del reloj global, no duraciones entre vueltas. El POST captura el instante de procesamiento en el servidor; la visualización del navegador es una proyección orientativa entre sincronizaciones. No es una medición física del instante del clic: la red puede introducir latencia.

## API rápida
```sh
curl http://localhost:3001/api/health
curl -X POST http://localhost:3001/api/pilotos -H 'Content-Type: application/json' -d '{"nombre":"Ana","alias":"Neon","vehiculo":"Interceptor","numero":7}'
curl -X POST http://localhost:3001/api/cronometro
curl -X POST http://localhost:3001/api/pilotos/1/vueltas
curl http://localhost:3001/api/pilotos/1/vueltas
curl -X PUT http://localhost:3001/api/cronometro -H 'Content-Type: application/json' -d '{"accion":"pausar"}'
```
El ejemplo de vueltas presupone que el piloto creado tiene ID 1; sustituye por el ID real devuelto.

## Variables opcionales del backend
- `PORT`: 3001 por defecto.
- `DB_PATH`: ruta al archivo SQLite; por defecto backend/data/carrera.sqlite (independiente de la carpeta desde donde se ejecute).
- `FRONTEND_ORIGIN`: origen CORS autorizado; por defecto http://localhost:5173.

Se leen del entorno; no es necesario crear `.env`. Si cambias el puerto de la API, actualiza también el destino del proxy en frontend/vite.config.ts. El frontend usa rutas relativas `/api`.

## Estructura
```text
DOCUMENTACION.md
README.md
package.json                 # workspaces y comandos comunes
package-lock.json
index.html                   # original histórico, no es el frontend nuevo
backend/
  package.json
  src/
    db.js                    # conexión, tablas e índices
    app.js                   # API, validación y reloj
    server.js                # arranque y cierre
  test/api.test.js
  data/carrera.sqlite        # generado al arrancar, no versionado
frontend/
  package.json
  index.html
  vite.config.ts
  tsconfig.json
  tailwind.config.js
  postcss.config.js
  src/
    main.tsx
    App.tsx
    api.ts
    types.ts
    Clock.tsx
    PilotForm.tsx
    PilotCard.tsx
    styles.css
```

El original se conserva solo para referencia. No existe una migración automática de sus datos LocalStorage. El sistema nuevo guarda todo en SQLite. Las fuentes de Google requieren Internet; hay fuentes de respaldo. Esta versión está pensada para administración local de confianza y no incluye inicio de sesión.
