'use strict';
const child = require('child_process');
const fs = require('fs');
const crypto = require('crypto');
const target = process.argv[2];
function start() { try { return child.execFileSync('powershell.exe',['-NoProfile','-Command',`(Get-Process -Id ${process.pid}).StartTime.ToUniversalTime().ToString('o')`],{windowsHide:true,encoding:'utf8'}).trim(); } catch { return null; } }
fs.writeFileSync(target, JSON.stringify({ owner:'NATIVE', scope:'PRIVATE_TEST', pid:process.pid, process_started_at:start(), owner_id:crypto.randomUUID(), acquired_at:new Date().toISOString() }));
setInterval(() => {}, 1000);
