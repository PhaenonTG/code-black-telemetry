'use strict';
// Fixed, owner-approved cutover. No public output command or OBS restart exists here.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const NODE='C:/CodeBlack/tools/node/node.exe';
const PACKAGE='C:/CodeBlack/Worktrees/private-producer-backend-release-20261015/workers/chase-gateway';
const DATA='C:/CodeBlack/Projects/ObsProducerBridge/runtime';
const NATIVE='C:/CodeBlack/streaming/native-broadcaster';
const RELEASE='/srv/codeblack/releases/private-producer/primary-20261015-r2';
const BACKUP='/srv/codeblack/backups/private-producer-primary-20261015';
const run=(exe,args,options={})=>cp.execFileSync(exe,args,{encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe'],timeout:30000,...options});
const ssh=(command,input)=>run('ssh',['-o','BatchMode=yes','-o','ConnectTimeout=8','codeblack-core',command],{input});
function off(){const s=JSON.parse(fs.readFileSync(path.join(DATA,'public-output-status.json'),'utf8'));const age=Date.now()-s.heartbeatAtUnixMs;if(age< -2000||age>3000||s.facebookState!=='OFF'||s.youtubeState!=='OFF')throw Error('OUTPUTS_NOT_FRESHLY_OFF');}
function credential(name){return run('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','RemoteSigned','-File',NATIVE+'/read-facebook-key.ps1','-Path',NATIVE+'/runtime/'+name],{stdio:['ignore','pipe','ignore']}).trim();}
function privateToken(){const env=ssh('sudo -n cat /srv/codeblack/config/private-producer/runtime.env');const value=/^OPS_PRIVATE_PRODUCER_TOKEN=([-_A-Za-z0-9]{40,200})\s*$/m.exec(env)?.[1];if(!value)throw Error('PRIVATE_CREDENTIAL_INVALID');return value;}
function allowlist(){
 const file='C:/Users/glenn/.codex/sessions/2026/10/13/rollout-2026-10-13T11-30-44-01a1361a-2025-70f2-ba1a-a5548b5599d8.jsonl';
 const rows=run('rg',['--fixed-strings','PRODUCER_OPERATOR_IDS',file],{maxBuffer:16*1024*1024}).trim().split('\n').map(line=>JSON.parse(line));
 const event=rows.find(row=>row.timestamp==='2026-10-13T17:37:37.127Z'&&row.payload?.type==='custom_tool_call');
 const ids=/\$allow\s*=\s*'([a-f0-9,-]+)'/i.exec(event?.payload?.input??'')?.[1]?.split(',');
 const result=rows.find(row=>row.payload?.type==='custom_tool_call_output'&&row.payload.call_id===event?.payload.call_id);
 const uploaded=result?.payload?.output?.some(block=>{try{const output=JSON.parse(block.text);return output.exit_code===0&&output.output.includes('Success! Uploaded secret PRODUCER_OPERATOR_IDS');}catch{return false;}});
 if(!uploaded||ids?.length!==4||new Set(ids).size!==4||!ids.every(id=>/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)))throw Error('APPROVED_ALLOWLIST_AUDIT_INVALID');
 return ids.join(',');
}
async function noPublicCommands(){
 const response=await fetch('https://ops.codeblackwx.com/api/producer/v1/workstation/commands',{headers:{Authorization:'Bearer '+credential('producer-bridge.credentials.json')},redirect:'error',signal:AbortSignal.timeout(8000)});
 if(!response.ok)throw Error('PUBLIC_HANDOFF_CHECK_FAILED');const body=await response.json();if(!Array.isArray(body.commands)||body.commands.length)throw Error('PUBLIC_COMMANDS_PENDING');
}
async function stage(){
 off();await noPublicCommands();const ids=allowlist(),token=privateToken();
 if(run('git',['-C',path.resolve(PACKAGE,'../..'),'status','--porcelain']).trim())throw Error('BACKEND_RELEASE_NOT_CLEAN');
 ssh(`test ! -e '${RELEASE}' && test ! -e '${BACKUP}' && test ! -e /srv/codeblack/config/private-producer/control-primary.env && test ! -e /etc/systemd/system/codeblack-private-ops.service.d/zzzz-private-producer-primary.conf && test ! -e /etc/systemd/system/codeblack-private-producer-shadow.service.d/zzzz-private-producer-primary.conf`);
 run(NODE,['scripts/build-private-producer.mjs'],{cwd:PACKAGE});
 const archive='C:/CodeBlack/backups/private-producer-primary-74f6c69-20261015.tgz';
 if(fs.existsSync(archive))throw Error('ARCHIVE_ALREADY_EXISTS');
 run('tar',['-czf',archive,'-C',PACKAGE,'dist-private','scripts/private-producer-shadow.mjs']);
 run('scp',[archive,'codeblack-core:/tmp/private-producer-primary-74f6c69-20261015.tgz']);
 ssh(`sudo -n install -d -m 0700 '${BACKUP}' && sudo -n cp -p /etc/systemd/system/codeblack-private-producer-shadow.service '${BACKUP}/producer.unit' && sudo -n cp -p /etc/systemd/system/codeblack-private-ops.service.d/zzzz-landscape.conf '${BACKUP}/ops.override' && sudo -n install -d -m 0755 '${RELEASE}' && sudo -n tar -xzf /tmp/private-producer-primary-74f6c69-20261015.tgz -C '${RELEASE}' && sudo -n chown -R root:root '${RELEASE}' && sudo -n chmod -R a+rX '${RELEASE}'`);
 ssh('sudo -n install -m 0600 /dev/stdin /srv/codeblack/config/private-producer/control-primary.env',`OPS_PRIVATE_PRODUCER_CONTROLS_ENABLED=true\nOPS_PRIVATE_PRODUCER_OPERATOR_IDS=${ids}\n`);
 const privateFile=NATIVE+'/runtime/private-producer.credentials.json';
 if(fs.existsSync(privateFile)){if(credential('private-producer.credentials.json')!==token)throw Error('EXISTING_PRIVATE_CREDENTIAL_MISMATCH');}
 else run('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','RemoteSigned','-File',path.join(__dirname,'install-private-producer-credential.ps1')],{input:token,stdio:['pipe','pipe','ignore']});
 if(credential('private-producer.credentials.json')!==token)throw Error('DPAPI_ROUNDTRIP_FAILED');
 console.log(JSON.stringify({stage:'ready',allowlistedAccounts:4,credential:'DPAPI_PROTECTED',servicesRestarted:false}));
}
async function activateCore(){
 off();
 ssh(`test -f '${RELEASE}/dist-private/producer-bridge.mjs' && test -f '${BACKUP}/ops.override' && grep -Fxq Environment=OPS_PRIVATE_DIST=/srv/codeblack/releases/private-ops/producer-telemetry-20261015-r18/dist /etc/systemd/system/codeblack-private-ops.service.d/zzzz-landscape.conf && sudo -n install -d -m 0755 /etc/systemd/system/codeblack-private-producer-shadow.service.d`);
 ssh('sudo -n install -m 0644 /dev/stdin /etc/systemd/system/codeblack-private-producer-shadow.service.d/zzzz-private-producer-primary.conf',`[Unit]\nConditionPathExists=\nConditionPathExists=${RELEASE}/dist-private/producer-bridge.mjs\n[Service]\nWorkingDirectory=${RELEASE}\nExecStart=\nExecStart=/usr/bin/node ${RELEASE}/scripts/private-producer-shadow.mjs\nEnvironmentFile=/srv/codeblack/config/private-producer/control-primary.env\n`);
 ssh('sudo -n install -m 0644 /dev/stdin /etc/systemd/system/codeblack-private-ops.service.d/zzzz-private-producer-primary.conf','[Service]\nEnvironmentFile=/srv/codeblack/config/private-producer/control-primary.env\n');
 ssh('sudo -n systemctl daemon-reload && sudo -n systemctl restart codeblack-private-producer-shadow.service && systemctl is-active --quiet codeblack-private-producer-shadow.service && sudo -n systemctl restart codeblack-private-ops.service && systemctl is-active --quiet codeblack-private-ops.service');
 const response=await fetch('https://ops-private.codeblackwx.com/api/producer/v1/workstation/commands',{headers:{Authorization:'Bearer '+credential('private-producer.credentials.json')},redirect:'error',signal:AbortSignal.timeout(8000)});
 if(response.status!==200||(await response.json()).commands?.length!==0)throw Error('PRIVATE_BACKEND_HANDOFF_NOT_READY');
 off();console.log(JSON.stringify({core:'ready',workstationRoute:200,publicOutputs:'OFF'}));
}
async function activateWorkstation(){
 off();await noPublicCommands();
 console.log(run('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','RemoteSigned','-File',path.join(__dirname,'switch-private-producer-workstation.ps1')]).trim());
}
const phases={stage,core:activateCore,workstation:activateWorkstation};
if(!phases[process.argv[2]])throw Error('FIXED_PHASE_REQUIRED');
phases[process.argv[2]]().catch(error=>{console.error(/^[A-Z0-9_]+$/.test(error.message)?error.message:'PRIVATE_CUTOVER_FAILED_INSPECT_ROLLBACK');process.exitCode=1;});
