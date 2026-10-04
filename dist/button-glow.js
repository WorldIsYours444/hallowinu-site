(() => {
 const timers=new WeakMap();
 function flash(event){
  const control=event.target.closest('button:not(:disabled),a[href]');
  if(!control)return;
  clearTimeout(timers.get(control));control.classList.add('is-pressed');
  timers.set(control,setTimeout(()=>control.classList.remove('is-pressed'),450));
 }
 document.addEventListener('pointerdown',flash,{passive:true});
 document.addEventListener('click',flash);
 document.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' ')flash(event)});
})();
