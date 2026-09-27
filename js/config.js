'use strict';
const STATION='8418150', TZ='America/New_York', NOAA='https://api.tidesandcurrents.noaa.gov/api/prod/datagetter';
// Public coastal-area reference, intentionally NOT the user's street address or its precise coordinates.
const COASTAL_POINT='43.472,-70.385', WEATHER_OBS_STATIONS=['KPWM','KSFM'];
const THRESHOLDS=[{name:'Minor',value:12},{name:'Moderate',value:13},{name:'Major',value:14}];
const JAN2024=[{date:'Jan10',value:13.8},{date:'Jan13',value:14.57}];
const $=id=>document.getElementById(id);
const state={obs:[],pred:[],predShort:[],predLong:[],highs:[],model:[],alerts:[],days:3,showFlood:true,showModel:true,loading:false,lastSuccess:null,lastAttempt:null,errors:{},lastFetched:{},weatherObservation:null,weatherForecast:[],weatherForecastUpdated:null,weatherPointUrl:null,marine:{},marineFetchError:null,marineSnapshotAt:null,briefing:null,briefingError:null,hazards:null,hazardsError:null,hazardsFetchedAt:null};
