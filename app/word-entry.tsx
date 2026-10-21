"use client";

import {useEffect, useId, useRef, useState} from "react";
import {wordlist} from "@scure/bip39/wordlists/english.js";
import "./word-entry.css";

export type WordEntryProps = {
  value: string;
  onChange: (value: string) => void;
  count: number;
  disabled?: boolean;
  label?: string;
};

// Spaces retain empty positions while editing; callers still receive one phrase.
export default function WordEntry({value, onChange, count, disabled = false, label = "Recovery words"}: WordEntryProps) {
  const id = useId();
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const [focused, setFocused] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const slots = value.toLowerCase().replace(/\s/g, " ").split(" ");
  // Never silently discard pasted words, including an older four-word payment code.
  const size = Math.max(count, slots.length);
  const values = Array.from({length: size}, (_, index) => slots[index] || "");
  const prefix = focused === null ? "" : values[focused];
  const matches = prefix ? wordlist.filter(word => word.startsWith(prefix)) : [];
  const expanded = !disabled && focused !== null && !dismissed && matches.length > 0;
  const selected = Math.min(active, Math.max(0, matches.length - 1));

  useEffect(() => {
    if (expanded) document.getElementById(id + "-option-" + selected)?.scrollIntoView({block: "nearest"});
  }, [expanded, id, selected]);

  function update(index: number, text: string) {
    const next = [...values];
    next[index] = text.toLowerCase();
    onChange(next.join(" ").trimEnd());
    setActive(0);
    setDismissed(false);
  }

  function pick(index: number, word: string) {
    update(index, word);
    setDismissed(true);
    inputs.current[index + 1]?.focus();
  }

  function pastePhrase(index: number, text: string) {
    const words = text.trim().toLowerCase().split(/\s+/);
    if (words.length < 2) return false;
    // A whole phrase replaces the entry, even when pasted in a later field.
    // Shorter fragments fill from the current field without losing other slots.
    const next = words.length >= count ? words : [...values];
    if (words.length < count) next.splice(index, words.length, ...words);
    onChange(next.join(" ").trimEnd());
    setActive(0);
    setDismissed(true);
    return true;
  }

  return <div className="word-entry" role="group" aria-label={label}>
    <div className="word-entry-fields">
      {values.map((word, index) => {
        const inputId = id + "-word-" + index;
        const listId = id + "-suggestions-" + index;
        const open = expanded && focused === index;
        return <div className="word-entry-field" key={index}>
          <label htmlFor={inputId}>Word {index + 1}</label>
          {open && <div className="word-entry-suggestions" role="listbox" aria-label={"Suggestions for word " + (index + 1)} id={listId}>
            {matches.map((match, option) => <button type="button" role="option" tabIndex={-1}
              key={match} id={id + "-option-" + option} aria-selected={option === selected}
              onPointerDown={event => event.preventDefault()} onClick={() => pick(index, match)}>{match}</button>)}
          </div>}
          <input ref={element => {inputs.current[index] = element;}} id={inputId}
            role="combobox" aria-autocomplete="list" aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-activedescendant={open ? id + "-option-" + selected : undefined}
            autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
            value={word} disabled={disabled}
            onFocus={() => {setFocused(index); setActive(0); setDismissed(false);}}
            onBlur={() => {setFocused(null); setDismissed(true);}}
            onPaste={event => {if (pastePhrase(index, event.clipboardData.getData("text"))) event.preventDefault();}}
            onChange={event => {
              const text = event.target.value;
              if (/\s/.test(text) && pastePhrase(index, text)) return;
              update(index, text.replace(/\s/g, ""));
            }}
            onKeyDown={event => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Escape") {
                if (open) {event.preventDefault(); event.stopPropagation();}
                setDismissed(true);
                return;
              }
              if ((event.key === "ArrowDown" || event.key === "ArrowUp") && matches.length) {
                event.preventDefault();
                setDismissed(false);
                setActive((selected + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length);
              }
              if (event.key === "Enter" && open) {
                event.preventDefault();
                pick(index, matches[selected]);
              }
            }}/>
        </div>;
      })}
    </div>
  </div>;
}
