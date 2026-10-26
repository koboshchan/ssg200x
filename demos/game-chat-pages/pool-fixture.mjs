// Pool adapter placeholder: no pool room exists until the Pool UI/server fixture is wired. Fails closed.
export async function poolContext(){return null;}
export async function poolRoutes(req,res){res.writeHead(404,{'content-type':'application/json'});res.end('{"error":"Pool fixture not wired"}');}
