import { useState } from "react";
import Tombstone from "./icons/Tombstone";
import { sendShowingPacket } from "../lib/showingPacket";
import { useToast } from "../lib/ToastContext";
import { createPortal } from "react-dom";
import { Signpost, Lock, Mail, Instagram, Send } from "lucide-react";
import { stageSelectValue, closingStatusBadge } from "../lib/stages";
import { formatBac, openEmailCompose } from "../lib/clientEmail";
import TodoList, { MissingInfoTodo } from "./TodoList";
import { BoostPostPanel, ListingGraphicPanel, OpenHousePanel } from "./SocialPostPanels";

/** Today as YYYY-MM-DD in local time (not toISOString, which is UTC and can be
 * a day off near midnight) — todos.due_date is a plain date column, so a string
 * comparison against this is enough to catch "due today or earlier". */
function todayStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Open to-dos shown on a deal card before "+N more" — keeps cards in a row
 * close to the same height. Everything is still on the deal screen and the
 * To-Dos tab. */
const CARD_TODO_LIMIT = 3;

/** The Dropbox "open box" mark, drawn inline (lucide has no brand icons). */
function DropboxIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M6 1.807 0 5.629l6 3.822 6-3.822zm12 0-6 3.822 6 3.822 6-3.822zM0 13.274l6 3.822 6-3.822-6-3.823zm18-3.823-6 3.823 6 3.822 6-3.822zM6 18.371l6 3.822 6-3.822-6-3.822z"
      />
    </svg>
  );
}

const PROPERTY_STYLE_TAGS = {
  Residential: { emoji: "🏠", label: "Single Family", className: "tx-tag--residential" },
  Land: { emoji: "🌲", label: "Land", className: "tx-tag--land" },
  "Multi Family": { emoji: "🏘️", label: "Multi Family", className: "tx-tag--multifamily" },
  Commercial: { emoji: "🏢", label: "Commercial", className: "tx-tag--commercial" },
};

export default function TransactionList({
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
  onDeadLead,
}) {
  // Named isBroker for history; true for the transaction coordinator too,
  // since she also sees every agent's deals and needs the agent name shown.
  const isBroker = currentAgent.role === "broker" || currentAgent.role === "coordinator";

  if (transactions.length === 0) {
    return <p className="empty-state">No transactions yet.</p>;
  }

  return (
    <div className="tx-list">
      {transactions.map((tx) => (
        <TxCard
          key={tx.id}
          tx={tx}
          stages={stages}
          isBroker={isBroker}
          hideSocial={currentAgent.role === "coordinator"}
          onStageChange={onStageChange}
          onNotesChange={onNotesChange}
          onCompsStatusChange={onCompsStatusChange}
          onDeadLead={onDeadLead}
          onAddTodo={onAddTodo}
          onToggleTodo={onToggleTodo}
          onEditTodo={onEditTodo}
          onDeleteTodo={onDeleteTodo}
          onOpenDetail={onOpenDetail}
        />
      ))}
    </div>
  );
}

