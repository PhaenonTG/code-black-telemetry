/* Adapter: original OPS visuals, directory-only lifecycle; no BLE/model/auth calls. */
'use strict';
// Keep the function local: a classic-script global declaration cannot be deleted.
(()=>{
function replaySplash(){
  if(document.querySelector('.cb-splash'))return;
  const script=document.querySelector('script[src$="splash.js"]');
  const logo=new URL('shield.png',script.src).href;
  const overlay=document.createElement('div');overlay.className='cb-splash';overlay.setAttribute('role','dialog');overlay.setAttribute('aria-label','Code Black directory opening');overlay.tabIndex=0;
  overlay.innerHTML='<div class="cb-splash__ring" aria-hidden="true"></div><img alt="" class="cb-splash__logo"><strong class="cb-splash__title">CODE BLACK <em>OPS</em></strong><span class="cb-splash__tagline">Situational Awareness</span><div class="cb-splash__status"><span>OPENING SITE DIRECTORY</span><div class="cb-splash__bar" aria-hidden="true"><em></em></div></div><div class="cb-splash__hint">Tap or press Enter to enter</div>';
  overlay.querySelector('img').src=logo;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  let done=false;const finish=()=>{if(done)return;done=true;overlay.classList.add('cb-splash--exiting');setTimeout(()=>overlay.remove(),reduced?0:380);};
  overlay.addEventListener('click',finish);overlay.addEventListener('keydown',e=>{if(['Enter','Escape',' '].includes(e.key)){e.preventDefault();finish();}});
  document.body.append(overlay);setTimeout(finish,reduced?500:1800);
}
window.replaySplash=replaySplash;
try{if(sessionStorage.getItem('codeblack.directorySplash')!=='1'){sessionStorage.setItem('codeblack.directorySplash','1');replaySplash();}}catch{replaySplash();}
})();
