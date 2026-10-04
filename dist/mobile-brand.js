(() => {
  const scene=document.querySelector('.scene'),brand=scene.querySelector('.arcade-header .logo'),header=scene.querySelector('.arcade-header');
  const mobile=matchMedia('(max-width:900px), (max-device-width:900px) and (pointer:coarse)'),reduced=matchMedia('(prefers-reduced-motion:reduce)');
  let pending=0;
  function paint(){
    pending=0;
    if(!mobile.matches||reduced.matches||scene.classList.contains('motion-paused')){brand.style.removeProperty('--brand-drift');return;}
    const box=header.getBoundingClientRect();
    const drift=Math.max(-5,Math.min(7,(innerHeight*.6-box.top)*.025));
    brand.style.setProperty('--brand-drift',drift.toFixed(2)+'px');
  }
  function schedule(){if(!pending)pending=requestAnimationFrame(paint);}
  addEventListener('scroll',schedule,{passive:true});addEventListener('resize',schedule);
  mobile.addEventListener('change',schedule);reduced.addEventListener('change',schedule);
  new MutationObserver(schedule).observe(scene,{attributes:true,attributeFilter:['class']});schedule();
})();
