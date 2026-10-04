(() => {
 const config=window.HALLOWINU_LAUNCH;
 if(!config.contract){
  document.querySelector('[data-chart-scroll]').addEventListener('click',()=>document.querySelector('#live-chart').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth'}));
  return;
 }
 const copy=document.querySelector('.ca-copy'),feedback=document.querySelector('.ca-feedback');
 let reset;
 copy.addEventListener('click',async()=>{
  try {
   try {await navigator.clipboard.writeText(config.contract)} catch {
    const input=document.createElement('textarea');input.value=config.contract;input.style.cssText='position:fixed;left:0;top:0;opacity:0';document.body.append(input);input.select();input.setSelectionRange(0,input.value.length);const ok=document.execCommand('copy');input.remove();if(!ok)throw new Error('Copy unavailable');
   }
   copy.textContent='COPIED!';feedback.textContent='Contract address copied.';
  } catch {copy.textContent='RETRY';feedback.textContent='Copy unavailable. Select the full contract address to copy manually.'}
  clearTimeout(reset);reset=setTimeout(()=>{copy.textContent='COPY'},2000);
 });
 document.querySelector('[data-chart-scroll]').addEventListener('click',()=>document.querySelector('#live-chart').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth'}));
 // An empty or invalid URL leaves a clean state and creates no iframe.
 function showChart(value){
  const holder=document.querySelector('.chart-frame'),state=holder.querySelector('.chart-state');
  let url;try {url=new URL(value);if(url.protocol!=='https:'||url.hostname!=='dexscreener.com'||!/^\/solana\/[A-Za-z0-9]+\/?$/.test(url.pathname))return;}catch{return;}
  const frame=document.createElement('iframe');frame.title='HALLOWINU live DexScreener chart';frame.allow='clipboard-write';frame.referrerPolicy='strict-origin-when-cross-origin';frame.hidden=true;
  url.search='?embed=1&theme=dark&trades=0&info=0';frame.src=url.href;
  const timeout=setTimeout(()=>{state.textContent='CHART UNAVAILABLE — TRY AGAIN LATER';frame.remove()},20000);
  frame.addEventListener('load',()=>{clearTimeout(timeout);state.hidden=true;frame.hidden=false});
  frame.addEventListener('error',()=>{clearTimeout(timeout);state.textContent='CHART UNAVAILABLE — TRY AGAIN LATER';frame.remove()});holder.append(frame);
 }
 showChart(config.dexscreenerUrl);
})();
