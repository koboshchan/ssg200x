"use client";

import {useEffect, useId, useLayoutEffect, useRef, useState} from "react";
import {wordlist} from "@scure/bip39/wordlists/english.js";
import "./word-entry.css";

export type WordEntryProps = {
  value: string;
  onChange: (value: string) => void;
  count: number;
  disabled?: boolean;
  label?: string;
};

// Phrase strings, including whitespace and older four-word codes, stay intact.
export default function WordEntry({value, onChange, count, disabled = false, label = "Recovery words"}: WordEntryProps) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const mirror = useRef<HTMLSpanElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const [caret, setCaret] = useState(0);
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [anchor, setAnchor] = useState(0);
  const position = Math.min(caret, value.length);
  const start = value.slice(0, position).search(/\S*$/);
  const tail = value.slice(position).search(/\s/);
  const end = tail < 0 ? value.length : position + tail;
  const prefix = value.slice(start, position).toLowerCase();
  const matches = prefix ? wordlist.filter(word => word.startsWith(prefix)) : [];
  const expanded = !disabled && focused && !dismissed && matches.length > 0;
  const selected = Math.min(active, Math.max(0, matches.length - 1));

  function measure() {
    const element = input.current, text = mirror.current;
    if (!element || !text) return;
    const style = getComputedStyle(element);
    text.style.font = style.font;
    text.style.letterSpacing = style.letterSpacing;
    text.textContent = value.slice(0, start);
    const x = text.getBoundingClientRect().width + parseFloat(style.paddingLeft) - element.scrollLeft;
    setAnchor(Math.max(0, Math.min(x, element.clientWidth - 160)));
  }

  useLayoutEffect(() => {
    if (pendingCaret.current !== null && input.current) {
      input.current.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
    measure();
  }, [value, start, caret]);

  useEffect(() => {
    const element = input.current;
    if (!element) return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [value, start]);

  useEffect(() => {
    if (expanded) document.getElementById(id + "-option-" + selected)?.scrollIntoView({block: "nearest"});
  }, [expanded, id, selected]);

  function syncCaret() {
    const next = input.current?.selectionStart ?? 0;
    if (next !== caret) {setActive(0); setDismissed(false);}
    setCaret(next);
  }

  function pick(word: string) {
    const suffix = value.slice(end);
    const separator = suffix ? "" : " ";
    const next = value.slice(0, start) + word + separator + suffix;
    const nextCaret = start + word.length + (suffix ? (suffix.match(/^\s+/)?.[0].length ?? 0) : 1);
    pendingCaret.current = nextCaret;
    setCaret(nextCaret);
    setActive(0);
    setDismissed(true);
    onChange(next);
    input.current?.focus();
  }

  return <div className="word-entry">
    <label className="word-entry-label" htmlFor={id}>{label}</label>
    <div className="word-entry-textbox">
      <span className="word-entry-mirror" ref={mirror} aria-hidden="true"/>
      {expanded && <div className="word-entry-suggestions" style={{left: anchor}} role="listbox" aria-label="Word suggestions" id={id + "-suggestions"}>
        {matches.map((word, option) => <button type="button" role="option" tabIndex={-1}
          key={word} id={id + "-option-" + option} aria-selected={option === selected}
          onPointerDown={event => event.preventDefault()} onClick={() => pick(word)}>{word}</button>)}
      </div>}
      <input ref={input} id={id} role="combobox" aria-autocomplete="list" aria-expanded={expanded}
        aria-controls={expanded ? id + "-suggestions" : undefined}
        aria-activedescendant={expanded ? id + "-option-" + selected : undefined}
        autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
        placeholder={Array.from({length: count}, () => "word").join(" ")}
        value={value} disabled={disabled}
        onFocus={() => {setFocused(true); setActive(0); setDismissed(false); syncCaret();}}
        onBlur={() => {setFocused(false); setDismissed(true);}}
        onSelect={syncCaret} onScroll={measure}
        onChange={event => {
          setCaret(event.target.selectionStart ?? event.target.value.length);
          setActive(0);
          setDismissed(false);
          onChange(event.target.value);
        }}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Escape") {
            if (expanded) {event.preventDefault(); event.stopPropagation();}
            setDismissed(true);
            return;
          }
          if ((event.key === "ArrowDown" || event.key === "ArrowUp") && matches.length) {
            event.preventDefault();
            setDismissed(false);
            setActive((selected + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length);
          }
          if ((event.key === "Enter" || (event.key === "Tab" && !event.shiftKey)) && expanded) {
            event.preventDefault();
            pick(matches[selected]);
          }
        }}/>
    </div>
  </div>;
}
