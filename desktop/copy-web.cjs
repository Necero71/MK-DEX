// Copy the Vite build into the desktop app.
const fs = require("node:fs");
const path = require("node:path");
const out = path.join(__dirname, "web");
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(path.join(__dirname, "..", "dist"), out, { recursive: true });
