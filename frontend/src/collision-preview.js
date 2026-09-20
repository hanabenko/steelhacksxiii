import * as THREE from 'three';
// Explicit cinematic replay: never feeds crash counts, score, or Monte Carlo metrics.
export function createCollisionPreview(scene,templates){
  const root=new THREE.Group();root.visible=false;scene.add(root);
  const cars=templates.slice(0,2).map(template=>{const g=template.clone(true);root.add(g);return g;});
  const particles=[];
  for(let i=0;i<32;i++){
    const smoke=i>=18,material=new THREE.MeshBasicMaterial({color:smoke?'#505865':i%2?'#ff602b':'#ffce49',transparent:true,opacity:0,depthWrite:false});
    const mesh=new THREE.Mesh(smoke?new THREE.IcosahedronGeometry(1,1):new THREE.ConeGeometry(.55,1.8,6),material);root.add(mesh);particles.push({mesh,smoke,index:i});
  }
  const glow=new THREE.PointLight('#ff702a',0,24);glow.position.set(0,2,0);root.add(glow);
  let time=12;
  return{get incident(){return time>=1.2&&time<12?{x:root.position.x,z:root.position.z,radius:8,age:time-1.2}:null;},start(x=0,z=0){time=0;root.position.set(x,.25,z);root.visible=true;},update(dt,visible=true){time=Math.min(12,time+dt);root.visible=visible&&time<12;const impact=Math.max(0,time-1.2),approach=Math.max(0,1.2-time);
    cars[0].position.set(-approach*12+Math.min(impact,1)*1.8,0,0);cars[0].rotation.set(0,Math.PI/2+Math.sin(impact*5)*Math.exp(-impact*2)*.32,Math.sin(impact*9)*Math.exp(-impact*3)*.08);
    cars[1].position.set(2.1,0,approach*10+Math.min(impact,1)*1.4);cars[1].rotation.set(Math.sin(impact*8)*Math.exp(-impact*3)*.08,Math.PI-Math.min(impact,.8)*.35,0);
    const fade=Math.min(1,impact*3)*Math.min(1,(12-time)/2);glow.intensity=impact>0?(7+Math.sin(time*23)*2)*fade:0;
    particles.forEach(({mesh,smoke,index})=>{const phase=(impact*(smoke?.3:1.2)+index*.137)%1;mesh.visible=impact>0;mesh.position.set(1+Math.sin(index*8.1+time)*(.4+phase),1+phase*(smoke?9:2.5),Math.cos(index*5.7)*(.5+phase));mesh.scale.setScalar(smoke?.6+phase*2.2:.4+(1-phase)*.7);mesh.rotation.y=time+index;mesh.material.opacity=fade*(1-phase)*(smoke?.45:.85);});
    return time>=12?'idle':time<1.2?'approach':time<3?'impact':'fire';
  }};
}
