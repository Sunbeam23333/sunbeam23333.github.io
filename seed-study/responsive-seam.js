(() => {
  // The source has two independent *inclusive* media rules. Only at exactly
  // 767 CSS px are both its tablet and mobile qualities groups visible.
  const overlap=matchMedia('(width: 767px)');
  const original=document.getElementById('traits');
  if(!original)return;
  let duplicate,observer;
  function sync(){
    if(!overlap.matches){
      observer?.disconnect();duplicate?.remove();duplicate=undefined;return;
    }
    if(duplicate)return;
    duplicate=document.createElement('div');
    duplicate.className='seam-traits';
    duplicate.setAttribute('aria-hidden','true');
    const children=[...original.querySelectorAll('.trait')];
    duplicate.append(...children.map(item=>item.cloneNode(true)));
    original.after(duplicate);
    if('IntersectionObserver' in window){
      duplicate.classList.add('field-motion-ready');
      observer=new IntersectionObserver(entries=>{
        if(entries.some(entry=>entry.isIntersecting)){
          duplicate.classList.add('field-motion-in');observer.disconnect();
        }
      },{threshold:.01});
      observer.observe(duplicate);
    }
  }
  overlap.addEventListener('change',sync);
  sync();
})();
