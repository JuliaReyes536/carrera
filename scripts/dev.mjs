import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const demo = process.argv.includes("--demo");
const children = [
  spawn(
    process.execPath,
    demo ? ["backend/scripts/demo.mjs"] : ["--watch", "backend/src/server.js"],
    { cwd: root, stdio: "inherit" },
  ),
  spawn(
    process.execPath,
    [
      "../node_modules/vite/bin/vite.js",
      "--host",
      "127.0.0.1",
      ...(demo ? ["--port", "5174"] : []),
    ],
    {
      cwd: fileURLToPath(new URL("../frontend/", import.meta.url)),
      stdio: "inherit",
      env: {
        ...process.env,
        ...(demo ? { API_PROXY: "http://127.0.0.1:3002" } : {}),
      },
    },
  ),
];
let ending = false;
function stop(code = 0) {
  if (ending) return;
  ending = true;
  for (const child of children) child.kill();
  process.exitCode = code;
}
for (const child of children) {
  child.on("error", (err) => {
    console.error(err.message);
    stop(1);
  });
  child.on("exit", (code) => stop(code || 0));
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
