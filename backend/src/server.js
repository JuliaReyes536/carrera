import { createDatabase } from './db.js';
import { createApp } from './app.js';
const db = createDatabase();
const port = Number(process.env.PORT || 3001);
const server = createApp(db).listen(port, () => console.log(`API disponible en http://localhost:${port}/api`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { db.close(); process.exit(0); }));
