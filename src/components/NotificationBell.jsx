import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { fetchNotifications, markNotificationsRead } from "../lib/transactions";

const POLL_MS = 60_000;

function timeAgo(iso) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Header bell: unread count badge + a dropdown of the signed-in user's own
 * notifications (to-dos the TC added on their deals, @mentions). Polls once a
 * minute and whenever the tab regains focus — no realtime subscription needed
 * at this team size. Opening the panel marks everything shown as read. */
export default function NotificationBell({ transactions, onOpenDeal }) {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const wrapRef = useRef(null);

  async function load() {
    try {
      setItems(await fetchNotifications());
      setUnavailable(false);
    } catch (e) {
      // Most likely the notifications table migration hasn't been run yet —
      // hide the bell quietly instead of breaking the header.
      console.warn("Notifications unavailable:", e.message);
      setUnavailable(true);
    }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    function onClickAway(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickAway);
    document.addEventListener("touchstart", onClickAway);
    return () => {
      document.removeEventListener("mousedown", onClickAway);
      document.removeEventListener("touchstart", onClickAway);
    };
  }, [open]);

  if (unavailable) return null;

  const unread = items.filter((n) => !n.read_at);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && unread.length) {
      try {
        await markNotificationsRead(unread.map((n) => n.id));
        const now = new Date().toISOString();
        // Keep the "new" highlight visible while the panel is open; it clears
        // on the next poll/open.
        setTimeout(() => setItems((cur) => cur.map((n) => (n.read_at ? n : { ...n, read_at: now }))), 4000);
      } catch (e) {
        console.warn("Couldn't mark notifications read:", e.message);
      }
    }
  }

  return (
    <div className="notif-wrap" ref={wrapRef}>
      <button type="button" className="header-icon-btn notif-bell" onClick={toggle} aria-label="Notifications" title="Notifications">
        <Bell size={18} />
        {unread.length > 0 && <span className="notif-badge">{unread.length > 9 ? "9+" : unread.length}</span>}
      </button>
      {open && (
        <div className="notif-panel">
          <div className="notif-panel-title">Notifications</div>
          {items.length === 0 ? (
            <p className="empty-state">Nothing yet.</p>
          ) : (
            <ul className="notif-list">
              {items.map((n) => {
                const tx = transactions.find((t) => t.id === n.transaction_id);
                return (
                  <li key={n.id}>
                    <button title="Open this deal"
                      type="button"
                      className={`notif-item${n.read_at ? "" : " notif-item--unread"}`}
                      disabled={!tx}
                      onClick={() => {
                        setOpen(false);
                        if (tx) onOpenDeal(tx);
                      }}
                    >
                      <span className="notif-item-msg">{n.message}</span>
                      <span className="notif-item-time">{timeAgo(n.created_at)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
