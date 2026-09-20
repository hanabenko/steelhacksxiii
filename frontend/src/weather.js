import data from './data/weather.json' with {type:'json'};
export const WEATHER_DATA=data;
// Conflict scores remain the existing illustrative surrogate, not an ERA5 calibration.
const legacyRisk={clear:1,rain:1.25,storm:1.5,snow:1.65};
export const WEATHER=Object.fromEntries(Object.entries(data.profiles).map(([id,p])=>[id,{
 ...p,speed:p.speed_factor_scale,capacity:p.capacity_scale,risk:legacyRisk[id],
}]));
export function historicalWeather(date){
 const row=data.days[date];
 return row?{date,weather:row[0],temperatureF:row[1],precipitationIn:row[2],snowfallIn:row[3],source:data.source,site:data.site}:null;
}
