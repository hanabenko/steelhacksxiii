import {chromium} from '@playwright/test';
const browser=await chromium.launch({channel:'chrome',args:['--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:900,height:700}});
await page.goto('http://127.0.0.1:5173');
await page.evaluate(async()=>{
 const THREE=await import('/node_modules/three/build/three.module.js');
 const {buildVehicleVariant,animateVehicleWheels}=await import('/src/vehicle-variants.js');
 const scene=new THREE.Scene();scene.background=new THREE.Color('#d8e7f0');const g=new THREE.Group();scene.add(g);
 const mat=color=>new THREE.MeshStandardMaterial({color,roughness:.8});
 const box=(w,h,d,x,y,z,color,parent)=>{const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat(color));m.position.set(x,y,z);parent.add(m);return m;};
 const bike=buildVehicleVariant('bike',g,{box,mat,textures:[]});animateVehicleWheels(bike,.5);
 scene.add(new THREE.HemisphereLight(0xffffff,0x607080,3));const sun=new THREE.DirectionalLight(0xffffff,2);sun.position.set(3,5,4);scene.add(sun);
 const camera=new THREE.PerspectiveCamera(42,900/700,.1,50);camera.position.set(4,2.6,3.5);camera.lookAt(0,1,0);
 const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(900,700);Object.assign(renderer.domElement.style,{position:'fixed',inset:0,zIndex:9999});document.body.append(renderer.domElement);renderer.render(scene,camera);
});
await page.screenshot({path:'artifacts/bicycle-detail.png'});await browser.close();
