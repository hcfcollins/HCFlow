import { useEffect, useRef, useState } from "react";
import { Search, X, Signpost } from "lucide-react";
import TransactionList from "./TransactionList";

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

      {/* Active Listings and All only ever contain cards for deals that already
          exist, each with its own stage dropdown that opens the Under Contract
          form pre-filled with that deal's details — a blank "+ Under Contract"
          button here would just invite a manually-typed, possibly mismatched or
          duplicate address. */}
      {currentPageKey !== "active" && currentPageKey !== "all" && (onNewComp || onNewUnderContract) && (
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
                    <AllPage
                      transactions={transactions}
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

function AllPage({ transactions, stages, currentAgent, onStageChange, onNotesChange, onCompsStatusChange, onAddTodo, onToggleTodo, onEditTodo, onDeleteTodo, onOpenDetail }) {
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

  return (
    <div className="comps-page">
      <div className="listing-filter-toggles">
        <button
          type="button"
          className="sign-inventory-toggle"
          onClick={() => setActiveFilter((f) => (f === "signs" ? null : "signs"))}
        >
          <Signpost size={14} /> {activeFilter === "signs" ? "Back to Listings" : "Sign Inventory"}
        </button>
        <button
          type="button"
          className="sign-inventory-toggle"
          onClick={() => setActiveFilter((f) => (f === "social" ? null : "social"))}
        >
          {activeFilter === "social" ? "Back to Listings" : "Social Rotation"}
        </button>
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
              <button type="button" className="comps-minimize-btn" onClick={() => setOnMarketCollapsed((c) => !c)}>
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
              <button type="button" className="comps-minimize-btn" onClick={() => setLandCollapsed((c) => !c)}>
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

const SOCIAL_GROUPS = [
  {
    key: "never",
    title: "Never Posted",
    colorClass: "sign-inventory--need",
    match: (tx) => !tx.social_last_posted_at,
  },
  {
    key: "overdue",
    title: "Posted 7+ Days Ago",
    colorClass: "sign-inventory--declined",
    match: (tx) => tx.social_last_posted_at && Date.now() - new Date(tx.social_last_posted_at).getTime() >= 7 * 86400000,
  },
  {
    key: "fresh",
    title: "Posted This Week",
    colorClass: "sign-inventory--installed",
    match: (tx) => tx.social_last_posted_at && Date.now() - new Date(tx.social_last_posted_at).getTime() < 7 * 86400000,
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

function UnderContractPage({ transactions, stages, currentAgent, onStageChange, onNotesChange, onAddTodo, onToggleTodo, onEditTodo, onDeleteTodo, onOpenDetail }) {
  const sellers = transactions.filter((tx) => tx.side === "Sell");
  const buyers = transactions.filter((tx) => tx.side === "Buy");
  const [sellersCollapsed, setSellersCollapsed] = useAutoCollapse(sellers.length);
  const [buyersCollapsed, setBuyersCollapsed] = useAutoCollapse(buyers.length);

  return (
    <div className="comps-page">
      <div className="comps-section comps-section--sellers">
        <div className="comps-section-header">
          <h2 className="comps-section-title">
            Sellers <span className="comps-section-count">{sellers.length}</span>
          </h2>
          <button type="button" className="comps-minimize-btn" onClick={() => setSellersCollapsed((c) => !c)}>
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
          <button type="button" className="comps-minimize-btn" onClick={() => setBuyersCollapsed((c) => !c)}>
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

  return (
    <div className="comps-page">
      <div className="comps-section comps-section--need">
        <div className="comps-section-header">
          <h2 className="comps-section-title">
            Need to Send Comp <span className="comps-section-count">{needToSend.length}</span>
          </h2>
          <button type="button" className="comps-minimize-btn" onClick={() => setNeedCollapsed((c) => !c)}>
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
            onOpenDetail={onOpenDetail}
          />
        )}
      </div>

      <div className="comps-section comps-section--won">
        <div className="comps-section-header">
          <h2 className="comps-section-title">
            Won Listing <span className="comps-section-count">{wonListings.length}</span>
          </h2>
          <button type="button" className="comps-minimize-btn" onClick={() => setWonCollapsed((c) => !c)}>
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
