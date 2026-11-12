import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X, Signpost } from "lucide-react";
import TransactionList from "./TransactionList";
import ConfirmDialog from "./ConfirmDialog";
import { isExpiredListing, EXPIRED_REASON } from "../lib/stages";
import Tombstone from "./icons/Tombstone";
import { TodoRow } from "./TodoList";
import MentionInput from "./MentionInput";
import { STANDING_REMINDERS } from "../lib/onboarding";
import { useMentionRoster, splitMentions } from "../lib/mentions";
import { agentMissingItems } from "../lib/agentMissingInfo";
import { fetchAllAgents } from "../lib/transactions";

/** Starts collapsed only while a section is empty, then auto-opens the moment
 * something first lands in it — `useState(length === 0)` alone only looks at the
 * count on first render, so a section that started empty stayed collapsed forever
 * even after a deal moved into it. Doesn't touch collapsed state on later manual
 * toggles or further count changes, only on the empty-to-non-empty transition. */
function useAutoCollapse(length) {
  const [collapsed, setCollapsed] = useState(length === 0);
  const prevLength = useRef(length);
  useEffect(() => {
    if (prevLength.current === 0 && length > 0) setCollapsed(false);
    prevLength.current = length;
  }, [length]);
  return [collapsed, setCollapsed];
}

// "All" used to be a tab here too — it's now its own screen (the All Deals
// button at the bottom, next to My Spreadsheet), since it's an archive you
// visit occasionally rather than a working page.
export const PAGES = [
  { key: "comps", label: "Comps / Limbo", title: "Comps to send and sellers waiting to list", match: (tx) => tx.stage === "comps" },
  { key: "active", label: "Active Listings", title: "Private and on-market listings", match: (tx) => tx.stage === "won" || tx.stage === "market" },
  { key: "contract", label: "Under Contract", title: "Deals under contract, by closing date", match: (tx) => tx.stage === "contract" },
  { key: "todos", label: "To-Dos", title: "Every open to-do across every deal", match: () => true },
];

const SWIPE_THRESHOLD = 60;
const INTENT_THRESHOLD = 8;

