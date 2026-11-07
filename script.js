// drag-to-scroll notebook strip
const strip=document.querySelector('.strip');
if(strip){let down=false,sx=0,sl=0;
 strip.addEventListener('pointerdown',e=>{if(e.pointerType==='touch')return;down=true;sx=e.clientX;sl=strip.scrollLeft;strip.classList.add('drag')});
 addEventListener('pointerup',()=>{down=false;strip.classList.remove('drag')});
 addEventListener('pointermove',e=>{if(down)strip.scrollLeft=sl-(e.clientX-sx)});}
// reveal on scroll
const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}}),{threshold:.15});
document.querySelectorAll('.reveal').forEach(el=>io.observe(el));
