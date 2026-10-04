(() => {
  const scene=document.querySelector('.scene');
  const actor=document.createElement('canvas');actor.width=128;actor.height=128;actor.className='pixel-shiba';actor.setAttribute('aria-hidden','true');scene.append(actor);
  const slogans=['NO TRICKS. JUST TREATS. $HALLOWINU! 👻','THE PACK IS HERE. LET’S GET SPOOKY! 🔥','GHOST DOG. BIG HALLOWEEN ENERGY. 🎃','ONE PACK. ONE SPOOKY SEASON. LFG! 🚀'];
  let sloganIndex=-1;
  const bubble=document.createElement('div');bubble.className='shiba-speech';bubble.textContent=slogans[0];bubble.setAttribute('aria-hidden','true');bubble.hidden=true;scene.append(bubble);
  const context=actor.getContext('2d');context.imageSmoothingEnabled=false;
  const talkSprite=new Image();let talkReady=false;talkSprite.onload=()=>{talkReady=true;};talkSprite.src='shiba-talk.png';
  const sprite=new Image();let ready=false,time=0,previous=null,request=0;
  // A quick run, greeting and exit, then thirty seconds off-screen.
  function pose(seconds){const t=seconds%44.8;
    if(t<4.8)return {x:106-56*t/4.8,frame:Math.floor(t*9)%4,running:true};
    if(t<5.4)return {x:50,frame:t<5.05?4:5};
    if(t<9.4)return {x:50,frame:(t-5.4)%2.4>2.2?7:6,talk:t>5.65};
    if(t<10)return {x:50,frame:t<9.75?5:4};
    if(t<14.8)return {x:50-57*(t-10)/4.8,frame:Math.floor((t-10)*9)%4,running:true};
    return null;
  }
  function paint(){const cycle=Math.floor(time/44.8)%slogans.length;if(cycle!==sloganIndex){sloganIndex=cycle;bubble.textContent=slogans[cycle]}const state=pose(time);actor.hidden=!state;bubble.hidden=!state?.talk;if(!state)return;const mobile=matchMedia('(max-width:900px), (max-device-width:900px) and (pointer:coarse)').matches;const x=mobile?(state.x>=50?28+(state.x-50)*78/56:28+(state.x-50)*35/57):state.x;actor.style.left=`${x}%`;actor.style.transform=`translateX(-50%) translateY(${state.running?-[0,2,5,1][state.frame]:0}px)`;context.clearRect(0,0,128,128);if(state.talk&&talkReady){const sequence=[0,1,2,1,0,3,1,0,2,3,0];const f=sequence[Math.floor(time*8)%sequence.length],w=talkSprite.naturalWidth/2,h=talkSprite.naturalHeight/2;context.drawImage(talkSprite,(f%2)*w,Math.floor(f/2)*h,w,h,4,6,120,120);}else{const w=sprite.naturalWidth/4,h=sprite.naturalHeight/2;context.drawImage(sprite,(state.frame%4)*w,Math.floor(state.frame/4)*h,w,h,0,state.frame>=4?9:0,128,128);}}
  function running(){return ready&&!document.hidden&&!scene.classList.contains('motion-paused');}
  function tick(now){request=0;if(!running())return;if(previous!==null)time+=Math.min((now-previous)/1000,.1);previous=now;paint();request=requestAnimationFrame(tick);}
  function sync(){cancelAnimationFrame(request);request=0;previous=null;if(running())request=requestAnimationFrame(tick);}
  new MutationObserver(sync).observe(scene,{attributes:true,attributeFilter:['class']});
  document.addEventListener('visibilitychange',sync);
  sprite.onload=()=>{ready=true;paint();sync();};sprite.onerror=()=>{actor.hidden=true;bubble.hidden=true;};sprite.src='shiba-gallop.png';actor.hidden=true;
})();
