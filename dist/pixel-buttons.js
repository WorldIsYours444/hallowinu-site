(() => {
  const scene=document.querySelector('.scene');
  const buttons=[...scene.querySelectorAll('.hotspot:not(.logo):not(.contract)')];
  const measure=document.createElement('canvas').getContext('2d');
  function fit(){
    for(const button of buttons){
      const style=getComputedStyle(button),icons=[...button.querySelectorAll('svg')].filter(icon=>getComputedStyle(icon).display!=='none');
      const padding=parseFloat(style.paddingLeft)+parseFloat(style.paddingRight);
      const mobile=matchMedia('(max-width:900px), (max-device-width:900px) and (pointer:coarse)').matches;
      const gap=parseFloat(style.columnGap)||0;
      const available=button.clientWidth-padding-icons.reduce((sum,icon)=>sum+icon.getBoundingClientRect().width,0)-gap*icons.length-4;
      const label=[...button.querySelectorAll('span')].find(span=>getComputedStyle(span).display!=='none');
      const text=label?.textContent||button.textContent.trim();
      let size=Math.max(5,Math.floor((button.clientHeight-parseFloat(style.paddingBottom))*.36));
      if(mobile){const nav=button.matches('.about,.token,.community,.roadmap');size=nav?11:14;}
      measure.font=size+'px Arcade';
      while(size>5&&measure.measureText(text).width>available){size--;measure.font=size+'px Arcade'}
      button.style.fontSize=size+'px';
    }
  }
  new ResizeObserver(fit).observe(scene);
  document.fonts.ready.then(fit);fit();
})();
