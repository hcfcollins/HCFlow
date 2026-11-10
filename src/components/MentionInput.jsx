import { useRef, useState } from "react";
import { useMentionRoster, mentionTokenFor, firstName } from "../lib/mentions";

/** A text input that pops up matching people while you type "@Ra…" — pick
 * one with a click, Enter, or Tab (arrow keys move the highlight, Escape
 * closes it). Otherwise behaves like a plain <input>; extra props pass
 * through. onKeyDown from the parent only fires when the menu isn't
 * consuming the key, so Enter-to-submit still works normally. */
export default function MentionInput({ value, onChange, onKeyDown, className, ...rest }) {
  const roster = useMentionRoster();
  const inputRef = useRef(null);
  const [query, setQuery] = useState(null); // { text, start } of the "@word" being typed, or null
  const [highlight, setHighlight] = useState(0);

  const matches =
    query == null
      ? []
      : roster
          .filter((a) => {
            const q = query.text.toLowerCase();
            return firstName(a.name).toLowerCase().startsWith(q) || a.name.toLowerCase().startsWith(q);
          })
          .slice(0, 6);
  const open = matches.length > 0;

  function detect(text, caret) {
    const before = text.slice(0, caret);
    const m = /(^|\s)@([A-Za-z'-]*)$/.exec(before);
    if (m) {
      setQuery({ text: m[2], start: caret - m[2].length - 1 });
      setHighlight(0);
    } else {
      setQuery(null);
    }
  }

  function pick(agent) {
    const caret = inputRef.current?.selectionStart ?? value.length;
    const token = `${mentionTokenFor(agent, roster)} `;
    const next = value.slice(0, query.start) + token + value.slice(caret).replace(/^\S*\s?/, "");
    onChange(next);
    setQuery(null);
    const pos = query.start + token.length;
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(pos, pos);
    });
  }

  return (
    <div className="mention-input-wrap">
      <input
        {...rest}
        ref={inputRef}
        className={className}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          detect(e.target.value, e.target.selectionStart);
        }}
        onKeyDown={(e) => {
          if (open) {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHighlight((h) => (h + 1) % matches.length);
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlight((h) => (h - 1 + matches.length) % matches.length);
              return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              e.stopPropagation();
              pick(matches[highlight]);
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setQuery(null);
              return;
            }
          }
          onKeyDown?.(e);
        }}
        onBlur={(e) => {
          setQuery(null);
          rest.onBlur?.(e);
        }}
      />
      {open && (
        <ul className="mention-menu" role="listbox">
          {matches.map((a, i) => (
            <li key={a.id}>
              <button
                type="button"
                className={`mention-option${i === highlight ? " mention-option--active" : ""}`}
                // mousedown, not click — a click would blur the input first,
                // which closes the menu (and commits an in-place edit).
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(a);
                }}
              >
                @{a.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
