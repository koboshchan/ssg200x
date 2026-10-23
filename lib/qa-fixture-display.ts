import {pricePrecision} from "./price-display";
export const fixtureMacdPrecision=(price:number)=>Math.min(12,Math.max(4,pricePrecision(price)+2));
export const fixtureChatInitiallyOpen=(fixture:boolean,width:number,saved:string|null)=>fixture&&width<900?false:saved==="1"||(saved===null&&width>=1280);
