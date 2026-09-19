/** Pointer-based drag avoids native HTML drag inconsistencies and supports touch handles. */
export function installInfrastructureDrag({container,select,preview,place,cancel}) {
  let drag=null,suppressClick=false;
  container.querySelectorAll('[data-tool]').forEach(card=>{card.draggable=false;});
  container.addEventListener('pointerdown',event=>{
    const card=event.target.closest('[data-tool]');
    if(!card||event.button!==0)return;
    // Keep touch scrolling on the card; the grip is the touch drag handle.
    if(event.pointerType==='touch'&&!event.target.closest('.drag-grip'))return;
    drag={card,type:card.dataset.tool,id:event.pointerId,x:event.clientX,y:event.clientY,active:false};
    card.setPointerCapture(event.pointerId);
  });
  container.addEventListener('pointermove',event=>{
    if(!drag||event.pointerId!==drag.id)return;
    if(!drag.active&&Math.hypot(event.clientX-drag.x,event.clientY-drag.y)<7)return;
    if(!drag.active){drag.active=true;drag.card.setPointerCapture(event.pointerId);select(drag.type);document.body.classList.add('is-dragging');}
    event.preventDefault();preview(event.clientX,event.clientY);
  });
  function end(event){
    if(!drag||drag.id!==event.pointerId)return;
    const current=drag;drag=null;
    if(current.card.hasPointerCapture(event.pointerId))current.card.releasePointerCapture(event.pointerId);
    document.body.classList.remove('is-dragging');
    if(!current.active)return;
    suppressClick=true;setTimeout(()=>suppressClick=false,0);
    if(event.type==='pointercancel'){cancel();return;}
    const target=document.elementFromPoint(event.clientX,event.clientY);
    if(target?.closest('#scene'))place(current.type,event.clientX,event.clientY);
    else cancel();
  }
  container.addEventListener('pointerup',end);
  container.addEventListener('pointercancel',end);
  document.addEventListener('keydown',event=>{
    if(event.key!=='Escape'||!drag)return;
    const current=drag;drag=null;
    if(current.card.hasPointerCapture(current.id))current.card.releasePointerCapture(current.id);
    document.body.classList.remove('is-dragging');
    if(current.active)cancel();
  },true);
  container.addEventListener('click',event=>{if(suppressClick){event.preventDefault();event.stopImmediatePropagation();}},true);
}
