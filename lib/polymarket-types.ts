/** Simulation only: public market data, local wallet settlement. No external orders. */
export type PolyOutcome={label:string;tokenId:string;price:number|null};
export type PolyMarket={id:string;slug:string;question:string;description:string;image:string|null;conditionId:string;version:"v1"|"v2"|"unsupported";outcomes:PolyOutcome[];active:boolean;closed:boolean;acceptingOrders:boolean;endDate:string|null;volume:number;liquidity:number;groupItemTitle:string;resolutionStatus:string|null;asOf:number};
export type PolyEvent={id:string;slug:string;title:string;description:string;image:string|null;volume:number;volume24hr:number;markets:PolyMarket[];tags:{id:string;label:string;slug:string}[]};
export type PolyLevel={price:number;size:number;priceMicros:number;shareMicros:number};
export type PolyBook={source?:"stream";tokenId:string;conditionId:string;bids:PolyLevel[];asks:PolyLevel[];asOf:number;fetchedAt:number;hash:string};
export type PolyPosition={id:string;userId:string;marketId:string;conditionId:string;version:PolyMarket["version"];tokenId:string;question:string;outcome:string;image:string|null;slug:string;shareMicros:number;cost:number;openedAt:number};
export type PolyHistory={id:string;marketId:string;tokenId:string;question:string;outcome:string;action:"buy"|"sell"|"settle"|"void";shareMicros:number;amount:number;cost:number;at:number;requestId:string};
export type PolyState={enabled:boolean;maxTrade:number;positions:PolyPosition[];history:Record<string,PolyHistory[]>;settlements:Record<string,{at:number;payouts:Record<string,number>;source:string}>};
export type PolyTrade={action:"buy"|"sell";marketId:string;tokenId:string;amount:number;limitPrice:number;requestId:string;requestAt:number};
export type PolyResolution={marketId:string;conditionId:string;version:PolyMarket["version"];payouts:Record<string,number>;source:string;asOf:number;kind:"settle"|"void"};
export type PolyPortfolio={positions:Omit<PolyPosition,"userId">[];history:PolyHistory[];wallet:number;enabled:boolean;maxTrade:number};
