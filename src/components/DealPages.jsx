import { useRef, useState } from "react";
import TransactionList from "./TransactionList";

export const PAGES = [
  { key: "comps", label: "Comps", match: (tx) => tx.stage === "comps" },
  { key: "active", label: "Active", match: (tx) => tx.stage === "won" || tx.stage === "market" },
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
  pageIndex,
  onPageIndexChange,
}) {
  const [dragOffset, setDragOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const touchStart = useRef(null);
  const intent = useRef(null);
  const viewportRef = useRef(null);

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

  return (
    <div className="deal-pages">
      <div className="deal-pages-tabs">
        {PAGES.map((p, i) => {
          const count = transactions.filter(p.match).length;
          return (
            <button
              key={p.key}
              type="button"
              className={`deal-pages-tab ${i === pageIndex ? "active" : ""}`}
              onClick={() => onPageIndexChange(i)}
            >
              {p.label}
              <span className="deal-pages-tab-count">{count}</span>
            </button>
          );
        })}
      </div>

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
                    transactions={transactions.filter(p.match)}
                    stages={stages}
                    currentAgent={currentAgent}
                    onStageChange={onStageChange}
                    onNotesChange={onNotesChange}
                    onCompsStatusChange={onCompsStatusChange}
                  />
                ) : (
                  <TransactionList
                    transactions={transactions.filter(p.match)}
                    stages={stages}
                    currentAgent={currentAgent}
                    onStageChange={onStageChange}
                    onNotesChange={onNotesChange}
                    onCompsStatusChange={onCompsStatusChange}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CompsPage({ transactions, stages, currentAgent, onStageChange, onNotesChange, onCompsStatusChange }) {
  const followUp = transactions.filter((tx) => tx.comps_status === "Follow-up");
  const waitingToList = transactions.filter((tx) => tx.comps_status !== "Follow-up");

  return (
    <div className="comps-page">
      <div className="comps-section">
        <h2 className="comps-section-title">Waiting to List</h2>
        <TransactionList
          transactions={waitingToList}
          stages={stages}
          currentAgent={currentAgent}
          onStageChange={onStageChange}
          onNotesChange={onNotesChange}
          onCompsStatusChange={onCompsStatusChange}
        />
      </div>
      <div className="comps-section">
        <h2 className="comps-section-title">Follow-up</h2>
        <TransactionList
          transactions={followUp}
          stages={stages}
          currentAgent={currentAgent}
          onStageChange={onStageChange}
          onNotesChange={onNotesChange}
          onCompsStatusChange={onCompsStatusChange}
        />
      </div>
    </div>
  );
}
