import test from 'node:test';
import assert from 'node:assert/strict';
import {WEATHER,historicalWeather,WEATHER_DATA} from '../src/weather.js';
import {DEFAULT_CONDITIONS} from '../src/scenarios.js';
import {simulateNetwork,DEFAULT_SETTINGS} from '../src/model.js';
import {createTraffic} from '../src/traffic.js';
import map from '../src/data/intersection.json' with {type:'json'};

test('historical records cover the imported period and reject missing dates',()=>{
 assert.equal(Object.keys(WEATHER_DATA.days).length,2557);
 assert.equal(historicalWeather('2028-01-01'),null);
 for(const [date,row] of Object.entries(WEATHER_DATA.days)){
  const value=historicalWeather(date);assert.ok(WEATHER[value.weather]);assert.equal(value.precipitationIn,row[2]);
  if(value.snowfallIn>=.1)assert.equal(value.weather,'snow');
 }
});
test('weather changes speed and capacity while unchanged designs remain paired',()=>{
 const values=Object.keys(WEATHER).map(weather=>simulateNetwork([],{...DEFAULT_SETTINGS,demand:1600,conditions:{...DEFAULT_CONDITIONS,weather}}));
 values.forEach(value=>assert.deepEqual(value.before,value.after));
 for(let i=1;i<values.length;i++){
  assert.ok(values[i].before.speed.mean<values[i-1].before.speed.mean);
  assert.ok(values[i].before.throughput.mean<values[i-1].before.throughput.mean);
 }
});
test('bad weather lengthens the stopped queue gap and preserves the stop line',()=>{
 const gaps=[];
 for(const weather of Object.keys(WEATHER)){
  const traffic=createTraffic(map.features,2),[a,b]=traffic.vehicles;
  b.route=a.route;const stop=a.route.stops[0].s;a.s=stop-50;b.s=stop-75;a.speed=b.speed=5;
  for(let i=0;i<1800;i++)traffic.update(1/60,{penn:'red',cross:'red'},[],null,[],{...DEFAULT_CONDITIONS,weather});
  assert.ok(a.s<=stop+.6);assert.ok(a.speed<.1);assert.ok(b.speed<.1);gaps.push(a.s-b.s);
 }
 for(let i=1;i<gaps.length;i++)assert.ok(gaps[i]>gaps[i-1]);
});
