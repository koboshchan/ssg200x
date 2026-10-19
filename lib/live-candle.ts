/** Client-side reference-price candles. Missing intervals stay gaps, never invented trades. */
export type LiveCandle={time:number;open:number;high:number;low:number;close:number};
export type LiveQuote={micro:number;at:number};
export function tickCandle(previous:LiveCandle|undefined,quote:LiveQuote,width:number):LiveCandle|undefined {
 if(!Number.isSafeInteger(quote.micro)||quote.micro<=0||!Number.isSafeInteger(quote.at)||quote.at<0||!Number.isSafeInteger(width)||width<=0)return previous;
 const time=Math.floor(quote.at/width)*width,price=quote.micro/1e6;
 if(previous&&time<previous.time)return previous;
 return previous&&time===previous.time?{...previous,high:Math.max(previous.high,price),low:Math.min(previous.low,price),close:price}:{time,open:price,high:price,low:price,close:price};
}
