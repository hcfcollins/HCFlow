import { useRef, useState } from "react";
import { Search, X } from "lucide-react";
import TransactionList from "./TransactionList";

export const PAGES = [
  { key: "comps", label: "Comps / Limbo", match: (tx) => tx.stage === "comps" },
  { key: "active", label: "Active Listings", match: (tx) => tx.stage === "won" || tx.stage === "market" },
  { key: "contract", label: "Under Contract", match: (tx) => tx.stage === "contract" },
  { key: "all", label: "All", match: () => true },
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
  onOpenDetail,
  pageIndex,
  onPageIndexChange,
  searchQuery,
  onSearchChange,
  isSearching,
  searchResults,
  onNewComp,
  onNewUnderContract,
}) {
  const [dragOffset, setDragOffset] = useState(0);
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
          const count = activeTransactions.filter(p.match).length;
          return (
            <button
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

      <div className="search-bar">
        <Search size={16} className="search-bar-icon" />
        <input
          type="text"
          className="search-bar-input"
          placeholder="Search by address or last name…"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
        />
        {isSearching && (
          <button
            type="button"
            className="search-bar-clear"
            onClick={() => onSearchChange("")}
            aria-label="Clear search"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {/* Active Listings only ever contains real listing cards, each with its own
          stage dropdown that opens the Under Contract form pre-filled with that
          listing's details — a blank "+ Under Contract" button here would just
          invite a manually-typed, possibly mismatched or duplicate address. */}
      {currentPageKey !== "active" && (onNewComp || onNewUnderContract) && (
        <button
          className={`google-btn uc-launch ${onCompsPage ? "uc-launch--comps" : "uc-launch--contract"}`}
          onClick={() => (onCompsPage ? onNewComp() : onNewUnderContract())}
        >
          {onCompsPage ? "+ New Comp" : "+ Under Contract"}
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
                      stages={stages}
                      currentAgent={currentAgent}
                      onStageChange={onStageChange}
                      onNotesChange={onNotesChange}
                      onCompsStatusChange={onCompsStatusChange}
                      onAddTodo={onAddTodo}
                      onToggleTodo={onToggleTodo}
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
                      onOpenDetail={onOpenDetail}
                    />
                  ) : p.key === "active" ? (
                    <ActiveListingsPage
                      transactions={activeTransactions.filter(p.match)}
                      stages={stages}
                      currentAgent={currentAgent}
                      onStageChange={onStageChange}
                      onNotesChange={onNotesChange}
                      onAddTodo={onAddTodo}
                      onToggleTodo={onToggleTodo}
                      onOpenDetail={onOpenDetail}
                    />
                  ) : (
                    <AllPage
                      transactions={transactions}
                      stages={stages}
                      currentAgent={currentAgent}
                      onStageChange={onStageChange}
                      onNotesChange={onNotesChange}
                      onCompsStatusChange={onCompsStatusChange}
                      onAddTodo={onAddTodo}
                      onToggleTodo={onToggleTodo}
                      onOpenDetail={onOpenDetail}
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** A collapsible bucket, minimized by default — used throughout the All page so a
 * full pipeline overview doesn't turn into one giant scroll. */
function CollapsibleSection({ title, count, colorClass, children }) {
  const [collapsed, setCollapsed] = useState(true);
  if (count === 0) return null;
  return (
    <div className={`comps-section ${colorClass}`}>
      <div className="comps-section-header">
        <h2 className="comps-section-title">
          {title} <span className="comps-section-count">{count}</span>
        </h2>
        <button type="button" className="comps-minimize-btn" onClick={() => setCollapsed((c) => !c)}>
          {collapsed ? "Show" : "Minimize"}
        </button>
      </div>
      {!collapsed && children}
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

function AllPage({ transactions, stages, currentAgent, onStageChange, onNotesChange, onCompsStatusChange, onAddTodo, onToggleTodo, onOpenDetail }) {
  const active = transactions.filter((tx) => !tx.terminated_at);
  const terminated = transactions.filter((tx) => tx.terminated_at);
  const currentYear = new Date().getFullYear();

  const allClosed = active.filter((tx) => tx.stage === "closed");
  const closedThisYear = allClosed.filter((tx) => closedYear(tx) >= currentYear);
  const closedPriorYears = allClosed.filter((tx) => closedYear(tx) < currentYear);
  const priorSellers = closedPriorYears.filter((tx) => tx.side === "Sell");
  const priorBuyers = closedPriorYears.filter((tx) => tx.side === "Buy");

  const buckets = [
    {
      key: "comps",
      title: "Comps",
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
      key: "waiting",
      title: "Waiting to List",
      colorClass: "comps-section--waiting",
      items: active.filter((tx) => tx.stage === "comps" && tx.comps_status === "Waiting to List"),
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
  stages,
  currentAgent,
  onStageChange,
  onNotesChange,
  onAddTodo,
  onToggleTodo,
  onOpenDetail,
}) {
  const privateListings = transactions.filter((tx) => tx.stage === "won");
  const onMarket = transactions.filter((tx) => tx.stage === "market");
  const [privateCollapsed, setPrivateCollapsed] = useState(privateListings.length === 0);

  return (
    <div className="comps-page">
      <div className="comps-section comps-section--private">
        <div className="comps-section-header">
          <h2 className="comps-section-title">
            Private Listing <span className="comps-section-count">{privateListings.length}</span>
          </h2>
          <button type="button" className="comps-minimize-btn" onClick={() => setPrivateCollapsed((c) => !c)}>
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
              onOpenDetail={onOpenDetail}
            />
          </>
        )}
      </div>

      <div className="comps-section comps-section--onmarket">
        <h2 className="comps-section-title">
          On Market <span className="comps-section-count">{onMarket.length}</span>
        </h2>
        <TransactionList
          transactions={onMarket}
          stages={stages}
          currentAgent={currentAgent}
          onStageChange={onStageChange}
          onNotesChange={onNotesChange}
          onAddTodo={onAddTodo}
          onToggleTodo={onToggleTodo}
          onOpenDetail={onOpenDetail}
        />
      </div>
    </div>
  );
}

function UnderContractPage({ transactions, stages, currentAgent, onStageChange, onNotesChange, onAddTodo, onToggleTodo, onOpenDetail }) {
  const sellers = transactions.filter((tx) => tx.side === "Sell");
  const buyers = transactions.filter((tx) => tx.side === "Buy");

  return (
    <div className="comps-page">
      <div className="comps-section comps-section--sellers">
        <h2 className="comps-section-title">
          Sellers <span className="comps-section-count">{sellers.length}</span>
        </h2>
        <TransactionList
          transactions={sellers}
          stages={stages}
          currentAgent={currentAgent}
          onStageChange={onStageChange}
          onNotesChange={onNotesChange}
          onAddTodo={onAddTodo}
          onToggleTodo={onToggleTodo}
          onOpenDetail={onOpenDetail}
        />
      </div>

      <div className="comps-section comps-section--buyers">
        <h2 className="comps-section-title">
          Buyers <span className="comps-section-count">{buyers.length}</span>
        </h2>
        <TransactionList
          transactions={buyers}
          stages={stages}
          currentAgent={currentAgent}
          onStageChange={onStageChange}
          onNotesChange={onNotesChange}
          onAddTodo={onAddTodo}
          onToggleTodo={onToggleTodo}
          onOpenDetail={onOpenDetail}
        />
      </div>
    </div>
  );
}

function CompsPage({
  transactions,
  stages,
  currentAgent,
  onStageChange,
  onNotesChange,
  onCompsStatusChange,
  onAddTodo,
  onToggleTodo,
  onOpenDetail,
}) {
  const [waitingCollapsed, setWaitingCollapsed] = useState(false);

  const needToSend = transactions.filter((tx) => tx.stage === "comps" && tx.comps_status !== "Waiting to List");
  const waitingToList = transactions.filter((tx) => tx.stage === "comps" && tx.comps_status === "Waiting to List");
  const wonListings = transactions.filter((tx) => tx.stage === "won");

  return (
    <div className="comps-page">
      <div className="comps-section comps-section--need">
        <h2 className="comps-section-title">
          Need to Send Comp <span className="comps-section-count">{needToSend.length}</span>
        </h2>
        <TransactionList
          transactions={needToSend}
          stages={stages}
          currentAgent={currentAgent}
          onStageChange={onStageChange}
          onNotesChange={onNotesChange}
          onCompsStatusChange={onCompsStatusChange}
          onOpenDetail={onOpenDetail}
        />
      </div>

      <div className="comps-section comps-section--won">
        <h2 className="comps-section-title">
          Won Listing <span className="comps-section-count">{wonListings.length}</span>
        </h2>
        <TransactionList
          transactions={wonListings}
          stages={stages}
          currentAgent={currentAgent}
          onStageChange={onStageChange}
          onNotesChange={onNotesChange}
          onAddTodo={onAddTodo}
          onToggleTodo={onToggleTodo}
          onOpenDetail={onOpenDetail}
        />
      </div>

      <div className="comps-section comps-section--waiting">
        <div className="comps-section-header">
          <h2 className="comps-section-title">
            Waiting to List <span className="comps-section-count">{waitingToList.length}</span>
          </h2>
          <button type="button" className="comps-minimize-btn" onClick={() => setWaitingCollapsed((c) => !c)}>
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
            onOpenDetail={onOpenDetail}
          />
        )}
      </div>
    </div>
  );
}

const TIMEFRAME_ORDER = ["Now", "6 months", "Next year"];

function TimeframeGroups({ transactions, stages, currentAgent, onStageChange, onNotesChange, onCompsStatusChange, onOpenDetail }) {
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
            onOpenDetail={onOpenDetail}
          />
        </div>
      ))}
    </>
  );
}
