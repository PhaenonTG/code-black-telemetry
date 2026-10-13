'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { validateOverlayPatch, programCanvas, compositionId, overlayFilter } = require('../program-composition');
const { hlsArgs } = require('../milestone2');
const { FacebookOutput } = require('../facebook-output');
const profile = { width: 1920, height: 1080, fps: 30 };
function fixture() { return { bug:{enabled:true,text:'CODE BLACK'},live:{enabled:true,text:'LIVE'},lowerThird:{enabled:true,text:"Nick's chase: 100% [LIVE], \\ Arkansas"},sourceName:{enabled:true},callsign:'NICK',vehicle:'TESSA' }; }
test('composition payload permits only implemented settings and bounded printable text', () => {
  assert.ok(validateOverlayPatch({bug:{enabled:true,text:'Code Black'},lowerThird:{enabled:false,text:'100%: live'},vehicle:'TESSA'}));
  for (const input of [{},[],{clock:{enabled:true}},{bug:{enabled:'true'}},{vehicle:'x'.repeat(25)},{lowerThird:{text:'bad\nline'}},{sourceName:{file:'secret'}},{live:{text:'fake'}}]) assert.throws(()=>validateOverlayPatch(input));
});
test('preview and Facebook share full-resolution composition before monitor downscale', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'codeblack-composition-'));
  const overlays=fixture(),filter=overlayFilter(root,overlays,'SOURCE_LIVE');
  assert.equal(filter.includes(overlays.lowerThird.text),false);
  assert.match(filter,/textfile=.*expansion=none/);
  const full=programCanvas(profile,filter);
  const args=hlsArgs('ffmpeg','input.mp4',path.join(root,'hls'),true,filter,undefined,profile);
  assert.equal(args[args.indexOf('-vf')+1],full+',scale=640:360,setsar=1');
  const output=new FacebookOutput({config:{source:profile},overlayFilter:()=>filter,encoderArgs:()=>[]},root,{load:()=>''});
  const fb=output.args('local-test-only');assert.equal(fb[fb.indexOf('-vf')+1],full);
  assert.notEqual(compositionId(overlays,'SOURCE_LIVE',profile),compositionId({...overlays,callsign:'NICK 2'},'SOURCE_LIVE',profile));
  assert.notEqual(compositionId(overlays,'SOURCE_LIVE',profile),compositionId(overlays,'SOURCE_LOST',profile));
});
test('real FFmpeg renders punctuation literally at 1080p and downsamples the same composition', {skip:!process.env.CODEBLACK_TEST_FFMPEG,timeout:20000},()=>{
  const ffmpeg=process.env.CODEBLACK_TEST_FFMPEG,root=fs.mkdtempSync(path.join(os.tmpdir(),'codeblack-overlay-render-'));
  const filter=programCanvas(profile,overlayFilter(root,fixture(),'SOURCE_LIVE'));
  for(const [name,vf] of [['program',filter],['monitor',filter+',scale=640:360,setsar=1']]){
    cp.execFileSync(ffmpeg,['-v','error','-y','-f','lavfi','-i','color=c=0x234567:s=1920x1080:r=30','-vf',vf,'-frames:v','1',path.join(root,name+'.png')],{windowsHide:true,timeout:8000});
  }
  const probe=path.join(path.dirname(ffmpeg),'ffprobe.exe');
  const size=name=>JSON.parse(cp.execFileSync(probe,['-v','error','-show_entries','stream=width,height','-of','json',path.join(root,name+'.png')],{windowsHide:true,encoding:'utf8'})).streams[0];
  assert.deepEqual(size('program'),{width:1920,height:1080});assert.deepEqual(size('monitor'),{width:640,height:360});
  const bytes=cp.execFileSync(ffmpeg,['-v','error','-i',path.join(root,'monitor.png'),'-vf','crop=80:20:0:0','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{windowsHide:true});
  assert.ok(bytes.some((value,index)=>index%3===0&&value>220),'Brand overlay must survive downscale');
  console.log('Local composition render evidence: '+root);
});
