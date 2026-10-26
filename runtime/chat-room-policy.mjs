import {isolatedQaEmailEnabled} from './account-policy.mjs';
export const ISOLATED_QA_CHAT_ROOM='qa-isolated';
export const DEFAULT_CHAT_ROOMS=Object.freeze(['main','poker-02','poker-03']);
// Reuse the strict DEV host/key and protected-isolation checks, independently of
// whether the optional email-login policy is enabled. No keys reach the client.
export function isolatedQaChatRoomEnabled(env=process.env){
 return env.SSG_QA_CHAT_ROOM==='1'&&isolatedQaEmailEnabled({...env,SSG_QA_EMAIL_AUTH:'1'});
}
export function chatRoomIds(env=process.env){
 return isolatedQaChatRoomEnabled(env)?[...DEFAULT_CHAT_ROOMS,ISOLATED_QA_CHAT_ROOM]:[...DEFAULT_CHAT_ROOMS];
}
