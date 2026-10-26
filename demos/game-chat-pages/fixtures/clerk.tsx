import React from "react";
const cache=new Map<string,{id:string;firstName:string;username:string}>();
const user=()=>{const m=/(?:^|; )gc_user=(alice|bob)/.exec(document.cookie);if(!m)return null;let u=cache.get(m[1]);if(!u){u={id:m[1],firstName:m[1][0].toUpperCase()+m[1].slice(1),username:m[1]};cache.set(m[1],u);}return u;};
export const useUser=()=>{const u=user();return {isLoaded:true,isSignedIn:!!u,user:u};};
export const useAuth=()=>({isLoaded:true,isSignedIn:!!user(),userId:user()?.id??null,getToken:async()=>"fixture"});
export const SignInButton=({children}:{children?:React.ReactNode})=>React.createElement(React.Fragment,null,children);
export const UserButton=()=>React.createElement("span",{className:"private-label"},user()?.firstName??"");
