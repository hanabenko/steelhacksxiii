import observation from './data/traffic-observation.json' with {type:'json'};
export const DRIVING_DATA=observation;
export function observedSpeedMph(quantile=.5){
 const spread=Math.max(0,observation.p85SpeedMph-observation.medianSpeedMph);
 return Math.max(3,Math.min(observation.speedLimitMph,observation.medianSpeedMph+(quantile-.5)*spread/.35));
}
export function cruisingSpeed(kind,index){
 const speed=observedSpeedMph(((index*17)%101)/100)*.44704;
 // No observed bus/bike distribution is available: preserve explicit vehicle assumptions.
 return kind==='bike'?Math.min(4.3,speed):kind==='bus'?speed*.85:speed;
}
