// Validate before locking, but defer choosing until AFTER the round lock.
export function choosePreviewTarget(requested,{nodeEnv,enabled,previewBuild},randomTarget){
 if(requested===null)return randomTarget;
 if(nodeEnv==='production'||enabled!=='1'||previewBuild!==true){
  const error=new Error('Target override unavailable');error.status=403;throw error;
 }
 if(!/^(0|[1-9]|[12][0-9]|3[0-6])$/.test(requested)){
  const error=new Error('Invalid preview target');error.status=400;throw error;
 }
 return ()=>Number(requested);
}
