import * as THREE from 'three';
/** Free campus navigation; movement is independent of traffic playback and has no map-edge clamp. */
export function createNavigation({orthographic,controls,element,getOrigin,onCamera,onMode}){
  const street=new THREE.PerspectiveCamera(65,1,.12,2400),keys=new Set(),held=new Set(),events=new AbortController();
  let mode='orbit',camera=orthographic,yaw=0,pitch=0,look=null;
  const listen=(target,event,handler,options={})=>target.addEventListener(event,handler,{...options,signal:events.signal});
  const typing=()=>document.activeElement?.closest('input,select,textarea,[contenteditable]')||document.querySelector('dialog[open]');
  function setMode(next){
    keys.clear();held.clear();look=null;
    if(next==='street'){
      const [x,z]=getOrigin();street.position.set(x,2.2,z);yaw=0;pitch=0;street.rotation.set(0,0,0,'YXZ');camera=street;controls.enabled=false;
    }else{
      if(mode==='street'){orthographic.position.set(street.position.x+130,street.position.y+150,street.position.z+150);controls.target.set(street.position.x,0,street.position.z);orthographic.zoom=1;orthographic.updateProjectionMatrix();}
      camera=orthographic;controls.enabled=true;controls.mouseButtons.LEFT=next==='pan'?THREE.MOUSE.PAN:THREE.MOUSE.ROTATE;controls.touches.ONE=next==='pan'?THREE.TOUCH.PAN:THREE.TOUCH.ROTATE;
    }
    mode=next;onCamera(camera);onMode(mode);element.dataset.navigation=mode;resize();
  }
  function resize(){street.aspect=element.clientWidth/element.clientHeight;street.updateProjectionMatrix();}
  function move(forward,right,up,amount){
    const direction=new THREE.Vector3();camera.getWorldDirection(direction);direction.y=0;if(direction.lengthSq()<.001)direction.set(0,0,-1);direction.normalize();const side=new THREE.Vector3(-direction.z,0,direction.x);
    const offset=direction.multiplyScalar(forward).addScaledVector(side,right).add(new THREE.Vector3(0,up,0));if(offset.lengthSq()>1)offset.normalize();offset.multiplyScalar(amount);
    if(camera.position.y+offset.y<1.7)offset.y=1.7-camera.position.y;camera.position.add(offset);if(mode!=='street')controls.target.add(offset);
  }
  listen(document,'keydown',event=>{if(typing()||event.ctrlKey||event.altKey||event.metaKey)return;if(['w','a','s','d','q','e','shift'].includes(event.key.toLowerCase())){keys.add(event.key.toLowerCase());event.preventDefault();}});
  listen(document,'keyup',event=>keys.delete(event.key.toLowerCase()));
  const clear=()=>{keys.clear();held.clear();look=null;};listen(window,'blur',clear);listen(document,'visibilitychange',clear);
  listen(element,'pointerdown',event=>{if(mode!=='street'||event.button!==0)return;look={id:event.pointerId,x:event.clientX,y:event.clientY};element.setPointerCapture(event.pointerId);});
  listen(element,'pointermove',event=>{if(mode!=='street'||!look||look.id!==event.pointerId)return;yaw-=(event.clientX-look.x)*.004;pitch=THREE.MathUtils.clamp(pitch-(event.clientY-look.y)*.004,-1.4,1.4);street.rotation.set(pitch,yaw,0,'YXZ');look.x=event.clientX;look.y=event.clientY;});
  const stopLook=()=>look=null;listen(element,'pointerup',stopLook);listen(element,'pointercancel',stopLook);
  listen(element,'wheel',event=>{if(mode!=='street')return;event.preventDefault();move(event.deltaY<0?1:-1,0,0,6);},{passive:false});
  const vectors={forward:[1,0,0],back:[-1,0,0],left:[0,-1,0],right:[0,1,0],up:[0,0,1],down:[0,0,-1]};
  return {setMode,resize,get mode(){return mode;},hold(action,active){active?held.add(action):held.delete(action);},nudge(action){move(...vectors[action],mode==='street'?5:20);},
    update(dt){if(typing())clear();const active=action=>held.has(action);move((keys.has('w')||active('forward')?1:0)-(keys.has('s')||active('back')?1:0),(keys.has('d')||active('right')?1:0)-(keys.has('a')||active('left')?1:0),(keys.has('e')||active('up')?1:0)-(keys.has('q')||active('down')?1:0),dt*(mode==='street'?14:65)*(keys.has('shift')?3:1));element.dataset.cameraPosition=camera.position.toArray().map(n=>n.toFixed(2)).join(',');},
    dispose(){events.abort();}
  };
}
