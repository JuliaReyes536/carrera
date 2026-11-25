import { createDatabase } from "./db.js";
import { createApp } from "./app.js";
const db = createDatabase();
const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || "127.0.0.1";
const server = createApp(db).listen(port, host, () =>
  console.log(`Race Control disponible en http://${host}:${port}`),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () =>
    server.close(() => {
      db.close();
      process.exit(0);
    }),
  );
