export const FEATURE_DEFAULTS=Object.freeze({"poker": true, "blackjack": true, "roulette": true, "doudizhu": true, "games": true, "coinflip": true, "dice": true, "limbo": true, "mines": true, "plinko": true, "crash": true, "wheel": true, "hilo": true, "slots": true, "keno": true, "chicken": true, "cryptoPerps": true, "cryptoSpot": true, "stocks": false, "forex": false, "polymarket": true, "chat": true, "tableTalk": true, "dms": true, "transfers": true, "payments": true, "airdrops": true, "advancements": true, "checkIn": true, "leaderboard": true});
export const FEATURE_LABELS=Object.freeze({"poker": "Poker", "blackjack": "Blackjack", "roulette": "Roulette", "doudizhu": "Dou Dizhu", "games": "Games", "coinflip": "Coinflip", "dice": "Dice", "limbo": "Limbo", "mines": "Mines", "plinko": "Plinko", "crash": "Crash", "wheel": "Wheel", "hilo": "Hi-Lo", "slots": "Slots", "keno": "Keno", "chicken": "Chicken", "cryptoPerps": "Crypto perpetuals", "cryptoSpot": "Crypto spot", "stocks": "Stocks", "forex": "Forex", "polymarket": "Predictions", "chat": "Chat", "tableTalk": "TableTalk", "dms": "Direct messages", "transfers": "Transfers", "payments": "Payments", "airdrops": "Airdrops", "advancements": "Advancements", "checkIn": "Daily check-in", "leaderboard": "Leaderboard"});
export function resolveFeatures(raw={},env=process.env){
 const result={...FEATURE_DEFAULTS};
 for(const key of Object.keys(result))if(typeof raw?.[key]==="boolean")result[key]=raw[key];
 for(const key of (env.SSG_FEATURES_FORCE_OFF??"").split(",").map(x=>x.trim()))if(key in result)result[key]=false;
 return result;
}
export function featureForPath(path){
 const p=path.replace(/^\/api/,"").split("/")[1];
 return ({action:"poker","poker-kicks":"poker",blackjack:"blackjack",roulette:"roulette",doudizhu:"doudizhu",games:"games",polymarket:"polymarket",transfers:"transfers",airdrops:"airdrops","check-in":"checkIn",leaderboard:"leaderboard"})[p]??null;
}
