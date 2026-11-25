import express from "express";
import cors from "cors";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { installV2 } from "./v2.js";

export function createApp(db) {
  const app = express();
  app.disable("x-powered-by");
  app.use(
    cors({ origin: process.env.FRONTEND_ORIGIN || "http://localhost:5173" }),
  );
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use(express.json({ limit: "20mb", strict: true }));
  installV2(app, db);
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "Ruta no encontrada." }),
  );
  const frontend = fileURLToPath(
    new URL("../../frontend/dist/", import.meta.url),
  );
  if (existsSync(frontend)) app.use(express.static(frontend));
  app.use((_req, res) =>
    res
      .status(404)
      .json({
        error: "Compila la interfaz con npm run build o inicia npm run dev.",
      }),
  );
  app.use((err, _req, res, _next) => {
    const duplicate = err.code === "SQLITE_CONSTRAINT_UNIQUE";
    const constraint = String(err.code || "").startsWith("SQLITE_CONSTRAINT");
    const status = duplicate ? 409 : constraint ? 400 : err.status || 500;
    if (status >= 500) console.error(err);
    res
      .status(status)
      .json({
        error: duplicate
          ? "Ya existe un registro con ese identificador."
          : constraint
            ? "La operación viola una regla de integridad de los datos."
            : status >= 500
              ? "Error interno del servidor."
              : err.message,
      });
  });
  return app;
}
