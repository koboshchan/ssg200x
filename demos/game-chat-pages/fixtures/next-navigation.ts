import {useEffect,useState} from "react";
export const usePathname=()=>location.pathname;
export const useRouter=()=>({push:(h:string)=>{location.assign(h);},replace:(h:string)=>{location.replace(h);},refresh:()=>location.reload(),back:()=>history.back(),prefetch:()=>{}});
export const useSearchParams=()=>new URLSearchParams(location.search);
