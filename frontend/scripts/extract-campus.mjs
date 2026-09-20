import fs from 'node:fs';const xml=fs.readFileSync(new URL('../osm-campus-source.xml',import.meta.url),'utf8');
const attr=s=>Object.fromEntries([...s.matchAll(/([\w:]+)="([^"]*)"/g)].map(m=>[m[1],m[2].replaceAll('&amp;','&').replaceAll('&apos;',"'").replaceAll('&quot;','"')]));
const elements=[...xml.matchAll(/<(node|way|relation)\s([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/g)].map(m=>({...attr(m[2]),type:m[1],tags:Object.fromEntries([...(m[3]||'').matchAll(/<tag\s([^>]+)\/>/g)].map(t=>{const a=attr(t[1]);return[a.k,a.v];})),members:[...(m[3]||'').matchAll(/<member\s([^>]+)\/>/g)].map(t=>attr(t[1])),refs:[...(m[3]||'').matchAll(/<nd ref="(\d+)"\/>/g)].map(n=>n[1])}));
const nodes=new Map(elements.filter(e=>e.type==='node').map(e=>[e.id,e]));const origin=nodes.get('105013345');const center={lat:+origin.lat,lon:+origin.lon};
const project=n=>[(+n.lon-center.lon)*111320*Math.cos(center.lat*Math.PI/180),-(+n.lat-center.lat)*111320];const east=project(nodes.get('105013320')).map(n=>-n);const angle=Math.atan2(east[1],east[0]);
const local=n=>{const [x,z]=project(n);return[+(x*Math.cos(angle)+z*Math.sin(angle)).toFixed(2),+(-x*Math.sin(angle)+z*Math.cos(angle)).toFixed(2)];};
const field=([x,z])=>x>-475&&x<425&&z>-500&&z<300;
const within=([x,z])=>x>-340&&x<290&&z>-310&&z<100;
const features=elements.filter(e=>e.type==='way'&&(e.tags.building||e.tags['building:part']||e.tags.highway||e.tags.landuse==='grass'||e.tags.leisure==='garden')).map(e=>({id:e.id,tags:e.tags,points:e.refs.map(r=>nodes.get(r)).filter(Boolean).map(local)})).filter(e=>e.points.some(e.tags.highway?field:within));
// Preserve closed multipolygon shells and courtyard holes from OSM relations.
for(const relation of elements.filter(e=>e.type==='relation'&&e.tags.building)){
  const rings=role=>relation.members.filter(m=>m.type==='way'&&m.role===role).map(m=>elements.find(e=>e.type==='way'&&e.id===m.ref)).filter(Boolean).filter(w=>w.refs[0]===w.refs.at(-1)).map(w=>w.refs.map(r=>nodes.get(r)).filter(Boolean).map(local));
  for(const points of rings('outer'))if(points.some(within))features.push({id:'relation/'+relation.id,tags:relation.tags,points,holes:rings('inner')});
}
const points=elements.filter(e=>e.type==='node'&&(e.tags.name||e.tags.natural==='tree'||e.tags.highway==='traffic_signals'||e.tags.highway==='bus_stop'||['bench','bicycle_parking','waste_basket'].includes(e.tags.amenity))).map(e=>({id:e.id,tags:e.tags,point:local(e)})).filter(e=>within(e.point));
const output={id:'pitt-forbes-bigelow',name:'Forbes Avenue & Bigelow Boulevard',district:'University of Pittsburgh · Oakland',center,rotation:angle,bounds:{minX:-475,maxX:425,minZ:-500,maxZ:300},source:'OpenStreetMap contributors',license:'ODbL-1.0',sourceUrl:'https://www.openstreetmap.org/node/105013345',retrieved:'2026-09-19',notes:'OSM building footprints, building parts, roads, paths, POIs and mapped trees. Untagged heights and architectural details are illustrative. Editing and paired local estimates cover Forbes / Bigelow, Fifth / Bigelow, and Forbes / Bouquet. Coupled routing and queue spillback are not modeled.',features,points};
fs.writeFileSync(new URL('../src/data/intersection.json',import.meta.url),JSON.stringify(output,null,2));
console.log(`Extracted ${features.length} campus features and ${points.length} mapped points from OpenStreetMap.`);
