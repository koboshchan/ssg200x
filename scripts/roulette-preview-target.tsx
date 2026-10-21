import React from 'react';
export default function PreviewTarget(){
 return <label>Next round target <select id="preview-target" defaultValue=""><option value="">Random</option>{Array.from({length:37},(_,n)=><option key={n} value={n}>{n}</option>)}</select></label>;
}
