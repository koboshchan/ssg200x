import {isolatedQaEmailEnabled} from './account-policy.mjs';
// Reuse the strict DEV-key validator, independently of email signup policy.
export function tabLeaseDiagnosticsEnabled(env=process.env){
 return env.SSG_QA_LEASE_DIAGNOSTICS==='1'&&isolatedQaEmailEnabled({...env,SSG_QA_EMAIL_AUTH:'1'});
}
export function createTabLeaseDiagnostics({env=process.env,write=line=>console.info(line)}={}){
 if(!tabLeaseDiagnosticsEnabled(env))return;
 return event=>{
  // Explicit allowlist: never serialize incoming objects, identifiers or errors.
  if(!["attached","replaced","report","expired","disconnected","rejected"].includes(event.event)||!Number.isFinite(event.at))return;
  const safe={event:event.event,at:event.at};
  for(const key of ['lease','ageMs','tabs'])if(Number.isFinite(event[key]))safe[key]=event[key];
  if(['missing','expired','proof','socket','multiple','route','transport_close','transport_error','ping_timeout','server_disconnect','client_disconnect','other'].includes(event.reason))safe.reason=event.reason;
  try{write(JSON.stringify({kind:'qa_tab_lease',...safe}));}catch{/* Diagnostics must not affect authorization. */}
 };
}
