// Durable, privacy-preserving Worker cron execution status. No subscriber data is stored.
export const HEARTBEAT_STALE_SECONDS = 30 * 60;
const CHANNELS = ['email', 'threshold_push', 'event_push'];
export function cronStatus(rows, now=Math.floor(Date.now()/1000)) {
  const byName=new Map((rows||[]).map(r=>[r.channel,r]));
  const channels={};
  for(const name of CHANNELS){
    const row=byName.get(name);
    if(!row){channels[name]={status:'unknown',lastCompletedAt:null};continue;}
    if(row.state==='disabled'){channels[name]={status:'disabled',lastCompletedAt:row.completed_at||null};continue;}
    const completed=Number(row.completed_at);
    const age=Number.isFinite(completed)&&completed>0?Math.max(0,now-completed):null;
    channels[name]={status:row.state==='running'?'running':row.state==='failed'?'failed':age===null?'unknown':age>HEARTBEAT_STALE_SECONDS?'stale':'healthy',lastCompletedAt:age===null?null:new Date(completed*1000).toISOString()};
  }
  return channels;
}
export async function readCronStatus(db,now=Math.floor(Date.now()/1000)){
  try {
    const result=await db.prepare('SELECT channel,state,completed_at FROM worker_cron_health').all();
    return {available:true,channels:cronStatus(result.results,now)};
  }catch(_){return {available:false,channels:cronStatus([],now)};}
}
export async function recordCron(db,channel,state,at=Math.floor(Date.now()/1000)){
  if(!CHANNELS.includes(channel)||!['running','healthy','failed','disabled'].includes(state))throw new Error('Invalid cron status');
  await db.prepare(`INSERT INTO worker_cron_health(channel,state,started_at,completed_at) VALUES(?,?,?,?)
    ON CONFLICT(channel) DO UPDATE SET state=excluded.state,
    started_at=CASE WHEN excluded.state='running' THEN excluded.started_at ELSE worker_cron_health.started_at END,
    completed_at=CASE WHEN excluded.state='running' THEN worker_cron_health.completed_at ELSE excluded.completed_at END`)
    .bind(channel,state,at,state==='running'?null:at).run();
}
export async function trackCron(db,channel,job){
  await recordCron(db,channel,'running');
  try {const result=await job();await recordCron(db,channel,'healthy');return result;}
  catch(error){
    try{await recordCron(db,channel,'failed');}catch(writeError){console.error('Cron heartbeat failure',channel,String(writeError));}
    throw error;
  }
}
