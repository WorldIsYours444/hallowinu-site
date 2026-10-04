(() => {
  const scene=document.querySelector('.scene'),sprite=new Image();
  const actors=Array.from({length:9},(_,i)=>{
    const canvas=document.createElement('canvas');canvas.width=96;canvas.height=96;canvas.className='pixel-bat';canvas.setAttribute('aria-hidden','true');canvas.hidden=true;scene.append(canvas);
    const context=canvas.getContext('2d');context.imageSmoothingEnabled=false;
    return {canvas,context,next:i*2.7+Math.random()*4,route:null,size:30+Math.random()*24,seed:Math.random()*6};
  });
  let ready=false,time=0,previous=null,request=0;
  const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
  function launch(b,t){
    const direction=Math.random()<.5?1:-1,duration=12+Math.random()*10;
    let height=.2+Math.random()*.6;
    const points=Array.from({length:8},(_,i)=>{
      height=clamp(height+(Math.random()-.5)*.45,.16,.88);
      const progress=i/7,x=-.1+progress*1.2+(i>0&&i<7?(Math.random()-.5)*.16:0);
      return {x:direction===1?x:1-x,y:height};
    });
    b.route={start:t,duration,direction,points};
  }
  function flight(b,t){
    if(!b.route)return null;
    const age=t-b.route.start,p=age/b.route.duration;
    if(p>=1){b.route=null;b.next=t+14+Math.random()*33;return null;}
    const n=p*7,i=Math.min(6,Math.floor(n)),u=n-i,e=u*u*(3-2*u),a=b.route.points[i],c=b.route.points[i+1];
    const x=a.x+(c.x-a.x)*u;
    let y=a.y+(c.y-a.y)*e+Math.sin(age*(1.4+b.seed*.1)+b.seed)*.014;
    // Route behind/above the foreground lantern instead of crossing its flame.
    // Include the largest bat's half-width and height, with smooth shoulders.
    const distance=Math.abs(x-.691);
    if(distance<.095){const shoulder=clamp((.095-distance)/.04,0,1),safeY=Math.min(y,.745);y+=(safeY-y)*shoulder;}
    const angle=clamp((c.y-a.y)*e*55*b.route.direction,-22,22);
    return {x,y,angle,frame:Math.floor(t*(7+b.seed*.6)+b.seed)%4};
  }
  function paint(){const bounds=scene.getBoundingClientRect();let active=actors.filter(b=>b.route).length;for(const b of actors){if(!b.route&&time>=b.next&&active<(matchMedia('(max-width:900px), (max-device-width:900px) and (pointer:coarse)').matches?3:5)){launch(b,time);active++;}}for(const b of actors){const state=flight(b,time);b.canvas.hidden=!state;if(!state)continue;
    const size=Math.max(18,b.size*bounds.width/1280);b.canvas.style.width=`${size}px`;b.canvas.style.left=`${state.x*100}%`;const art=scene.querySelector('.scene-art');b.canvas.style.top=matchMedia('(max-width:900px), (max-device-width:900px) and (pointer:coarse)').matches?`${art.offsetTop+state.y*art.clientHeight}px`:`${state.y*100}%`;b.canvas.style.transform=`translate(-50%,-50%) rotate(${state.angle}deg)`;
    const w=sprite.naturalWidth/2,h=sprite.naturalHeight/2;b.context.clearRect(0,0,96,96);const anchors=[[334,340],[300,342],[340,263],[315,285]],anchor=anchors[state.frame];b.context.drawImage(sprite,state.frame%2*w,Math.floor(state.frame/2)*h,w,h,48-anchor[0]*96/627,48-anchor[1]*96/627,96,96);
  }}
  function running(){return ready&&!document.hidden&&!scene.classList.contains('motion-paused');}
  function tick(now){request=0;if(!running())return;if(previous!==null)time+=Math.min((now-previous)/1000,.1);previous=now;paint();request=requestAnimationFrame(tick);}
  function sync(){cancelAnimationFrame(request);previous=null;if(running())request=requestAnimationFrame(tick);}
  new MutationObserver(sync).observe(scene,{attributes:true,attributeFilter:['class']});document.addEventListener('visibilitychange',sync);
  sprite.onload=()=>{ready=true;if(running())paint();sync();};sprite.src='bat-sprites.png';
})();
