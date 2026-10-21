export function shouldHandleVoteKey(e:Pick<globalThis.KeyboardEvent,"target"|"metaKey"|"ctrlKey"|"altKey"|"shiftKey"|"repeat"|"defaultPrevented">):boolean{
 const t=e.target as HTMLElement|null;
 if(t&&(t.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))return false;
 if(e.metaKey||e.ctrlKey||e.altKey||e.shiftKey||e.repeat||e.defaultPrevented)return false;
 if(t&&t.closest("form,dialog,[role=dialog]:not([aria-label=\"Vote kick\"]),[role=menu],[contenteditable]"))return false;
 return true;
}
