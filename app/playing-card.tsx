/** Shared face artwork for poker and Dou Dizhu; context CSS controls card sizes. */
export default function PlayingCard({value,small=false}:{value:string;small?:boolean}){
 const back=value==="?",joker=value==="X"||value==="Y",red=value==="Y"||["h","d"].includes(value.slice(-1));
 const suits:Record<string,string>={s:"♠",h:"♥",c:"♣",d:"♦"};
 return <span aria-label={back?"Hidden card":value} className={"card"+(back?" back":"")+(red?" red":"")+(small?" small":"")}>{back?<span>♠</span>:<><b>{joker?(value==="X"?"☆":"★"):value[0]==="T"?"10":value[0]}</b><i>{joker?"J":suits[value.slice(-1)]}</i></>}</span>;
}
