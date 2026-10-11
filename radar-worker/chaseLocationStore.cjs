"use strict";
const fs = require("fs");
function load(path) { try { const data = JSON.parse(fs.readFileSync(path, "utf8")); return data && typeof data === "object" ? data : {}; } catch { return {}; } }
function save(path, value) { const temp = `${path}.tmp`; fs.writeFileSync(temp, JSON.stringify(value), { mode: 0o600 }); fs.renameSync(temp, path); }
module.exports = { load, save };
