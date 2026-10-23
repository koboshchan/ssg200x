"use client";
import {createContext,useContext} from "react";
const Context=createContext(false);
export const useQaFixture=()=>useContext(Context);
export default function QaFixtureProvider({enabled,children}:{enabled:boolean;children:React.ReactNode}){
 return <Context.Provider value={enabled}>{children}</Context.Provider>;
}
