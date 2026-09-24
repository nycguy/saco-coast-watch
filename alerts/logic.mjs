// Shared by the Cloudflare Worker and the offline regression tests.
export const METRICS=["waterObserved","waterForecast","wind","gust","tempHigh","tempLow"];
export const LIMITS={waterObserved:[0,30],waterForecast:[0,30],wind:[0,180],gust:[0,220],tempHigh:[-40,140],tempLow:[-40,140]};
export const DEFAULTS={waterObserved:12,waterForecast:12,wind:30,gust:45,tempHigh:90,tempLow:32};
export function normalizePreferences(value){
 const result={};if(!value||typeof value!=="object")throw Error("Invalid alert settings");
 for(const key of METRICS){const item=value[key]||{};const enabled=item.enabled===true;
  const threshold=Number(item.threshold??DEFAULTS[key]);
  if(!Number.isFinite(threshold)||threshold<LIMITS[key][0]||threshold>LIMITS[key][1])
    throw Error("Threshold out of range: "+key);
  result[key]={enabled,threshold};
 }
 if(!Object.values(result).some(x=>x.enabled))throw Error("Select at least one threshold");
 return result;
}
export function isTriggered(metric,value,threshold){
 return metric==="tempLow"?value<=threshold:value>=threshold;
}
export function thresholdLabel(metric){return ({
 waterObserved:"Observed Portland water level",waterForecast:"Forecast Portland peak water level",
 wind:"Measured offshore sustained wind",gust:"Measured offshore wind gust",
 tempHigh:"Measured air temperature (high)",tempLow:"Measured air temperature (low)"
 })[metric];}
export function unit(metric){return metric.startsWith("water")?"ft MLLW":metric.startsWith("temp")?"°F":"mph";}
export function evaluate(previous,metric,value,threshold,now,minutes=60){
 const active=isTriggered(metric,value,threshold);
 if(!active)return {active:false,send:false};
 // Sending on the first valid check is intentional: an already active storm must not be missed.
 if(!previous||!previous.active)return {active:true,send:true};
 // A brief fluctuation across the threshold may produce another alert, but never
 // send more than one alert of the same metric/channel within the cooldown.
 return {active:true,send:false};
}