export default function DealPages({
  transactions,
  stages,
  currentAgent,
  onStageChange,
  onNotesChange,
  onCompsStatusChange,
  onAddTodo,
  onToggleTodo,
  onEditTodo,
  onDeleteTodo,
  onOpenDetail,
  pageIndex,
  onPageIndexChange,
  searchQuery,
  onSearchChange,
  isSearching,
  searchResults,
  onNewComp,
  onNewUnderContract,
  onNewActiveListing,
  onDeadLead,
  onReviveLead,
  onOpenAgent,
}) {
  const [dragOffset, setDragOffset] = useState(0);
  const [quickTodoOpen, setQuickTodoOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const touchStart = useRef(null);
  const intent = useRef(null);
  const viewportRef = useRef(null);

  // Terminated deals are pulled out of the working pages (they're not active work
  // anymore) but still visible in their own bucket on the All page.
  const activeTransactions = transactions.filter((tx) => !tx.terminated_at);

  function handleTouchStart(e) {
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    intent.current = null;
    setDragging(true);
  }

  function handleTouchMove(e) {
    if (!touchStart.current) return;
    const deltaX = e.touches[0].clientX - touchStart.current.x;
    const deltaY = e.touches[0].clientY - touchStart.current.y;

    if (intent.current === null) {
      if (Math.abs(deltaX) < INTENT_THRESHOLD && Math.abs(deltaY) < INTENT_THRESHOLD) return;
      intent.current = Math.abs(deltaX) > Math.abs(deltaY) ? "horizontal" : "vertical";
      if (intent.current === "vertical") {
        touchStart.current = null;
        setDragging(false);
        return;
      }
    }

    const atFirstPage = pageIndex === 0 && deltaX > 0;
    const atLastPage = pageIndex === PAGES.length - 1 && deltaX < 0;
    setDragOffset(atFirstPage || atLastPage ? deltaX / 3 : deltaX);
  }

  function handleTouchEnd() {
    if (intent.current === "horizontal" && Math.abs(dragOffset) > SWIPE_THRESHOLD) {
      if (dragOffset < 0 && pageIndex < PAGES.length - 1) onPageIndexChange(pageIndex + 1);
      else if (dragOffset > 0 && pageIndex > 0) onPageIndexChange(pageIndex - 1);
    }
    setDragOffset(0);
    setDragging(false);
    touchStart.current = null;
    intent.current = null;
  }

  const width = viewportRef.current?.offsetWidth || 1;
  const percentOffset = (dragOffset / width) * 100;
  const translate = -(pageIndex * 100) + percentOffset;
  const currentPageKey = PAGES[pageIndex]?.key;
  const onCompsPage = currentPageKey === "comps";

  return (
    <div className="deal-pages">
      <div className="deal-pages-tabs">
        {PAGES.map((p, i) => {
          const count =
            p.key === "todos"
              ? activeTransactions.reduce((sum, tx) => sum + (tx.todos?.filter((t) => !t.done).length || 0), 0)
              : activeTransactions.filter(p.match).length;
          return (
            <button title={p.title}
              key={p.key}
              type="button"
              className={`deal-pages-tab ${i === pageIndex ? "active" : ""}`}
              onClick={() => onPageIndexChange(i)}
            >
              <span className="deal-pages-tab-label">{p.label}</span>
              <span className="deal-pages-tab-count">{count}</span>
            </button>
          );
        })}
      </div>

      {/* Active Listings only ever contains cards for deals that already
          exist, each with its own stage dropdown that opens the Under Contract
          form pre-filled with that deal's details — a blank "+ Under Contract"
          button here would just invite a manually-typed, possibly mismatched or
          duplicate address. */}
      {currentPageKey === "todos" && onAddTodo && (
        <button
          type="button"
          className="google-btn uc-launch uc-launch--todo"
          onClick={() => setQuickTodoOpen((v) => !v)}
          title="Add a to-do to any deal"
        >
          {quickTodoOpen ? "Close" : "+ Add a To-Do"}
        </button>
      )}
      {currentPageKey !== "active" && currentPageKey !== "todos" && (onCompsPage ? onNewComp : onNewUnderContract) && (
        <button title={onCompsPage ? "Add a new property to send a comp for" : "Add a new deal that just went under contract"}
          className={`google-btn uc-launch ${onCompsPage ? "uc-launch--comps" : "uc-launch--contract"}`}
          onClick={() => (onCompsPage ? onNewComp() : onNewUnderContract())}
        >
          {onCompsPage ? "+ New Comp" : "+ Under Contract"}
        </button>
      )}
      {/* For bringing listings that already exist outside the app in — a short
          form, not the full New Comp → Won → On Market path. */}
      {currentPageKey === "active" && onNewActiveListing && (
        <button title="Quickly add a listing that already exists outside the app" className="google-btn uc-launch uc-launch--active" onClick={onNewActiveListing}>
          + Active Listing
        </button>
      )}

      {isSearching ? (
        <div className="search-results">
          <TransactionList
            transactions={searchResults}
            stages={stages}
            currentAgent={currentAgent}
            onStageChange={onStageChange}
            onNotesChange={onNotesChange}
            onCompsStatusChange={onCompsStatusChange}
            onAddTodo={onAddTodo}
            onToggleTodo={onToggleTodo}
            onEditTodo={onEditTodo}
            onDeleteTodo={onDeleteTodo}
            onOpenDetail={onOpenDetail}
          />
        </div>
      ) : (
        <div
          className="deal-pages-viewport"
          ref={viewportRef}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div
            className="deal-pages-track"
            style={{
              transform: `translateX(${translate}%)`,
              transition: dragging ? "none" : "transform 0.25s ease",
            }}
          >
            {PAGES.map((p) => (
              <div key={p.key} className="deal-page">
                <div className={`deal-page-inner deal-page--${p.key}`}>
                  {p.key === "comps" ? (
                    <CompsPage
                      transactions={activeTransactions}
                      deadLeads={transactions.filter((tx) => tx.stage === "comps" && tx.terminated_at)}
                      onDeadLead={onDeadLead}
                      onReviveLead={onReviveLead}
                      stages={stages}
                      currentAgent={currentAgent}
                      onStageChange={onStageChange}
                      onNotesChange={onNotesChange}
                      onCompsStatusChange={onCompsStatusChange}
                      onAddTodo={onAddTodo}
                      onToggleTodo={onToggleTodo}
                      onEditTodo={onEditTodo}
                      onDeleteTodo={onDeleteTodo}
                      onOpenDetail={onOpenDetail}
                    />
                  ) : p.key === "contract" ? (
                    <UnderContractPage
                      transactions={activeTransactions.filter(p.match)}
                      stages={stages}
                      currentAgent={currentAgent}
                      onStageChange={onStageChange}
                      onNotesChange={onNotesChange}
                      onAddTodo={onAddTodo}
                      onToggleTodo={onToggleTodo}
                      onEditTodo={onEditTodo}
                      onDeleteTodo={onDeleteTodo}
                      onOpenDetail={onOpenDetail}
                    />
                  ) : p.key === "active" ? (
                    <ActiveListingsPage
                      transactions={activeTransactions.filter(p.match)}
                      expiredListings={transactions.filter(isExpiredListing)}
                      onRelist={onReviveLead}
                      stages={stages}
                      currentAgent={currentAgent}
                      onStageChange={onStageChange}
                      onNotesChange={onNotesChange}
                      onAddTodo={onAddTodo}
                      onToggleTodo={onToggleTodo}
                      onEditTodo={onEditTodo}
                      onDeleteTodo={onDeleteTodo}
                      onOpenDetail={onOpenDetail}
                    />
                  ) : (
                    <AllTodosPage
                      transactions={activeTransactions}
                      currentAgent={currentAgent}
                      quickTodoOpen={quickTodoOpen}
                      onCloseQuickTodo={() => setQuickTodoOpen(false)}
                      onAddTodo={onAddTodo}
                      onToggleTodo={onToggleTodo}
                      onEditTodo={onEditTodo}
                      onDeleteTodo={onDeleteTodo}
                      onOpenDetail={onOpenDetail}
                      onOpenAgent={onOpenAgent}
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="search-bar search-bar--fixed">
        <Search size={16} className="search-bar-icon" />
        <input
          type="text"
          className="search-bar-input"
          placeholder="Search by address or last name…"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
        />
        {isSearching && (
          <button title="Clear search"
            type="button"
            className="search-bar-clear"
            onClick={() => onSearchChange("")}
            aria-label="Clear search"
          >
            <X size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

/** A collapsible bucket, minimized by default — used throughout the All page so a
 * full pipeline overview doesn't turn into one giant scroll. */
function CollapsibleSection({ title, count, colorClass, onTitleClick, children, startExpanded }) {
  const [collapsed, setCollapsed] = useState(!startExpanded);
  if (count === 0) return null;
  return (
    <div className={`comps-section ${colorClass}`}>
      <div className="comps-section-header">
        <h2 className="comps-section-title">
          {onTitleClick ? (
            <button title="Open this deal" type="button" className="comps-section-title-btn" onClick={onTitleClick}>
              {title}
            </button>
          ) : (
            title
          )}{" "}
          <span className="comps-section-count">{count}</span>
        </h2>
        <button title={collapsed ? "Show this section" : "Collapse this section"} type="button" className="comps-minimize-btn" onClick={() => setCollapsed((c) => !c)}>
          {collapsed ? "Show" : "Minimize"}
        </button>
      </div>
      {!collapsed && children}
    </div>
  );
}

/** Every OPEN to-do across every active deal, flattened into one list — each row
 * is tagged with its property address (tappable, jumps straight to that deal)
 * since so many to-dos share the same text ("Go Live", "Send Listing Agreement")
 * across different properties. Defaults to grouped-by-property (toggle flips to
 * a flat urgency sort — overdue/due-soonest first, undated last — for triaging
 * what needs attention today across the whole pipeline instead). Completed
 * to-dos are deliberately left out of every summary view (this one and each
 * deal's card) — they only show, with their completion date, inside that
 * deal's own detail screen. */
/** "+ Add a To-Do" on the To-Dos tab: pick the deal, type the to-do
 * (@name works), optional due date. */
function QuickTodoForm({ transactions, onAdd, onDone }) {
  const sorted = useMemo(() => [...transactions].sort((a, b) => (a.address || "").localeCompare(b.address || "")), [transactions]);
  const [txId, setTxId] = useState("");
  const [text, setText] = useState("");
  const [due, setDue] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!txId || !text.trim()) return;
    setSaving(true);
    try {
      await onAdd(txId, text.trim(), due || undefined);
      setText("");
      setDue("");
      onDone?.();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="quick-todo-form" onSubmit={submit}>
      <select value={txId} onChange={(e) => setTxId(e.target.value)} required title="Which deal is this to-do for?">
        <option value="" disabled>
          Which property?
        </option>
        {sorted.map((tx) => (
          <option key={tx.id} value={tx.id}>
            {tx.address}
            {tx.town ? ` — ${tx.town}` : ""}
          </option>
        ))}
      </select>
      <MentionInput value={text} onChange={setText} placeholder="What needs to happen? (@name to notify)" />
      <div className="quick-todo-row">
        <label className="quick-todo-due" title="Optional due date">
          Due
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </label>
        <button type="submit" className="google-btn" disabled={saving || !txId || !text.trim()} title="Add this to-do to the property">
          {saving ? "Adding…" : "Add To-Do"}
        </button>
      </div>
    </form>
  );
}

function AllTodosPage({ transactions, currentAgent, onToggleTodo, onEditTodo, onDeleteTodo, onOpenDetail, quickTodoOpen, onCloseQuickTodo, onAddTodo, onOpenAgent }) {
  const [groupByProperty, setGroupByProperty] = useState(true);
  // Brokers: what's still missing on each agent's profile (licenses, cover
  // sheet, Dropbox folders) — tap to jump to that agent on Manage Agents.
  const isBroker = currentAgent?.role === "broker";
  const [agentGaps, setAgentGaps] = useState([]);
  useEffect(() => {
    if (!isBroker) return;
    let live = true;
    fetchAllAgents()
      .then((agents) => live && setAgentGaps(agents.map((a) => ({ agent: a, items: agentMissingItems(a) })).filter((g) => g.items.length)))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [isBroker]);
  const reminders = STANDING_REMINDERS.filter((r) => r.forEmail === currentAgent?.email && r.active());
  const pending = transactions.flatMap((tx) => (tx.todos || []).filter((t) => !t.done).map((t) => ({ ...t, tx })));

  const urgency = (t) => (t.due_date ? new Date(`${t.due_date}T00:00:00`).getTime() : Infinity);
  pending.sort((a, b) => urgency(a) - urgency(b));

  // To-dos someone @-tagged you in — pinned at the very top, whatever deal
  // they're on (they also still show in their normal spot below).
  const roster = useMentionRoster();
  const taggedMe = currentAgent?.id
    ? pending.filter((t) => splitMentions(t.text, roster).some((p) => typeof p !== "string" && p.agent.id === currentAgent.id))
    : [];

  function row(t, withPropertyTag) {
    return (
      <TodoRow
        key={t.id}
        todo={t}
        onToggle={onToggleTodo}
        onEdit={onEditTodo}
        onDelete={onDeleteTodo}
        propertyLabel={withPropertyTag ? t.tx.address : undefined}
        onPropertyClick={() => onOpenDetail(t.tx)}
      />
    );
  }

  // Groups ordered by their own most-urgent item, same as the flat list — so a
  // property with something overdue still surfaces first even when grouped.
  let groups = null;
  if (groupByProperty) {
    const byTx = new Map();
    for (const t of pending) {
      if (!byTx.has(t.tx.id)) byTx.set(t.tx.id, { tx: t.tx, items: [] });
      byTx.get(t.tx.id).items.push(t);
    }
    groups = [...byTx.values()].sort((a, b) => urgency(a.items[0]) - urgency(b.items[0]));
  }

  return (
    <div className="all-todos-page">
      {quickTodoOpen && onAddTodo && <QuickTodoForm transactions={transactions} onAdd={onAddTodo} onDone={onCloseQuickTodo} />}
      {reminders.length > 0 && (
        <div className="standing-reminders">
          <h2 className="comps-section-title">My Reminders</h2>
          {reminders.map((r) => (
            <div key={r.key} className="missing-info-todo standing-reminder" title="Clears itself once it's done">
              <span>📌</span>
              <span>{r.text}</span>
            </div>
          ))}
        </div>
      )}
      {isBroker && agentGaps.length > 0 && (
        <div className="comps-section comps-section--agent-gaps">
          <div className="comps-section-header">
            <h2 className="comps-section-title">
              Agent Info Missing <span className="comps-section-count">{agentGaps.length}</span>
            </h2>
          </div>
          {agentGaps.map(({ agent, items }) => (
            <div
              key={agent.id}
              role="button"
              tabIndex={0}
              className="missing-info-todo agent-gap"
              title={`Open ${agent.name} on Manage Agents`}
              onClick={() => onOpenAgent?.(agent.id)}
              onKeyDown={(e) => e.key === "Enter" && onOpenAgent?.(agent.id)}
            >
              <span>🪪</span>
              <span>
                <strong>{agent.name}:</strong> {items.join(" · ")}
              </span>
            </div>
          ))}
        </div>
      )}
      {taggedMe.length > 0 && (
        <div className="comps-section comps-section--tagged-me">
          <div className="comps-section-header">
            <h2 className="comps-section-title">
              Tagged You <span className="comps-section-count">{taggedMe.length}</span>
            </h2>
          </div>
          <div className="todo-list">{taggedMe.map((t) => row(t, true))}</div>
        </div>
      )}
      <div className="tutorial-tabs">
        <button title="List every to-do by due date, most urgent first" type="button" className={!groupByProperty ? "tutorial-tab tutorial-tab--active" : "tutorial-tab"} onClick={() => setGroupByProperty(false)}>
          Sort by Date
        </button>
        <button title="Group to-dos under their property" type="button" className={groupByProperty ? "tutorial-tab tutorial-tab--active" : "tutorial-tab"} onClick={() => setGroupByProperty(true)}>
          Group by Property
        </button>
      </div>

      {pending.length === 0 ? (
        <p className="empty-state">No open to-dos across any deal.</p>
      ) : groupByProperty ? (
        groups.map(({ tx, items }) => (
          <CollapsibleSection
            key={tx.id}
            title={tx.address}
            count={items.length}
            colorClass="comps-section--todo-group"
            onTitleClick={() => onOpenDetail(tx)}
            startExpanded
          >
            <div className="todo-list">{items.map((t) => row(t, false))}</div>
          </CollapsibleSection>
        ))
      ) : (
        <div className="todo-list">{pending.map((t) => row(t, true))}</div>
      )}
    </div>
  );
}

/** The year a deal actually closed — prefers the closing date (next_date, set on the
 * Under Contract form) since updated_at can get bumped by unrelated later edits.
 * Unparseable/missing dates count as "this year" so nothing silently vanishes into
 * the prior-years archive without a clear signal that it's actually old. */
function closedYear(tx) {
  const raw = tx.next_date || tx.updated_at;
  const year = raw ? new Date(raw).getFullYear() : NaN;
  return Number.isNaN(year) ? new Date().getFullYear() : year;
}

/** The full pipeline + archive (closed, terminated, prior years) — rendered as
 * its own screen from App (All Deals button), not a swipe page. */
export function AllPage({ transactions, stages, currentAgent, onStageChange, onNotesChange, onCompsStatusChange, onAddTodo, onToggleTodo, onEditTodo, onDeleteTodo, onOpenDetail }) {
  const active = transactions.filter((tx) => !tx.terminated_at);
  const terminated = transactions.filter((tx) => tx.terminated_at && tx.stage !== "comps" && !isExpiredListing(tx));
  const expired = transactions.filter(isExpiredListing);
  const deadLeads = transactions.filter((tx) => tx.terminated_at && tx.stage === "comps");
  const currentYear = new Date().getFullYear();

  const allClosed = active.filter((tx) => tx.stage === "closed");
  const closedThisYear = allClosed.filter((tx) => closedYear(tx) >= currentYear);
  const closedPriorYears = allClosed.filter((tx) => closedYear(tx) < currentYear);
  const priorSellers = closedPriorYears.filter((tx) => tx.side === "Sell");
  const priorBuyers = closedPriorYears.filter((tx) => tx.side === "Buy");

  const buckets = [
    {
      key: "waiting",
      title: "Waiting to List",
      colorClass: "comps-section--waiting",
      items: active.filter((tx) => tx.stage === "comps" && tx.comps_status === "Waiting to List"),
    },
    {
      key: "comps",
      title: "Need to Send Comp",
      colorClass: "comps-section--need",
      items: active.filter((tx) => tx.stage === "comps" && tx.comps_status !== "Waiting to List"),
    },
    {
      key: "won",
      title: "Won Listing",
      colorClass: "comps-section--won",
      items: active.filter((tx) => tx.stage === "won"),
    },
    {
      key: "market",
      title: "Active Listings",
      colorClass: "comps-section--onmarket",
      items: active.filter((tx) => tx.stage === "market"),
    },
    {
      key: "contract",
      title: "Under Contract",
      colorClass: "comps-section--contract",
      items: active.filter((tx) => tx.stage === "contract"),
    },
    {
      key: "closed",
      title: "Closed",
      colorClass: "comps-section--closed",
      items: closedThisYear,
    },
    {
      key: "terminated",
      title: "Terminated",
      colorClass: "comps-section--terminated",
      items: terminated,
    },
    {
      key: "expired",
      title: "Expired Listings",
      colorClass: "comps-section--terminated",
      items: expired,
    },
    {
      key: "dead",
      title: "Dead/Lost",
      colorClass: "comps-section--dead",
      items: deadLeads,
    },
  ];

  const nothingAtAll = buckets.every((b) => b.items.length === 0) && closedPriorYears.length === 0;
  if (nothingAtAll) {
    return <p className="empty-state">No transactions yet.</p>;
  }

  return (
    <div className="comps-page">
      {buckets.map((b) => (
        <CollapsibleSection key={b.key} title={b.title} count={b.items.length} colorClass={b.colorClass}>
          <TransactionList
            transactions={b.items}
            stages={stages}
            currentAgent={currentAgent}
            onStageChange={onStageChange}
            onNotesChange={onNotesChange}
            onCompsStatusChange={b.key === "comps" || b.key === "waiting" ? onCompsStatusChange : undefined}
            onAddTodo={onAddTodo}
            onToggleTodo={onToggleTodo}
            onEditTodo={onEditTodo}
            onDeleteTodo={onDeleteTodo}
            onOpenDetail={onOpenDetail}
          />
        </CollapsibleSection>
      ))}

      <CollapsibleSection title="Prior Years" count={closedPriorYears.length} colorClass="comps-section--closed">
        {priorSellers.length > 0 && (
          <div className="timeframe-group">
            <h3 className="timeframe-group-title">
              Closed Sellers <span className="comps-section-count">{priorSellers.length}</span>
            </h3>
            <TransactionList
              transactions={priorSellers}
              stages={stages}
              currentAgent={currentAgent}
              onStageChange={onStageChange}
              onNotesChange={onNotesChange}
              onAddTodo={onAddTodo}
              onToggleTodo={onToggleTodo}
              onEditTodo={onEditTodo}
              onDeleteTodo={onDeleteTodo}
              onOpenDetail={onOpenDetail}
            />
          </div>
        )}
        {priorBuyers.length > 0 && (
          <div className="timeframe-group">
            <h3 className="timeframe-group-title">
              Closed Buyers <span className="comps-section-count">{priorBuyers.length}</span>
            </h3>
            <TransactionList
              transactions={priorBuyers}
              stages={stages}
              currentAgent={currentAgent}
              onStageChange={onStageChange}
              onNotesChange={onNotesChange}
              onAddTodo={onAddTodo}
              onToggleTodo={onToggleTodo}
              onEditTodo={onEditTodo}
              onDeleteTodo={onDeleteTodo}
              onOpenDetail={onOpenDetail}
            />
          </div>
        )}
      </CollapsibleSection>
    </div>
  );
}

function ActiveListingsPage({
  transactions,
  expiredListings = [],
  onRelist,
  stages,
  currentAgent,
  onStageChange,
  onNotesChange,
  onAddTodo,
  onToggleTodo,
  onEditTodo,
  onDeleteTodo,
  onOpenDetail,
}) {
  const privateListings = transactions.filter((tx) => tx.stage === "won");
  const onMarketAll = transactions.filter((tx) => tx.stage === "market");
  const onMarketLand = onMarketAll.filter((tx) => tx.property_style === "Land");
  const onMarket = onMarketAll.filter((tx) => tx.property_style !== "Land");
  const [privateCollapsed, setPrivateCollapsed] = useAutoCollapse(privateListings.length);
  const [onMarketCollapsed, setOnMarketCollapsed] = useAutoCollapse(onMarket.length);
  const [landCollapsed, setLandCollapsed] = useAutoCollapse(onMarketLand.length);
  const [activeFilter, setActiveFilter] = useState(null); // null | "signs" | "social"
  const [expiredCollapsed, setExpiredCollapsed] = useState(true);
  const sortedExpired = [...expiredListings].sort((a, b) => String(b.terminated_at).localeCompare(String(a.terminated_at)));

  return (
    <div className="comps-page">
      <div className="listing-filter-toggles">
        {currentAgent?.role !== "coordinator" && (
          <button title="See which listings need a sign"
            type="button"
            className="sign-inventory-toggle"
            onClick={() => setActiveFilter((f) => (f === "signs" ? null : "signs"))}
          >
            <Signpost size={14} /> {activeFilter === "signs" ? "Back to Listings" : "Sign Inventory"}
          </button>
        )}
        {/* Brokers only (Fran + Holly — Holly runs the social rotation).
            Agents and the TC never see the social schedule; checking the
            role is what hides it in "View as Agent" / "TC View" too. */}
        {currentAgent?.role === "broker" && (
          <button title="See where each listing is in the social media rotation"
            type="button"
            className="sign-inventory-toggle"
            onClick={() => setActiveFilter((f) => (f === "social" ? null : "social"))}
          >
            {activeFilter === "social" ? "Back to Listings" : "Social Rotation"}
          </button>
        )}
      </div>

      {activeFilter === "signs" ? (
        <SignInventory transactions={[...privateListings, ...onMarketAll]} onOpenDetail={onOpenDetail} />
      ) : activeFilter === "social" ? (
        <SocialRotationFilter transactions={[...privateListings, ...onMarketAll]} onOpenDetail={onOpenDetail} />
      ) : (
        <>
          <div className="comps-section comps-section--private">
            <div className="comps-section-header">
              <h2 className="comps-section-title">
                Private Listing <span className="comps-section-count">{privateListings.length}</span>
              </h2>
              <button title={privateCollapsed ? "Show this section" : "Collapse this section"} type="button" className="comps-minimize-btn" onClick={() => setPrivateCollapsed((c) => !c)}>
                {privateCollapsed ? "Show" : "Minimize"}
              </button>
            </div>
            {!privateCollapsed && (
              <>
                <p className="field-help">Not live yet — still gathering documents.</p>
                <TransactionList
                  transactions={privateListings}
                  stages={stages}
                  currentAgent={currentAgent}
                  onStageChange={onStageChange}
                  onNotesChange={onNotesChange}
                  onAddTodo={onAddTodo}
                  onToggleTodo={onToggleTodo}
                  onEditTodo={onEditTodo}
                  onDeleteTodo={onDeleteTodo}
                  onOpenDetail={onOpenDetail}
                />
              </>
            )}
          </div>

          <div className="comps-section comps-section--onmarket">
            <div className="comps-section-header">
              <h2 className="comps-section-title">
                On Market <span className="comps-section-count">{onMarket.length}</span>
              </h2>
              <button title={onMarketCollapsed ? "Show this section" : "Collapse this section"} type="button" className="comps-minimize-btn" onClick={() => setOnMarketCollapsed((c) => !c)}>
                {onMarketCollapsed ? "Show" : "Minimize"}
              </button>
            </div>
            {!onMarketCollapsed && (
              <TransactionList
                transactions={onMarket}
                stages={stages}
                currentAgent={currentAgent}
                onStageChange={onStageChange}
                onNotesChange={onNotesChange}
                onAddTodo={onAddTodo}
                onToggleTodo={onToggleTodo}
                onEditTodo={onEditTodo}
                onDeleteTodo={onDeleteTodo}
                onOpenDetail={onOpenDetail}
              />
            )}
          </div>

          <div className="comps-section comps-section--waiting">
            <div className="comps-section-header">
              <h2 className="comps-section-title">
                Land <span className="comps-section-count">{onMarketLand.length}</span>
              </h2>
              <button title={landCollapsed ? "Show this section" : "Collapse this section"} type="button" className="comps-minimize-btn" onClick={() => setLandCollapsed((c) => !c)}>
                {landCollapsed ? "Show" : "Minimize"}
              </button>
            </div>
            {!landCollapsed && (
              <TransactionList
                transactions={onMarketLand}
                stages={stages}
                currentAgent={currentAgent}
                onStageChange={onStageChange}
                onNotesChange={onNotesChange}
                onAddTodo={onAddTodo}
                onToggleTodo={onToggleTodo}
                onEditTodo={onEditTodo}
                onDeleteTodo={onDeleteTodo}
                onOpenDetail={onOpenDetail}
              />
            )}
          </div>
        </>
      )}
      {!activeFilter && sortedExpired.length > 0 && (
        <div className="comps-section comps-section--dead">
          <div className="comps-section-header">
            <h2 className="comps-section-title">
              ⏳ Expired <span className="comps-section-count">{sortedExpired.length}</span>
            </h2>
            <button title={expiredCollapsed ? "Show this section" : "Collapse this section"} type="button" className="comps-minimize-btn" onClick={() => setExpiredCollapsed((c) => !c)}>
              {expiredCollapsed ? "Show" : "Minimize"}
            </button>
          </div>
          {!expiredCollapsed && (
            <ul className="dead-lead-list">
              {sortedExpired.map((tx) => (
                <li key={tx.id}>
                  <button type="button" className="dead-lead-main" onClick={() => onOpenDetail(tx)} title="Open this listing">
                    <span className="tx-address">{tx.address}</span>
                    <span className="tx-sub">
                      {[tx.town, tx.agent?.name, `expired ${new Date(tx.terminated_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`]
                        .filter(Boolean)
                        .join(" · ")}
                      {tx.termination_reason && tx.termination_reason !== EXPIRED_REASON ? ` — ${tx.termination_reason.slice(EXPIRED_REASON.length).replace(/^:\s*/, "")}` : ""}
                    </span>
                  </button>
                  {onRelist && (
                    <button type="button" className="comps-status-btn" onClick={() => onRelist(tx)} title="Seller re-signed — put it back on the active pages">
                      Relist
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

const SIGN_GROUPS = [
  {
    key: "need",
    title: "Need Sign",
    colorClass: "sign-inventory--need",
    match: (tx) => tx.sign_status !== "Yes" && tx.sign_status !== "Seller Declined",
  },
  { key: "installed", title: "Sign Installed", colorClass: "sign-inventory--installed", match: (tx) => tx.sign_status === "Yes" },
  { key: "declined", title: "Seller Declined", colorClass: "sign-inventory--declined", match: (tx) => tx.sign_status === "Seller Declined" },
];

function SignInventory({ transactions, onOpenDetail }) {
  const groups = SIGN_GROUPS.map((g) => ({ ...g, items: transactions.filter(g.match) }));

  if (transactions.length === 0) {
    return <p className="empty-state">No active listings yet.</p>;
  }

  return (
    <div className="sign-inventory">
      <div className="sign-inventory-summary">
        {groups.map((g) => (
          <div key={g.key} className={`sign-inventory-stat ${g.colorClass}`}>
            <span className="sign-inventory-stat-count">{g.items.length}</span>
            <span className="sign-inventory-stat-label">{g.title}</span>
          </div>
        ))}
      </div>

      {groups.map(
        (g) =>
          g.items.length > 0 && (
            <div key={g.key} className="sign-inventory-group">
              <h3 className="timeframe-group-title">
                {g.title} <span className="comps-section-count">{g.items.length}</span>
              </h3>
              <ul className="sign-inventory-list">
                {g.items.map((tx) => (
                  <li key={tx.id} onClick={() => onOpenDetail(tx)}>
                    <span className="tx-address">{tx.address}</span>
                    <span className="tx-sub">{tx.town}</span>
                  </li>
                ))}
              </ul>
            </div>
          )
      )}
    </div>
  );
}

const SOCIAL_RECENCY_DAYS = 14;
const SOCIAL_GROUPS = [
  {
    key: "never",
    title: "Never Posted",
    colorClass: "sign-inventory--declined", // red — most urgent
    // Private (Won, not yet On Market) listings can't be posted about publicly yet,
    // so they don't belong in a "never posted" bucket meant to flag what to prioritize.
    match: (tx) => tx.stage !== "won" && !tx.social_last_posted_at,
  },
  {
    key: "overdue",
    title: `Posted ${SOCIAL_RECENCY_DAYS}+ Days Ago`,
    colorClass: "sign-inventory--need", // blue
    match: (tx) =>
      tx.social_last_posted_at && Date.now() - new Date(tx.social_last_posted_at).getTime() >= SOCIAL_RECENCY_DAYS * 86400000,
  },
  {
    key: "fresh",
    title: "Posted Recently",
    colorClass: "sign-inventory--installed", // green — leave it alone, don't overexpose
    match: (tx) =>
      tx.social_last_posted_at && Date.now() - new Date(tx.social_last_posted_at).getTime() < SOCIAL_RECENCY_DAYS * 86400000,
  },
];

/** Read-only quick check-in for the social rotation, mirroring SignInventory — actually
 * marking something posted only happens from the broker-only Social Scheduler screen, so
 * there's a single source of truth for that write instead of two. */
function SocialRotationFilter({ transactions, onOpenDetail }) {
  const groups = SOCIAL_GROUPS.map((g) => ({ ...g, items: transactions.filter(g.match) }));

  if (transactions.length === 0) {
    return <p className="empty-state">No active listings yet.</p>;
  }

  return (
    <div className="sign-inventory">
      <div className="sign-inventory-summary">
        {groups.map((g) => (
          <div key={g.key} className={`sign-inventory-stat ${g.colorClass}`}>
            <span className="sign-inventory-stat-count">{g.items.length}</span>
            <span className="sign-inventory-stat-label">{g.title}</span>
          </div>
        ))}
      </div>

      {groups.map(
        (g) =>
          g.items.length > 0 && (
            <div key={g.key} className="sign-inventory-group">
              <h3 className="timeframe-group-title">
                {g.title} <span className="comps-section-count">{g.items.length}</span>
              </h3>
              <ul className="sign-inventory-list">
                {g.items.map((tx) => (
                  <li key={tx.id} onClick={() => onOpenDetail(tx)}>
                    <span className="tx-address">{tx.address}</span>
                    <span className="tx-sub">{tx.town}</span>
                  </li>
                ))}
              </ul>
            </div>
          )
      )}
    </div>
  );
}

function UnderContractPage({ transactions: allTransactions, stages, currentAgent, onStageChange, onNotesChange, onAddTodo, onToggleTodo, onEditTodo, onDeleteTodo, onOpenDetail }) {
  // Broker/TC only — everyone else only ever sees their own deals anyway.
  const canFilterByAgent = currentAgent?.role === "broker" || currentAgent?.role === "coordinator";
  const [agentFilter, setAgentFilter] = useState(null); // agent id, or null = everyone
  const roster = useMentionRoster();
  // Co-listed deals count (and filter) under both agents.
  const agentCounts = useMemo(() => {
    const byId = new Map();
    const bump = (id, name) => {
      const entry = byId.get(id) || { id, name: name || roster.find((a) => a.id === id)?.name || "Unknown", count: 0 };
      entry.count++;
      byId.set(id, entry);
    };
    for (const tx of allTransactions) {
      if (tx.agent_id) bump(tx.agent_id, tx.agent?.name);
      if (tx.colist_agent_id && tx.colist_agent_id !== tx.agent_id) bump(tx.colist_agent_id);
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [allTransactions, roster]);
  // If the picked agent no longer has any deals here, fall back to everyone.
  const activeFilter = agentFilter && agentCounts.some((a) => a.id === agentFilter) ? agentFilter : null;
  const transactions = canFilterByAgent && activeFilter ? allTransactions.filter((tx) => tx.agent_id === activeFilter || tx.colist_agent_id === activeFilter) : allTransactions;
  // Split deals go wherever *our* clients are (split_client_side, asked on the
  // Under Contract form) — Sellers if that hasn't been answered yet.
  const isBuyerGroup = (tx) => tx.side === "Buy" || (tx.side === "Split" && tx.split_client_side === "Buy");
  const sellers = transactions.filter((tx) => !isBuyerGroup(tx));
  const buyers = transactions.filter(isBuyerGroup);
  const [sellersCollapsed, setSellersCollapsed] = useAutoCollapse(sellers.length);
  const [buyersCollapsed, setBuyersCollapsed] = useAutoCollapse(buyers.length);

  return (
    <div className="comps-page">
      {canFilterByAgent && agentCounts.length > 1 && (
        <div className="agent-filter-chips" role="group" aria-label="Filter by agent">
          <button title="Show every agent's deals"
            type="button"
            className={`agent-filter-chip${activeFilter ? "" : " agent-filter-chip--active"}`}
            onClick={() => setAgentFilter(null)}
          >
            All <span className="agent-filter-chip-count">{allTransactions.length}</span>
          </button>
          {agentCounts.map((a) => (
            <button title={`Show only ${a.name}'s deals`}
              key={a.id}
              type="button"
              className={`agent-filter-chip${activeFilter === a.id ? " agent-filter-chip--active" : ""}`}
              onClick={() => setAgentFilter(activeFilter === a.id ? null : a.id)}
            >
              {a.name.split(" ")[0]} <span className="agent-filter-chip-count">{a.count}</span>
            </button>
          ))}
        </div>
      )}

      <div className="comps-section comps-section--sellers">
        <div className="comps-section-header">
          <h2 className="comps-section-title">
            Sellers <span className="comps-section-count">{sellers.length}</span>
          </h2>
          <button title={sellersCollapsed ? "Show this section" : "Collapse this section"} type="button" className="comps-minimize-btn" onClick={() => setSellersCollapsed((c) => !c)}>
            {sellersCollapsed ? "Show" : "Minimize"}
          </button>
        </div>
        {!sellersCollapsed && (
          <TransactionList
            transactions={sellers}
            stages={stages}
            currentAgent={currentAgent}
            onStageChange={onStageChange}
            onNotesChange={onNotesChange}
            onAddTodo={onAddTodo}
            onToggleTodo={onToggleTodo}
            onEditTodo={onEditTodo}
            onDeleteTodo={onDeleteTodo}
            onOpenDetail={onOpenDetail}
          />
        )}
      </div>

      <div className="comps-section comps-section--buyers">
        <div className="comps-section-header">
          <h2 className="comps-section-title">
            Buyers <span className="comps-section-count">{buyers.length}</span>
          </h2>
          <button title={buyersCollapsed ? "Show this section" : "Collapse this section"} type="button" className="comps-minimize-btn" onClick={() => setBuyersCollapsed((c) => !c)}>
            {buyersCollapsed ? "Show" : "Minimize"}
          </button>
        </div>
        {!buyersCollapsed && (
          <TransactionList
            transactions={buyers}
            stages={stages}
            currentAgent={currentAgent}
            onStageChange={onStageChange}
            onNotesChange={onNotesChange}
            onAddTodo={onAddTodo}
            onToggleTodo={onToggleTodo}
            onEditTodo={onEditTodo}
            onDeleteTodo={onDeleteTodo}
            onOpenDetail={onOpenDetail}
          />
        )}
      </div>
    </div>
  );
}

function CompsPage({
  transactions,
  deadLeads = [],
  onDeadLead,
  onReviveLead,
  stages,
  currentAgent,
  onStageChange,
  onNotesChange,
  onCompsStatusChange,
  onAddTodo,
  onToggleTodo,
  onEditTodo,
  onDeleteTodo,
  onOpenDetail,
}) {
  const needToSend = transactions.filter((tx) => tx.stage === "comps" && tx.comps_status !== "Waiting to List");
  const waitingToList = transactions.filter((tx) => tx.stage === "comps" && tx.comps_status === "Waiting to List");
  const wonListings = transactions.filter((tx) => tx.stage === "won");
  const [needCollapsed, setNeedCollapsed] = useAutoCollapse(needToSend.length);
  const [wonCollapsed, setWonCollapsed] = useAutoCollapse(wonListings.length);
  const [waitingCollapsed, setWaitingCollapsed] = useState(false);
  const [deadCollapsed, setDeadCollapsed] = useState(true);
  const [confirmDeadTx, setConfirmDeadTx] = useState(null);
  const askDeadLead = onDeadLead ? (tx) => setConfirmDeadTx(tx) : undefined;
  const sortedDead = [...deadLeads].sort((a, b) => String(b.terminated_at).localeCompare(String(a.terminated_at)));

  return (
    <div className="comps-page">
      <ConfirmDialog
        open={Boolean(confirmDeadTx)}
        title="Dead/Lost? 🪦"
        message={confirmDeadTx ? `${confirmDeadTx.address} gets laid to rest in Dead/Lost at the bottom of this page. You can revive it anytime.` : ""}
        confirmLabel="Dead/Lost"
        promptLabel="What happened? (optional)"
        promptPlaceholder="e.g. Listed with another brokerage, decided not to sell…"
        onConfirm={(reason) => {
          const tx = confirmDeadTx;
          setConfirmDeadTx(null);
          onDeadLead(tx, reason);
        }}
        onCancel={() => setConfirmDeadTx(null)}
      />
      <div className="comps-section comps-section--need">
        <div className="comps-section-header">
          <h2 className="comps-section-title">
            Need to Send Comp <span className="comps-section-count">{needToSend.length}</span>
          </h2>
          <button title={needCollapsed ? "Show this section" : "Collapse this section"} type="button" className="comps-minimize-btn" onClick={() => setNeedCollapsed((c) => !c)}>
            {needCollapsed ? "Show" : "Minimize"}
          </button>
        </div>
        {!needCollapsed && (
          <TransactionList
            transactions={needToSend}
            stages={stages}
            currentAgent={currentAgent}
            onStageChange={onStageChange}
            onNotesChange={onNotesChange}
            onCompsStatusChange={onCompsStatusChange}
            onDeadLead={askDeadLead}
            onOpenDetail={onOpenDetail}
          />
        )}
      </div>

      <div className="comps-section comps-section--won">
        <div className="comps-section-header">
          <h2 className="comps-section-title">
            Won Listing <span className="comps-section-count">{wonListings.length}</span>
          </h2>
          <button title={wonCollapsed ? "Show this section" : "Collapse this section"} type="button" className="comps-minimize-btn" onClick={() => setWonCollapsed((c) => !c)}>
            {wonCollapsed ? "Show" : "Minimize"}
          </button>
        </div>
        {!wonCollapsed && (
          <TransactionList
            transactions={wonListings}
            stages={stages}
            currentAgent={currentAgent}
            onStageChange={onStageChange}
            onNotesChange={onNotesChange}
            onAddTodo={onAddTodo}
            onToggleTodo={onToggleTodo}
            onEditTodo={onEditTodo}
            onDeleteTodo={onDeleteTodo}
            onOpenDetail={onOpenDetail}
          />
        )}
      </div>

      <div className="comps-section comps-section--waiting">
        <div className="comps-section-header">
          <h2 className="comps-section-title">
            Waiting to List <span className="comps-section-count">{waitingToList.length}</span>
          </h2>
          <button title={waitingCollapsed ? "Show this section" : "Collapse this section"} type="button" className="comps-minimize-btn" onClick={() => setWaitingCollapsed((c) => !c)}>
            {waitingCollapsed ? "Show" : "Minimize"}
          </button>
        </div>
        {!waitingCollapsed && (
          <TimeframeGroups
            transactions={waitingToList}
            stages={stages}
            currentAgent={currentAgent}
            onStageChange={onStageChange}
            onNotesChange={onNotesChange}
            onCompsStatusChange={onCompsStatusChange}
            onDeadLead={askDeadLead}
            onOpenDetail={onOpenDetail}
          />
        )}
      </div>
      {sortedDead.length > 0 && (
        <div className="comps-section comps-section--dead">
          <div className="comps-section-header">
            <h2 className="comps-section-title">
              <Tombstone size={18} /> Dead/Lost <span className="comps-section-count">{sortedDead.length}</span>
            </h2>
            <button title={deadCollapsed ? "Show this section" : "Collapse this section"} type="button" className="comps-minimize-btn" onClick={() => setDeadCollapsed((c) => !c)}>
              {deadCollapsed ? "Show" : "Minimize"}
            </button>
          </div>
          {!deadCollapsed && (
            <ul className="dead-lead-list">
              {sortedDead.map((tx) => (
                <li key={tx.id}>
                  <button type="button" className="dead-lead-main" onClick={() => onOpenDetail(tx)} title="Open this comp">
                    <span className="tx-address">{tx.address}</span>
                    <span className="tx-sub">
                      {[tx.town, tx.agent?.name, tx.terminated_at ? new Date(tx.terminated_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null]
                        .filter(Boolean)
                        .join(" · ")}
                      {tx.termination_reason && tx.termination_reason !== "Dead lead" ? ` — ${tx.termination_reason.replace(/^Dead lead:\s*/, "")}` : ""}
                    </span>
                  </button>
                  {onReviveLead && (
                    <button type="button" className="comps-status-btn" onClick={() => onReviveLead(tx)} title="Bring this comp back to the active comps">
                      Revive
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

const TIMEFRAME_ORDER = ["Now", "6 months", "Next year"];

function TimeframeGroups({ transactions, stages, currentAgent, onStageChange, onNotesChange, onCompsStatusChange, onOpenDetail, onDeadLead }) {
  const groups = [
    ...TIMEFRAME_ORDER.map((tf) => ({ label: tf, items: transactions.filter((tx) => tx.timeframe === tf) })),
    { label: "No Timeframe Set", items: transactions.filter((tx) => !TIMEFRAME_ORDER.includes(tx.timeframe)) },
  ].filter((g) => g.items.length > 0);

  if (groups.length <= 1) {
    return (
      <TransactionList
        transactions={transactions}
        stages={stages}
        currentAgent={currentAgent}
        onStageChange={onStageChange}
        onNotesChange={onNotesChange}
        onCompsStatusChange={onCompsStatusChange}
        onDeadLead={onDeadLead}
        onOpenDetail={onOpenDetail}
      />
    );
  }

  return (
    <>
      {groups.map((g) => (
        <div key={g.label} className="timeframe-group">
          <h3 className="timeframe-group-title">
            {g.label} <span className="comps-section-count">{g.items.length}</span>
          </h3>
          <TransactionList
            transactions={g.items}
            stages={stages}
            currentAgent={currentAgent}
            onStageChange={onStageChange}
            onNotesChange={onNotesChange}
            onCompsStatusChange={onCompsStatusChange}
            onDeadLead={onDeadLead}
        onDeadLead={onDeadLead}
            onOpenDetail={onOpenDetail}
          />
        </div>
      ))}
    </>
  );
}
