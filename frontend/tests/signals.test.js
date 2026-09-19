import test from 'node:test';
import assert from 'node:assert/strict';
import { signalState } from '../src/signals.js';
test('signals cycle through green, amber, clearance, and cross-street green',()=>{
  assert.equal(signalState(0).penn,'green');assert.equal(signalState(35).penn,'amber');
  assert.deepEqual([signalState(38).penn,signalState(38).cross],['red','red']);
  assert.equal(signalState(39).cross,'green');assert.equal(signalState(66).cross,'amber');
  assert.deepEqual([signalState(69).penn,signalState(69).cross],['red','red']);
  assert.equal(signalState(70).penn,'green');
});
test('green splits never release both approaches and countdown is positive',()=>{
  for(const split of [20,35,60])for(let time=0;time<140;time+=.25){const s=signalState(time,split);assert.ok(!(s.penn==='green'&&s.cross==='green'));assert.ok(s.remaining>=1);}
  assert.equal(signalState(25,20).cross,'green');assert.equal(signalState(25,60).penn,'green');
});
