// Curved, draggable, looping photo fan ("Visual Notebook")
(function(){
 const arc=document.querySelector('.arc'); if(!arc) return;
 const cards=[...arc.querySelectorAll('.card')], N=cards.length;
 const jit=cards.map((_,i)=>Math.sin(i*12.9898)*6.5); // small fixed tilt variation
 let pos=3.5, vel=0, dragging=false, lastX=0, idle=0;
 const reduce=matchMedia('(prefers-reduced-motion:reduce)').matches;
 const pitch=()=>Math.min(arc.clientWidth,1366)*0.0955+ (innerWidth<640?6:0); // px between cards
 function render(){
  const w=arc.clientWidth, p=pitch(), R=w*2.4, cw=cards[0].offsetWidth;
  cards.forEach((c,i)=>{
   let o=((i-pos)%N+N)%N; if(o>N/2)o-=N;          // wrap -> infinite loop
   const x=o*p, th=x/R, y=R*(1-Math.cos(th))*1.0 - R*0.0;
   const deg=th*180/Math.PI*1.5+jit[i];
   c.style.transform=`translate(${x-cw/2}px,${y*0.6}px) rotate(${deg}deg)`;
   c.style.zIndex=100-Math.round(Math.abs(o)*4);
  });
 }
 function tick(){
  if(!dragging){ pos+=vel; vel*=0.94; if(Math.abs(vel)<0.0004){vel=0; if(!reduce&&idle++>120) pos+=0.004;} }
  render(); requestAnimationFrame(tick);
 }
 arc.addEventListener('pointerdown',e=>{dragging=true;lastX=e.clientX;vel=0;idle=0;arc.classList.add('drag');arc.setPointerCapture(e.pointerId)});
 arc.addEventListener('pointermove',e=>{ if(!dragging)return; const dx=e.clientX-lastX; lastX=e.clientX; const d=-dx/pitch(); pos+=d; vel=d; });
 const end=()=>{dragging=false;arc.classList.remove('drag')}; arc.addEventListener('pointerup',end); arc.addEventListener('pointercancel',end);
 arc.addEventListener('wheel',e=>{ const d=(Math.abs(e.deltaX)>Math.abs(e.deltaY)?e.deltaX:0); if(!d)return; e.preventDefault(); vel=d/pitch()*0.35; idle=0; },{passive:false});
 addEventListener('resize',render); render(); requestAnimationFrame(tick);
})();
