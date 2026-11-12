import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const SHOW_DELAY_MS = 250;

/** One app-wide tooltip that replaces the browser's own `title` popups — those
 * take ~1s to appear and look unstyled. Any element with a `title` attribute
 * gets this automatically: on hover the title is moved to `data-tip` (so the
 * native one doesn't also pop up) and shown in a styled bubble almost right
 * away. Mouse/trackpad only — touch screens have no hover, and hijacking a
 * long-press would fight with the tap that the button actually does. */
export default function Tooltips() {
  const [tip, setTip] = useState(null); // { text, rect }
  const timer = useRef(null);
  const current = useRef(null);
  const bubbleRef = useRef(null);
  const [pos, setPos] = useState(null);

  useEffect(() => {
    function hide() {
      clearTimeout(timer.current);
      current.current = null;
      setTip(null);
    }

    function onOver(e) {
      if (e.pointerType && e.pointerType !== "mouse") return;
      const el = e.target.closest?.("[title], [data-tip]");
      if (!el) return hide();
      if (el === current.current) return;
      // React may have re-set the title since we last moved it, so the live
      // attribute wins over a stale data-tip.
      const title = el.getAttribute("title");
      if (title) {
        el.setAttribute("data-tip", title);
        el.removeAttribute("title");
      }
      const text = el.getAttribute("data-tip");
      clearTimeout(timer.current);
      current.current = el;
      setTip(null);
      if (!text) return;
      timer.current = setTimeout(() => {
        if (current.current === el && el.isConnected) setTip({ text, rect: el.getBoundingClientRect() });
      }, SHOW_DELAY_MS);
    }

    document.addEventListener("pointerover", onOver);
    document.addEventListener("pointerdown", hide, true);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("blur", hide);
    return () => {
      clearTimeout(timer.current);
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerdown", hide, true);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("blur", hide);
    };
  }, []);

  // Measure the bubble, then place it above the element (below if there's no
  // room), centered and kept inside the screen edges.
  useEffect(() => {
    if (!tip || !bubbleRef.current) return setPos(null);
    const b = bubbleRef.current.getBoundingClientRect();
    const gap = 8;
    const margin = 8;
    let top = tip.rect.top - b.height - gap;
    let below = false;
    if (top < margin) {
      top = tip.rect.bottom + gap;
      below = true;
    }
    let left = tip.rect.left + tip.rect.width / 2 - b.width / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - b.width - margin));
    setPos({ top, left, below });
  }, [tip]);

  if (!tip) return null;
  return createPortal(
    <div
      ref={bubbleRef}
      className={`app-tooltip ${pos ? "app-tooltip--shown" : ""} ${pos?.below ? "app-tooltip--below" : ""}`}
      style={pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 }}
      role="tooltip"
    >
      {tip.text}
    </div>,
    document.body
  );
}
