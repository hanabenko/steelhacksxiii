import * as THREE from 'three';

/** Stylized facade details follow the real footprint; they are not surveyed architecture.
 * Batch repeated details into instanced meshes to keep the full city inexpensive to draw.
 */
export function createArchitecture(parent, material) {
  const batches = new Map();
  const transform = new THREE.Object3D();
  function block(color, width, height, depth, x, y, z, angle = 0) {
    transform.position.set(x, y, z);
    transform.rotation.set(0, angle, 0);
    transform.scale.set(width, height, depth);
    transform.updateMatrix();
    if (!batches.has(color)) batches.set(color, []);
    batches.get(color).push(transform.matrix.clone());
  }
  return {
    add(points, height, accent, index, {storefront=true}={}) {
      const ring = points.slice();
      if (ring.length > 1 && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1]) ring.pop();
      const area = ring.reduce((sum, [x,z], i) => { const next = ring[(i+1)%ring.length]; return sum + x*next[1]-next[0]*z; },0);
      const edges = ring.map(([x,z],i) => {
        const [xx,zz] = ring[(i+1)%ring.length], length = Math.hypot(xx-x,zz-z);
        const tx=(xx-x)/length, tz=(zz-z)/length, sign=area>0?1:-1;
        return {x,z,length,tx,tz,nx:tz*sign,nz:-tx*sign,angle:Math.atan2(-tz,tx)};
      }).filter(edge => edge.length > .5);
      for (const e of edges) {
        const {x,z,length,tx,tz,nx,nz,angle}=e;
        const at=(distance,y,offset=0)=>[x+tx*distance+nx*offset,y,z+tz*distance+nz*offset];
        // Roof-edge parapets and a stone plinth articulate the original polygon.
        block('#e4e0d4',length,.45,.32,...at(length/2,height+.15),angle);
        block('#e0d4bf',length,.4,.2,...at(length/2,.35,.1),angle);
        block('#e6dfd1',length,.19,.22,...at(length/2,3.05,.1),angle);
        if(length<3) continue;
        const bays=Math.max(1,Math.floor((length-1)/3.8));
        for(let bay=0;bay<bays;bay++) {
          const distance=(bay+.5)*length/bays;
          for(let y=4.4;y<height-1;y+=3.2) {
            block('#ede4d5',1.85,1.95,.15,...at(distance,y,.1),angle);
            block('#3c5974',1.6,1.72,.16,...at(distance,y,.2),angle);
            const glass=(bay+index+Math.floor(y))%7===0?'#e4c781':'#8bb1c9';
            block(glass,1.32,1.44,.08,...at(distance,y,.3),angle);
            block('#e7ddd0',.09,1.52,.09,...at(distance,y,.36),angle);
            block('#e7ddd0',1.4,.08,.09,...at(distance,y,.36),angle);
            block('#ece5d7',1.95,.14,.42,...at(distance,y-.99,.22),angle);
          }
        }
      }
      // Choose a street-facing facade by proximity to the two crossing centerlines.
      const frontage=edges.filter(e=>e.length>5).sort((a,b)=>Math.min(Math.abs(a.x+a.tx*a.length/2),Math.abs(a.z+a.tz*a.length/2))-Math.min(Math.abs(b.x+b.tx*b.length/2),Math.abs(b.z+b.tz*b.length/2)))[0];
      if(frontage && storefront) {
        const e=frontage;
        const at=(distance,y,offset=0)=>[e.x+e.tx*distance+e.nx*offset,y,e.z+e.tz*distance+e.nz*offset];
        const bays=Math.max(1,Math.floor(e.length/4.2));
        for(let i=0;i<bays;i++) {
          const distance=(i+.5)*e.length/bays;
          block('#f0e5d5',2.65,2.55,.14,...at(distance,1.55,.12),e.angle);
          block('#355771',2.35,2.3,.12,...at(distance,1.55,.22),e.angle);
          block('#83b0c4',2.1,1.85,.07,...at(distance,1.65,.3),e.angle);
          block('#ece1ce',.11,2.3,.08,...at(distance,1.55,.36),e.angle);
          // Alternating canvas stripes above shopfront windows.
          for(let stripe=0;stripe<6;stripe++)block(stripe%2?'#fff0d3':accent,.46,.16,1.2,...at(distance+(stripe-2.5)*.46,2.97,.65),e.angle);
          block(accent,2.75,.32,.14,...at(distance,2.78,1.22),e.angle);
        }
        // A recessed door with glazed transom and a brass handle.
        const distance=Math.min(e.length-1.4,1.5);
        block('#ece2d2',1.5,2.65,.14,...at(distance,1.48,.18),e.angle);
        block('#30465b',1.22,2.4,.1,...at(distance,1.45,.28),e.angle);
        block('#8bafbf',.9,1.35,.08,...at(distance,1.9,.36),e.angle);
        block('#d7b570',.12,.33,.1,...at(distance+.36,1.12,.44),e.angle);
      }
    },
    finish() {
      const geometry=new THREE.BoxGeometry(1,1,1);
      for(const [color,matrices] of batches){
        const mesh=new THREE.InstancedMesh(geometry,material(color),matrices.length);
        matrices.forEach((matrix,index)=>mesh.setMatrixAt(index,matrix));
        mesh.instanceMatrix.needsUpdate=true;
        mesh.castShadow=false;
        mesh.receiveShadow=true;
        mesh.computeBoundingSphere();
        parent.add(mesh);
      }
    },
  };
}