function TxCard({
  tx,
  stages,
  isBroker,
  hideSocial,
  onStageChange,
  onNotesChange,
  onCompsStatusChange,
  onAddTodo,
  onToggleTodo,
  onEditTodo,
  onDeleteTodo,
  onOpenDetail,
  onDeadLead,
}) {
  const [lockboxOpen, setLockboxOpen] = useState(false);
  const [signNoteOpen, setSignNoteOpen] = useState(false);
  const [showSocialMenu, setShowSocialMenu] = useState(false);
  const [showBoostPost, setShowBoostPost] = useState(false);
  const [graphicPostType, setGraphicPostType] = useState(null);
  const [showOpenHouse, setShowOpenHouse] = useState(false);
  const isActiveListing = tx.stage === "won" || tx.stage === "market";
  const isBuySide = tx.side === "Buy";
  const signDeclined = tx.sign_status === "Seller Declined";
  const dueTodoCount = (tx.todos || []).filter((t) => !t.done && t.due_date && t.due_date <= todayStr()).length;
  // Same gate as the deal detail screen's social post menu — a listing (not a
  // buyer-side deal) that's at least reached Won, when its Dropbox Photos folder
  // first exists.
  // Never for the transaction coordinator — social media isn't part of her role.
  const canPostSocial = !hideSocial && !isBuySide && Boolean(tx.dropbox_folder_path);
  const statusBadge = closingStatusBadge(tx);
  const [sendingPacket, setSendingPacket] = useState(false);
  const showToast = useToast();
  // Listing-side deals with a Dropbox folder — that's where the "- Packet" file lives.
  const canSendPacket = !isBuySide && Boolean(tx.dropbox_folder_url) && ["won", "market", "contract"].includes(tx.stage) && !tx.terminated_at;

  return (
    <div className={`tx-card ${tx.terminated_at ? "tx-card--terminated" : ""}`} onClick={() => onOpenDetail && onOpenDetail(tx)}>
      <div className="tx-card-top">
        <div>
          <div className="tx-address">
            {tx.address}
            {tx.terminated_at && <span className="tx-terminated-badge">Terminated</span>}
            {statusBadge && <span className={`tx-status-badge ${statusBadge.className}`}>{statusBadge.label}</span>}
            {!tx.terminated_at && dueTodoCount > 0 && (
              <span className="tx-due-badge">
                {dueTodoCount} To-Do{dueTodoCount > 1 ? "s" : ""} Due
              </span>
            )}
          </div>
          <div className="tx-sub">
            {tx.town}
            {isActiveListing ? "" : ` · ${tx.side} side`}
            {isBroker && tx.agent ? ` · ${tx.agent.name}` : ""}
          </div>
        </div>
        <div className="tx-card-top-right">
          {tx.dropbox_folder_url && (
            <a
              href={tx.dropbox_folder_url}
              target="_blank"
              rel="noreferrer"
              className="tx-dropbox-btn"
              onClick={(e) => e.stopPropagation()}
              aria-label="Open this property's Dropbox folder"
              title="Open this property's Dropbox folder"
            >
              <DropboxIcon size={15} />
            </a>
          )}
          {canPostSocial && (
            <div className="detail-social-menu-wrap" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                className="detail-social-btn"
                onClick={() => setShowSocialMenu((v) => !v)}
                aria-label="Social media post"
                title="Social media post"
              >
                <Instagram size={16} />
              </button>
              {showSocialMenu && (
                <div className="detail-social-menu">
                  <button title="Make a New Listing graphic + caption"
                    type="button"
                    onClick={() => {
                      setGraphicPostType("newListing");
                      setShowSocialMenu(false);
                    }}
                  >
                    New Listing Post
                  </button>
                  <button title="Write a caption for a boosted (paid) post"
                    type="button"
                    onClick={() => {
                      setShowBoostPost(true);
                      setShowSocialMenu(false);
                    }}
                  >
                    Boost
                  </button>
                  <button title="Make an Under Contract graphic + caption"
                    type="button"
                    onClick={() => {
                      setGraphicPostType("underContract");
                      setShowSocialMenu(false);
                    }}
                  >
                    Under Contract
                  </button>
                  <button title="Make a Sold graphic + caption"
                    type="button"
                    onClick={() => {
                      setGraphicPostType("sold");
                      setShowSocialMenu(false);
                    }}
                  >
                    Closed
                  </button>
                  <button title="Make an Open House graphic + caption"
                    type="button"
                    onClick={() => {
                      setShowOpenHouse(true);
                      setShowSocialMenu(false);
                    }}
                  >
                    Open House
                  </button>
                </div>
              )}
            </div>
          )}
          <select
            value={stageSelectValue(tx, stages)}
            onChange={(e) => onStageChange(tx, e.target.value)}
            onClick={(e) => e.stopPropagation()}
            className="tx-stage-select"
          >
            {stages.map((s) => (
              <option key={s.key} value={s.key} disabled={s.disabled}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* stopPropagation here, not just on the card-top controls — these render as fixed
          overlays, but they're still nested inside tx-card's onClick-to-open-detail DOM
          subtree, so a backdrop-dismiss click would otherwise bubble up and open the
          detail screen right as the panel closes. */}
      {/* Portaled to <body>: these are position: fixed overlays, and the page
          swiper (DealPages) slides its track with a CSS transform — which makes
          any fixed-position descendant position relative to the track instead
          of the screen, so the panel opened off-screen and the menu buttons
          looked like they did nothing. React events still bubble through the
          React tree from a portal, hence the stopPropagation wrapper. */}
      {(showBoostPost || graphicPostType || showOpenHouse) &&
        createPortal(
          <div onClick={(e) => e.stopPropagation()}>
            {showBoostPost && <BoostPostPanel transaction={tx} onClose={() => setShowBoostPost(false)} />}
            {graphicPostType && (
              <ListingGraphicPanel transaction={tx} postType={graphicPostType} onClose={() => setGraphicPostType(null)} />
            )}
            {showOpenHouse && <OpenHousePanel transaction={tx} onClose={() => setShowOpenHouse(false)} />}
          </div>,
          document.body
        )}

      {isActiveListing && PROPERTY_STYLE_TAGS[tx.property_style] && (
        <div className="tx-tag-row" onClick={(e) => e.stopPropagation()}>
          <span className={`tx-icon-badge tx-tag ${PROPERTY_STYLE_TAGS[tx.property_style].className}`}>
            {PROPERTY_STYLE_TAGS[tx.property_style].emoji} {PROPERTY_STYLE_TAGS[tx.property_style].label}
          </span>
        </div>
      )}

      {(isActiveListing || (tx.ba_comp && !isBuySide)) && (
        <div className="tx-icons-row" onClick={(e) => e.stopPropagation()}>
          {isActiveListing && tx.sign_status === "Yes" && (
            <span className="tx-icon-badge tx-icon-badge--sign-yes" title="Sign is installed">
              <Signpost size={14} /> Sign
            </span>
          )}
          {isActiveListing && signDeclined && (
            <button title="Seller declined a sign — tap for the note"
              type="button"
              className="tx-icon-badge tx-icon-badge--btn tx-icon-badge--declined"
              onClick={() => setSignNoteOpen((o) => !o)}
            >
              <Signpost size={14} /> Sign
            </button>
          )}
          {isActiveListing && !signDeclined && tx.sign_status !== "Yes" && (
            <span className="tx-icon-badge tx-icon-badge--sign-need" title="Sign not installed yet">
              <Signpost size={14} /> Need Sign
            </span>
          )}
          {tx.ba_comp && !isBuySide && (
            <span className="tx-icon-badge" title="Buyer agency commission">
              BAC {formatBac(tx.ba_comp)}
            </span>
          )}
          {isActiveListing && tx.has_lockbox && (
            <button title="Show the lockbox code" type="button" className="tx-icon-badge tx-icon-badge--btn tx-icon-badge--lockbox" onClick={() => setLockboxOpen((o) => !o)}>
              <Lock size={14} /> Lockbox
            </button>
          )}
        </div>
      )}

      {isActiveListing && signNoteOpen && (
        <div className="lockbox-popover" onClick={(e) => e.stopPropagation()}>
          Seller does not want a sign.
        </div>
      )}

      {isActiveListing && lockboxOpen && (
        <div className="lockbox-popover" onClick={(e) => e.stopPropagation()}>
          <div>
            <strong>Code:</strong> {tx.lockbox_code || "—"}
          </div>
          {tx.lockbox_note && (
            <div>
              <strong>Notes/Location:</strong> {tx.lockbox_note}
            </div>
          )}
        </div>
      )}

      {tx.stage === "comps" && onCompsStatusChange && (
        <div className="comps-status-toggle" onClick={(e) => e.stopPropagation()}>
          <span className="comps-status-toggle-label">Move to:</span>
          {tx.comps_status === "Waiting to List" ? (
            <button title="Move this comp to Need to Send Comp"
              type="button"
              className="comps-status-btn"
              onClick={() => onCompsStatusChange(tx.id, "Need to Send Comp")}
            >
              Need to Send Comp
            </button>
          ) : (
            <button title="Move this comp to Waiting to List"
              type="button"
              className="comps-status-btn"
              onClick={() => onCompsStatusChange(tx.id, "Waiting to List")}
            >
              Waiting to List
            </button>
          )}
          <button title="We won the listing — move it to Private Listing" type="button" className="comps-status-btn" onClick={() => onStageChange(tx, "won")}>
            Won Listing
          </button>
          {onDeadLead && (
            <button type="button" className="comps-status-btn comps-status-btn--dead" onClick={() => onDeadLead(tx)} title="We didn't get this one — lay it to rest (you can revive it later)">
              <Tombstone size={15} /> Dead/Lost
            </button>
          )}
        </div>
      )}

      {tx.stage === "comps" ? (
        <textarea
          defaultValue={tx.notes || ""}
          placeholder="Notes…"
          onBlur={(e) => onNotesChange(tx.id, e.target.value)}
          onClick={(e) => e.stopPropagation()}
          rows={2}
          className="tx-notes"
        />
      ) : (
        onAddTodo && (
          <div className="tx-card-todos" onClick={(e) => e.stopPropagation()}>
            <MissingInfoTodo tx={tx} onOpen={onOpenDetail} />
            <TodoList
              todos={(tx.todos || []).filter((t) => !t.done)}
              onAdd={(text, dueDate) => onAddTodo(tx.id, text, dueDate)}
              onToggle={(todo, done) => onToggleTodo(todo, done)}
              onEdit={onEditTodo}
              onDelete={onDeleteTodo}
              maxVisible={CARD_TODO_LIMIT}
              onShowMore={() => onOpenDetail?.(tx)}
              emptyHint="✓ All caught up"
            />
          </div>
        )
      )}

      {(tx.seller_emails?.length > 0 || canSendPacket) && (
        <div className="tx-card-footer">
          {tx.seller_emails?.length > 0 ? (
            <button
              type="button"
              className="tx-email-client-btn"
              title={`Email ${tx.seller_emails.join(", ")}`}
              onClick={(e) => {
                e.stopPropagation();
                openEmailCompose({ to: tx.seller_emails, subject: tx.address });
              }}
            >
              <Mail size={14} /> Email Client
            </button>
          ) : (
            <span />
          )}
          {canSendPacket && (
            <button
              type="button"
              className="tx-packet-btn"
              disabled={sendingPacket}
              aria-label="Email the showing packet"
              title="Email the showing packet (view-only Dropbox link) from your own account"
              onClick={async (e) => {
                e.stopPropagation();
                setSendingPacket(true);
                try {
                  const fileName = await sendShowingPacket(tx);
                  showToast(`Email ready with a link to "${fileName}"`);
                } catch (err) {
                  showToast(`Couldn't get the showing packet: ${err.message}`);
                } finally {
                  setSendingPacket(false);
                }
              }}
            >
              <Send size={14} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
