(() => {
  const scene=document.querySelector('.scene'), photo=scene.querySelector('img');
  let image=photo;
  const coinFace=new Image();
  const coinReady=new Promise(resolve=>{coinFace.onload=()=>resolve(true);coinFace.onerror=()=>resolve(false);});
  coinFace.src='coin-mantle-face.png';
  // Insert only the inner relief. The original rim, hands and sparks stay intact.
  function paintCoin(target){
    if(!coinFace.naturalWidth)return;
    const x=1248*1280/1672,y=511*720/941,w=190*1280/1672,h=190*720/941;
    target.save();target.imageSmoothingEnabled=false;target.beginPath();target.ellipse(x+w/2,y+h/2,w/2,h/2,0,0,Math.PI*2);target.clip();target.drawImage(coinFace,x,y,w,h);target.restore();
  }
  const canvas=document.createElement('canvas');canvas.className='atmosphere';canvas.setAttribute('aria-hidden','true');canvas.width=1280;canvas.height=720;scene.querySelector('.scene-art').append(canvas);
  const ctx=canvas.getContext('2d',{alpha:false});ctx.imageSmoothingEnabled=false;
  const groundFog=document.createElement('div');groundFog.className='ground-fog';groundFog.setAttribute('aria-hidden','true');
  groundFog.innerHTML=`<svg width="0" height="0" style="position:absolute"><defs><filter id="fog-grain"><feTurbulence type="fractalNoise" baseFrequency=".008 .026" numOctaves="3" seed="23"/><feColorMatrix type="matrix" values="0 0 0 0 .88 0 0 0 0 .79 0 0 0 0 .69 1.6 0 0 0 -.55"/><feGaussianBlur stdDeviation="2"/></filter></defs></svg><div class="fog-stream fog-one"><svg width="100%" height="100%"><rect width="100%" height="100%" filter="url(#fog-grain)"/></svg></div><div class="fog-stream fog-two"><svg width="100%" height="100%"><rect width="100%" height="100%" filter="url(#fog-grain)"/></svg></div>`;
  scene.querySelector('.scene-art').append(groundFog);

  const reduce=matchMedia('(prefers-reduced-motion: reduce)');
  let paused=reduce.matches, raf=0,last=0;
  const toggle=document.createElement('button');toggle.className='motion-toggle';toggle.type='button';scene.append(toggle);
  function label(){toggle.textContent=paused?'Play atmosphere':'Pause atmosphere';toggle.setAttribute('aria-label',paused?'Play background animations':'Pause background animations');toggle.setAttribute('aria-pressed',String(!paused));scene.classList.toggle('motion-paused',paused);}
  label();toggle.onclick=()=>{paused=!paused;label();cancelAnimationFrame(raf);if(paused)still();else raf=requestAnimationFrame(frame)};
  reduce.addEventListener('change',e=>{paused=e.matches;label();cancelAnimationFrame(raf);if(paused)still();else raf=requestAnimationFrame(frame)});
  // Each layer is restrained so the dog, navigation and calls to action stay still.
  function trees(t){
    ctx.save();ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(560,0);ctx.lineTo(410,110);ctx.lineTo(190,205);ctx.lineTo(88,285);ctx.lineTo(62,465);ctx.lineTo(0,485);ctx.closePath();ctx.clip();
    for(let y=0;y<490;y+=5){const sway=Math.sin(t*.73+y*.006)*3.25*(1-y/510);ctx.drawImage(image,0,y,560,5,sway,y,560,5)}ctx.restore();
    ctx.save();ctx.beginPath();ctx.moveTo(1040,0);ctx.lineTo(1280,0);ctx.lineTo(1280,362);ctx.lineTo(1237,306);ctx.closePath();ctx.clip();
    for(let y=0;y<365;y+=5){const sway=Math.sin(t*.67+y*.011+.9)*3.5*(1-y/380);ctx.drawImage(image,1035,y,245,5,1035+sway,y,245,5)}ctx.restore();
  }
  const hash=n=>{const v=Math.sin(n*127.1+311.7)*43758.5453;return v-Math.floor(v)};
  function noise(t,seed){const n=Math.floor(t),f=t-n,u=f*f*(3-2*f);return hash(n+seed*91)*(1-u)+hash(n+1+seed*91)*u}
  function glow(x,y,r,t,seed,strength){
    const pulse=.12+.56*noise(t*(2.2+hash(seed)*2),seed)+.22*noise(t*(8+hash(seed+4)*9),seed+7);
    ctx.save();
    // Dim the existing flame as well as varying its surrounding warm light.
    ctx.globalCompositeOperation='multiply';let g=ctx.createRadialGradient(x,y,0,x,y,r*.8);g.addColorStop(0,`rgba(48,24,8,${(1-pulse)*.23})`);g.addColorStop(1,'rgba(255,255,255,0)');ctx.fillStyle=g;ctx.fillRect(x-r,y-r,r*2,r*2);
    ctx.globalCompositeOperation='screen';g=ctx.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,`rgba(255,174,46,${pulse*strength})`);g.addColorStop(.36,`rgba(255,100,8,${pulse*strength*.5})`);g.addColorStop(1,'rgba(255,80,0,0)');ctx.fillStyle=g;ctx.fillRect(x-r,y-r,r*2,r*2);ctx.restore();
  }
  // A rare visitor stays inside the lit panes; the window frames occlude it.
  const runnerSheet=new Image();runnerSheet.src='window-runner.png';
  const runnerFrames=[];
  runnerSheet.onload=()=>{
    const w=Math.floor(runnerSheet.naturalWidth/4),h=runnerSheet.naturalHeight;
    const scratch=document.createElement('canvas');scratch.width=w;scratch.height=h;
    const scan=scratch.getContext('2d',{willReadFrequently:true});
    for(let i=0;i<4;i++){
      scan.clearRect(0,0,w,h);scan.drawImage(runnerSheet,i*w,0,w,h,0,0,w,h);
      const pixels=scan.getImageData(0,0,w,h).data;
      let left=w,top=h,right=0,bottom=0;
      for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(pixels[(y*w+x)*4+3]>100){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y)}
      if(right>=left)runnerFrames.push({x:i*w+left,y:top,w:right-left+1,h:bottom-top+1});
    }
  };
  let visitorClock=0,visitorLast=0,nextVisit=8+Math.random()*6,visit=null;
  function windowVisitor(ms){
    if(visitorLast)visitorClock+=Math.min((ms-visitorLast)/1000,.1);
    visitorLast=ms;
    if(!runnerFrames.length)return;
    if(!visit&&visitorClock>=nextVisit)visit={start:visitorClock,direction:Math.random()<.5?1:-1};
    if(!visit)return;
    const age=visitorClock-visit.start,duration=3.6;
    if(age>duration){visit=null;nextVisit=visitorClock+35+Math.random()*40;return;}
    const u=age/duration,x=visit.direction===1?730+u*105:835-u*105;
    const sprite=runnerFrames[Math.floor(age*11)%runnerFrames.length];
    ctx.save();ctx.beginPath();
    // Individual panes leave the wooden crossbars in front of the silhouette.
    for(const [wx,wy,ww,wh] of [[745,325,4,6],[751,325,5,6],[745,333,4,7],[751,333,5,7],[745,342,4,8],[751,342,5,8],[812,328,4,5],[818,328,4,5],[812,335,4,6],[818,335,4,6],[812,343,4,8],[818,343,4,8]])ctx.rect(wx,wy,ww,wh);
    ctx.clip();ctx.globalAlpha=.91;
    ctx.translate(Math.round(x),352+(Math.floor(age*11)%2));ctx.scale(visit.direction,1);
    const height=27,width=height*sprite.w/sprite.h;
    ctx.drawImage(runnerSheet,sprite.x,sprite.y,sprite.w,sprite.h,-width/2,-height,width,height);
    ctx.restore();
  }
  const headline=document.querySelector('.headline');
  headline.setAttribute('aria-label','Spooky season. Belongs to the Inu.');
  let letterIndex=0;
  for(const line of document.querySelectorAll('.headline>span')){
    const text=line.textContent;line.textContent='';line.setAttribute('aria-hidden','true');
    for(const character of Array.from(text)){
      const letter=document.createElement('span');letter.className='title-letter';letter.textContent=character===' '?'\u00a0':character;
      letter.style.setProperty('--letter-delay',`${letterIndex*.12}s`);line.append(letter);letterIndex++;
    }
  }
  // Separate raster layers float intact, rather than bending the ghost artwork.
  const ghostLayers=[];
  const ghostOutlines=[
    [[1043,621],[1076,588],[1108,511],[1123,427],[1150,389],[1189,370],[1230,380],[1260,405],[1267,478],[1280,461],[1270,447],[1283,429],[1331,455],[1321,482],[1308,481],[1250,540],[1236,549],[1232,638],[1198,660],[1148,610],[1100,625]],
    [[1416,502],[1445,423],[1481,390],[1520,385],[1560,402],[1591,445],[1609,529],[1630,590],[1670,635],[1642,651],[1596,625],[1550,620],[1510,677],[1460,680],[1452,577],[1419,557]],
    [[977,806],[1008,781],[1030,728],[1059,636],[1090,591],[1123,573],[1168,577],[1200,601],[1208,649],[1200,685],[1242,668],[1265,641],[1267,716],[1236,751],[1208,755],[1204,793],[1174,820],[1100,840],[1036,843],[1001,829]],
    [[1462,689],[1490,624],[1520,602],[1560,600],[1591,615],[1617,651],[1632,714],[1665,810],[1656,834],[1590,839],[1562,858],[1528,845],[1495,806],[1487,766],[1450,749],[1438,721]]
  ];
  // One shared foreground silhouette keeps the lantern fixed without cutting
  // a rectangular hole in the ghost costume behind its handle.
  const lanternOutline=[[1153,741],[1167,744],[1175,753],[1179,766],[1173,774],[1181,785],[1192,795],[1194,813],[1202,842],[1198,859],[1189,868],[1189,879],[1169,886],[1138,884],[1118,876],[1119,867],[1112,852],[1115,832],[1119,799],[1128,787],[1139,779],[1135,769],[1138,753]];
  let lanternLayer;
  function lanternPath(target){target.beginPath();lanternOutline.forEach(([x,y],i)=>{const px=x*1280/1672,py=y*720/941;i?target.lineTo(px,py):target.moveTo(px,py)});target.closePath();}
  function makeGhostLayers(original){
    ghostLayers.length=0;
    lanternLayer=document.createElement('canvas');lanternLayer.width=1280;lanternLayer.height=720;
    const foreground=lanternLayer.getContext('2d');foreground.imageSmoothingEnabled=false;
    foreground.save();lanternPath(foreground);foreground.clip();foreground.drawImage(original,0,0);foreground.restore();
    for(const points of ghostOutlines){
      const layer=document.createElement('canvas');layer.width=1280;layer.height=720;
      const cut=layer.getContext('2d');cut.imageSmoothingEnabled=false;cut.beginPath();
      points.forEach(([x,y],i)=>{const px=x*1280/1672,py=y*720/941;i?cut.lineTo(px,py):cut.moveTo(px,py)});cut.closePath();
      // Keep the foreground lantern fixed in front of the lowest ghost.
      cut.clip();cut.drawImage(original,0,0);
      if(ghostLayers.length===2){cut.globalCompositeOperation='destination-out';lanternPath(cut);cut.fill();cut.globalCompositeOperation='source-over';}
      ghostLayers.push(layer);
    }
  }
  function hoveringGhosts(t){
    ghostLayers.forEach((layer,i)=>{
      const drift=Math.round(Math.sin(t*(.68+i*.047)+i*1.63)*2.1);
      ctx.drawImage(layer,0,drift);
    });
    if(lanternLayer)ctx.drawImage(lanternLayer,0,0);
  }
  function still(){ctx.drawImage(image,0,0,1280,720);hoveringGhosts(0);}
  const wisps=Array.from({length:24},(_,i)=>({seed:i+19,life:11+hash(i+3)*17,phase:hash(i+40),x:30+hash(i+80)*590,y:629+hash(i+5)*86,width:90+hash(i+7)*135,height:11+hash(i+12)*24}));
  function mist(t){ctx.save();ctx.globalCompositeOperation='screen';
    for(const w of wisps){const u=(t/w.life+w.phase)%1,fade=Math.pow(Math.sin(Math.PI*u),1.5);const x=w.x+(u-.5)*(190+hash(w.seed)*215)+18*(noise(t*.13,w.seed)-.5),y=w.y-u*(16+hash(w.seed+1)*30);ctx.save();ctx.translate(x,y);ctx.rotate((noise(t*.08,w.seed+2)-.5)*.25);ctx.scale(w.width*(.75+u*.65),w.height*(.65+u*.65));const g=ctx.createRadialGradient(0,0,0,0,0,1);g.addColorStop(0,`rgba(178,211,211,${fade*(.10+hash(w.seed+3)*.08)})`);g.addColorStop(.4,`rgba(119,166,174,${fade*.065})`);g.addColorStop(1,'rgba(140,100,80,0)');ctx.fillStyle=g;ctx.fillRect(-1,-1,2,2);ctx.restore();}
    ctx.restore();}
  function frame(ms){if(paused||document.hidden)return;if(ms-last<33){raf=requestAnimationFrame(frame);return}last=ms;const t=ms/1000;ctx.drawImage(image,0,0,1280,720);trees(t);hoveringGhosts(t);mist(t);
    glow(574,430,16,t,107,.3);glow(651,405,14,t,211,.3);glow(750,338,21,t,307,.22);glow(817,337,19,t,419,.2);glow(746,389,19,t,521,.25);glow(821,383,12,t,631,.18);glow(885,637,24,t,743,.22);
    windowVisitor(ms);
    raf=requestAnimationFrame(frame);
  }
  document.addEventListener('visibilitychange',()=>{cancelAnimationFrame(raf);if(!document.hidden&&!paused)raf=requestAnimationFrame(frame)});
  async function start(){
    await coinReady;
    const normalized=document.createElement('canvas');normalized.width=1280;normalized.height=720;
    const source=normalized.getContext('2d');source.imageSmoothingEnabled=false;source.drawImage(photo,0,0,1280,720);paintCoin(source);
    image=normalized;makeGhostLayers(normalized);ctx.drawImage(image,0,0);
    const clean=new Image();clean.onload=()=>{
      const plate=document.createElement('canvas');plate.width=1280;plate.height=720;
      const paint=plate.getContext('2d');paint.imageSmoothingEnabled=false;paint.drawImage(clean,0,0,1280,720);paintCoin(paint);
      image=plate;still();if(!paused){cancelAnimationFrame(raf);raf=requestAnimationFrame(frame)}
    };clean.src='background-ghost-cleanplate.png';
  }
  if(photo.complete&&photo.naturalWidth)start();else photo.addEventListener('load',start,{once:true});
})();
