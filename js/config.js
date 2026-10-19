'use strict';
const STATION='8418150', TZ='America/New_York', NOAA='https://api.tidesandcurrents.noaa.gov/api/prod/datagetter';
// Public coastal-area reference, intentionally NOT the user's street address or its precise coordinates.
const COASTAL_POINT='43.472,-70.385', WEATHER_OBS_STATIONS=['KPWM','KSFM'];
const THRESHOLDS=[{name:'Minor',value:12},{name:'Moderate',value:13},{name:'Major',value:14}];
const JAN2024=[{date:'Jan10',value:13.8},{date:'Jan13',value:14.57}];
const $=id=>document.getElementById(id);
// JSON null and empty strings mean "not supplied"; Number(null) and Number('')
// both become zero, which can otherwise make missing measurements look real.
const hasNumericValue=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value));
const state={obs:[],pred:[],predShort:[],predLong:[],highs:[],model:[],alerts:[],alertsActiveCount:0,days:3,showFlood:true,showModel:true,loading:false,lastSuccess:null,lastAttempt:null,errors:{},lastFetched:{},weatherObservation:null,weatherForecast:[],weatherForecastUpdated:null,weatherForecastFetchedAt:null,weatherPointUrl:null,marine:{},marineFetchError:null,marineSnapshotAt:null,briefing:null,briefingError:null,hazards:null,hazardsError:null,hazardsFetchedAt:null};
