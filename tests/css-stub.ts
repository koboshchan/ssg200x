// SSR-only test hook. Browser/build tests load the actual CSS separately.
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
require.extensions[".css"]=(module)=>{module.exports={__esModule:true,default:new Proxy({}, {get:(_target,key)=>String(key)})};};
