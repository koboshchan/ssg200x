import React,{lazy,Suspense} from "react";
export default function dynamic(loader:()=>Promise<any>,opts?:any){const L=lazy(async()=>{const m=await loader();return m&&m.default?m:{default:m};});return (props:any)=><Suspense fallback={null}><L {...props}/></Suspense>;}
