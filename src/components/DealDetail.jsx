import { useEffect, useRef, useState } from "react";
import { Pencil, Mail, FileText, FolderOpen, ChevronDown, ChevronLeft, Instagram } from "lucide-react";
import TodoList, { MissingInfoTodo } from "./TodoList";
import RadioGroup from "./RadioGroup";
import CheckboxGroup from "./CheckboxGroup";
import GenerateCompForm from "./GenerateCompForm";
import CloseoutCalculator from "./CloseoutCalculator";
import ConfirmDialog from "./ConfirmDialog";
import DropboxFolderPicker from "./DropboxFolderPicker";
import { BoostPostPanel, ListingGraphicPanel, OpenHousePanel } from "./SocialPostPanels";
import { useToast } from "../lib/ToastContext";
import { fetchAttorneys, resolveAttorneyId, updateTransactionFields, updateTransactionAttorneys, emailShowingPacket, setComplianceClosed, deleteTransaction, upsertCommissionData, pairDropboxFolder, fillZipCode } from "../lib/transactions";
import { clientIsBuyer as isClientBuyer } from "../lib/missingInfo";
import { stageSelectValue, closingStatusBadge } from "../lib/stages";
import { formatBac, emailComposeUrl, emailLinkTarget } from "../lib/clientEmail";
import { sendShowingPacket } from "../lib/showingPacket";
import { SHOWING_ACCESS_OPTIONS } from "../lib/showingAccess";
import { focusNextOnEnter } from "../lib/formKeyNav";
import {
  PROPERTY_STYLES,
  TIMEFRAMES,
  ELECTRICAL_OPTIONS,
  HEATING_OPTIONS,
  BASEMENT_OPTIONS,
  FUEL_TYPE_OPTIONS,
  YES_NO_OPTIONS,
  SOLAR_OPTIONS,
  NOT_SPECIFIED,
  recommendationOptionsFor,
  visibleUtilityFields,
  normalizeUtilities,
} from "../lib/compFieldOptions";

/** Formats a "YYYY-MM-DD" date string as "Month Day, Year"; returns other formats unchanged. */
export function formatDate(dateStr) {
  if (!dateStr) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
  if (!match) return dateStr;
  const [, y, m, d] = match;
  return new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export default function DealDetail({
  transaction,
  className,
  stages,
  currentAgent,
  onBack,
  onStageChange,
  onNotesChange,
  onCompsStatusChange,
  onAddTodo,
  onToggleTodo,
  onEditTodo,
  onDeleteTodo,
  onLockboxChange,
  onRefresh,
  onRetryDropboxFolder,
  onTerminate,
  onReactivate,
  onRelist,
}) {
  const isBroker = currentAgent.role === "broker";
  // The transaction coordinator sees every deal like a broker does, but never
  // any commission math — see "Close-Out" gating below.
  const isCoordinator = currentAgent.role === "coordinator";
  const isStaff = isBroker || isCoordinator;
  const isActiveListing = transaction.stage === "won" || transaction.stage === "market";
  const isBuySide = transaction.side === "Buy";
  // Buy deals, plus Split deals where we represent the buyers — no comp data,
  // and the client email list is labeled as the buyers'.
  const clientIsBuyer = isClientBuyer(transaction);
  const isUnderContractOrClosed = transaction.stage === "contract" || transaction.stage === "closed";
  // A freshly-Won listing doesn't necessarily have a signed Listing Agreement yet —
  // that's tracked via the "Send Listing Agreement" to-do seeded on Won, not a
  // separate field. Compliance-wise, terminating requires that agreement to exist
  // (there'd be a termination addendum to file); On Market and Under Contract both
  // inherently imply a signed agreement already exists.
  const hasSignedListingAgreement = transaction.todos?.some((t) => t.text === "Send Listing Agreement" && t.done);
  const isWonWithoutAgreement = transaction.stage === "won" && !hasSignedListingAgreement;
  const [lockboxCode, setLockboxCode] = useState(transaction.lockbox_code || "");
  const [lockboxNote, setLockboxNote] = useState(transaction.lockbox_note || "");
  const [attorneys, setAttorneys] = useState([]);
  const [compDetailsCollapsed, setCompDetailsCollapsed] = useState(true);
  const [retryingDropbox, setRetryingDropbox] = useState(false);
  const [emailingPacket, setEmailingPacket] = useState(false);
  // Lets New Comp's "Add & Build CMA PDF" button drop an agent straight into this
  // screen already open, instead of landing on the deal detail view first.
  const [showGenerateComp, setShowGenerateComp] = useState(Boolean(transaction._openGenerateComp));
  // Set when the stage dropdown is switched to Closed — same idea as Under
  // Contract opening its form — so the deal goes straight into the calculator.
  const [showCloseoutCalculator, setShowCloseoutCalculator] = useState(Boolean(transaction._openCloseout));
  const [utilitiesCollapsed, setUtilitiesCollapsed] = useState(true);
  const [showTerminateConfirm, setShowTerminateConfirm] = useState(false);
  const [showRelistConfirm, setShowRelistConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [relisting, setRelisting] = useState(false);
  const [relistError, setRelistError] = useState(null);
  const [showSocialMenu, setShowSocialMenu] = useState(false);
  const [showBoostPost, setShowBoostPost] = useState(false);
  const [graphicPostType, setGraphicPostType] = useState(null);
  const [showOpenHouse, setShowOpenHouse] = useState(false);
  // Social posts only make sense for a listing (not a buyer-side deal) that's at
  // least reached Won — that's when its Dropbox Photos folder first exists.
  // Never for the transaction coordinator — social media isn't part of her role.
  const canPostSocial = !isCoordinator && !isBuySide && Boolean(transaction.dropbox_folder_path);
  const swipeStart = useRef(null);
  const swipeIntent = useRef(null);
  const showToast = useToast();
  const [editingAddress, setEditingAddress] = useState(false);
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [pairingFolder, setPairingFolder] = useState(false);

  async function handlePairFolder(choice) {
    setPairingFolder(true);
    try {
      const result = await pairDropboxFolder(transaction.id, choice);
      setShowFolderPicker(false);
      onRefresh();
      showToast(`Paired with ${result.folderPath?.split("/").pop() || "the folder"}`);
    } catch (e) {
      showToast(`Couldn't pair the folder: ${e.message}`);
    } finally {
      setPairingFolder(false);
    }
  }
  const [scrolledPastTitle, setScrolledPastTitle] = useState(false);
  const titleRef = useRef(null);

  // Once the big address title scrolls away, show it small in the sticky
  // back bar so you still know which deal you're on.
  useEffect(() => {
    const el = titleRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver(([entry]) => setScrolledPastTitle(!entry.isIntersecting), { rootMargin: "-50px 0px 0px 0px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, [showGenerateComp, showCloseoutCalculator]);

  /** Scroll to a field (data-field="…") and pulse it — used by the Missing
   * Info box. Town/State live in the address editor, so that opens first. */
  function focusField(field) {
    const open = field === "town" || field === "region" || field === "address";
    if (open) setEditingAddress(true);
    // Wait a frame (two, if the editor just opened) for it to be on screen.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const el = document.querySelector(`[data-field="${field}"]`);
        if (!el) return;
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.remove("field-flash");
        void el.offsetWidth; // restart the animation if it's tapped twice
        el.classList.add("field-flash");
        setTimeout(() => el.classList.remove("field-flash"), 1700);
      })
    );
  }

  // Arrived here from a card's Missing Info box — jump to that field.
  useEffect(() => {
    if (transaction._focusField) {
      const t = setTimeout(() => focusField(transaction._focusField), 250);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transaction._focusField]);

  useEffect(() => {
    fetchAttorneys().then(setAttorneys).catch(() => {});
  }, []);

  // Already on this deal's detail screen when the stage dropdown flips to
  // Closed — the component doesn't remount (same key), so the useState
  // initializer above won't see the new flag on its own.
  useEffect(() => {
    if (transaction._openCloseout) setShowCloseoutCalculator(true);
  }, [transaction._openCloseout]);

  // Swipe left anywhere on the detail screen to go back — same intent-detection
  // pattern as the page-switching swipe on the list screens (DealPages), so a
  // normal vertical scroll of this long form never gets mistaken for the gesture.
  function handleSwipeTouchStart(e) {
    swipeStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    swipeIntent.current = null;
  }
  function handleSwipeTouchMove(e) {
    if (!swipeStart.current) return;
    const deltaX = e.touches[0].clientX - swipeStart.current.x;
    const deltaY = e.touches[0].clientY - swipeStart.current.y;
    if (swipeIntent.current === null) {
      if (Math.abs(deltaX) < 8 && Math.abs(deltaY) < 8) return;
      swipeIntent.current = Math.abs(deltaX) > Math.abs(deltaY) ? "horizontal" : "vertical";
    }
  }
  function handleSwipeTouchEnd(e) {
    if (swipeIntent.current === "horizontal" && swipeStart.current) {
      const endX = e.changedTouches[0]?.clientX ?? swipeStart.current.x;
      if (endX - swipeStart.current.x < -60) onBack();
    }
    swipeStart.current = null;
    swipeIntent.current = null;
  }

  function handleHasLockboxToggle(checked) {
    onLockboxChange(transaction.id, { hasLockbox: checked, lockboxCode, lockboxNote });
  }

  function handleLockboxBlur() {
    onLockboxChange(transaction.id, {
      hasLockbox: transaction.has_lockbox,
      lockboxCode,
      lockboxNote,
    });
  }

  async function handleRelistConfirm(reason) {
    setShowRelistConfirm(false);
    setRelisting(true);
    setRelistError(null);
    try {
      await onRelist(transaction.id, reason);
      showToast("Buyer fell through — listing relisted");
    } catch (e) {
      setRelistError(e.message);
    } finally {
      setRelisting(false);
    }
  }

  async function handleFieldSave(patch) {
    await updateTransactionFields(transaction.id, patch);
    onRefresh();
    showToast("Saved");
  }

  async function handleCommissionSave(patch) {
    await upsertCommissionData(transaction.id, patch);
    onRefresh();
    showToast("Saved");
  }

  async function handleAttorneySave(side, name) {
    const id = await resolveAttorneyId(name, attorneys);
    await updateTransactionAttorneys(transaction.id, side === "buyer" ? { buyerAttorneyId: id } : { sellerAttorneyId: id });
    onRefresh();
    showToast("Saved");
  }

  async function handleEmailShowingPacket() {
    setEmailingPacket(true);
    try {
      const fileName = await sendShowingPacket(transaction);
      showToast(`Email ready with a link to "${fileName}"`);
    } catch (e) {
      showToast(`Couldn't get the showing packet: ${e.message}`);
    } finally {
      setEmailingPacket(false);
    }
  }

  if (showGenerateComp) {
    return (
      <GenerateCompForm
        transaction={transaction}
        onCancel={() => setShowGenerateComp(false)}
        onGenerated={() => {
          onRefresh();
        }}
      />
    );
  }

  // Broker-only, belt and braces: the buttons that open it are already hidden
  // for everyone else.
  if (showCloseoutCalculator && isBroker) {
    return (
      <CloseoutCalculator
        transaction={transaction}
        onCancel={() => setShowCloseoutCalculator(false)}
        onSaved={() => {
          setShowCloseoutCalculator(false);
          onRefresh();
        }}
      />
    );
  }

  return (
    <div
      className={`deal-detail ${className || ""}`}
      onTouchStart={handleSwipeTouchStart}
      onTouchMove={handleSwipeTouchMove}
      onTouchEnd={handleSwipeTouchEnd}
    >
      {/* Its own bar (not inside <header>) so it can stay stuck to the top
          of the screen the whole way down this long page. */}
      <div className="detail-sticky-bar">
          <button type="button" className="detail-back-btn" onClick={onBack} aria-label="Back" title="Back to the main screen">
            <ChevronLeft size={22} />
          </button>
          <span className={`detail-sticky-title ${scrolledPastTitle ? "detail-sticky-title--shown" : ""}`}>{transaction.address}</span>
          {canPostSocial && (
            <div className="detail-social-menu-wrap">
              <button
                type="button"
                className="detail-social-btn"
                onClick={() => setShowSocialMenu((v) => !v)}
                aria-label="Social media post"
                title="Social media post"
              >
                <Instagram size={18} />
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
      </div>
      <header className="detail-header" ref={titleRef}>
        {editingAddress ? (
          <AddressEditor
            transaction={transaction}
            onCancel={() => setEditingAddress(false)}
            onSave={async (patch, { lookUpZip } = {}) => {
              await handleFieldSave(patch);
              setEditingAddress(false);
              if (lookUpZip) {
                fillZipCode(transaction.id)
                  .then((zip) => {
                    if (zip) {
                      onRefresh();
                      showToast(`Zip ${zip} filled in`);
                    }
                  })
                  .catch(() => {});
              }
            }}
          />
        ) : (
          <div>
            <div className="brand-eyebrow" data-field="town">
              {[transaction.town, [transaction.region, transaction.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ") || transaction.side}
              {!transaction.region && <span className="field-help"> · VT/NH not set</span>}
            </div>
            <div className="detail-title-row">
              <h1 data-field="address">{transaction.address}</h1>
              <button
                type="button"
                className="edit-icon-btn"
                onClick={() => setEditingAddress(true)}
                aria-label="Edit address, town, or state"
                title="Edit address, town, or state (VT/NH)"
              >
                <Pencil size={13} />
              </button>
            </div>
          </div>
        )}
      </header>

      {showBoostPost && <BoostPostPanel transaction={transaction} onClose={() => setShowBoostPost(false)} />}
      {graphicPostType && (
        <ListingGraphicPanel transaction={transaction} postType={graphicPostType} onClose={() => setGraphicPostType(null)} />
      )}
      {showOpenHouse && <OpenHousePanel transaction={transaction} onClose={() => setShowOpenHouse(false)} />}

      {transaction.terminated_at && (
        <div className="error-banner">
          <strong>Terminated</strong> {formatDate(transaction.terminated_at.slice(0, 10))}
          {transaction.termination_reason ? ` — ${transaction.termination_reason}` : ""}
        </div>
      )}

      <label>
        Stage
        <select
          value={stageSelectValue(transaction, stages)}
          onChange={(e) => onStageChange(transaction, e.target.value)}
          className="stage-select"
        >
          {stages.map((s) => (
            <option key={s.key} value={s.key} disabled={s.disabled}>
              {s.label}
            </option>
          ))}
        </select>
      </label>

      {(() => {
        const badge = closingStatusBadge(transaction);
        return badge ? (
          <p className="compliance-status">
            <span className={`tx-status-badge ${badge.className}`} style={{ marginLeft: 0 }}>
              {badge.label}
            </span>
            {transaction.stage === "contract" && !isBroker && (
              <span className="field-help"> — waiting on Fran's commission review. Switch back to Under Contract to undo.</span>
            )}
          </p>
        ) : null;
      })()}

      {transaction.stage === "closed" && !transaction.terminated_at && isStaff && (
        <div className="detail-section">
          <h2 className="comps-section-title">Compliance</h2>
          {transaction.compliance_closed_at ? (
            <>
              <p className="field-help">
                Closed for compliance {formatDate(transaction.compliance_closed_at.slice(0, 10))}.
              </p>
              <button title="Move this deal back into compliance review"
                type="button"
                className="comps-status-btn"
                onClick={async () => {
                  try {
                    await setComplianceClosed(transaction.id, null);
                    onRefresh();
                    showToast("Compliance review reopened");
                  } catch (e) {
                    showToast(`Couldn't update: ${e.message}`);
                  }
                }}
              >
                Reopen Compliance Review
              </button>
            </>
          ) : (
            <>
              <p className="field-help">
                Commission's been closed out. Work through the compliance checklist in the To-Do list (review the file,
                send the closing docs + review link to the agent, add buyer and seller to the Postable list), then mark it
                closed for compliance — the final step.
              </p>
              <button title="Final step — the file has been reviewed and is complete"
                type="button"
                className="google-btn"
                onClick={async () => {
                  try {
                    await setComplianceClosed(transaction.id, currentAgent.id);
                    onRefresh();
                    showToast("Closed for compliance");
                  } catch (e) {
                    showToast(`Couldn't update: ${e.message}`);
                  }
                }}
              >
                Mark Closed for Compliance
              </button>
            </>
          )}
        </div>
      )}

      {transaction.stage === "comps" && onCompsStatusChange && (
        <div className="comps-status-toggle">
          <span className="comps-status-toggle-label">Move to:</span>
          {transaction.comps_status === "Waiting to List" ? (
            <button title="Move this comp to Need to Send Comp"
              type="button"
              className="comps-status-btn"
              onClick={() => onCompsStatusChange(transaction.id, "Need to Send Comp")}
            >
              Need to Send Comp
            </button>
          ) : (
            <button title="Move this comp to Waiting to List"
              type="button"
              className="comps-status-btn"
              onClick={() => onCompsStatusChange(transaction.id, "Waiting to List")}
            >
              Waiting to List
            </button>
          )}
          <button title="We won the listing — move it to Private Listing" type="button" className="comps-status-btn" onClick={() => onStageChange(transaction, "won")}>
            Won Listing
          </button>
        </div>
      )}

      {transaction.stage === "comps" && (
        <div className="detail-section">
          <h2 className="comps-section-title">Comp Details</h2>
          <CompDetailsGrid transaction={transaction} handleFieldSave={handleFieldSave} />
        </div>
      )}

      {transaction.stage === "comps" && (
        <div className="detail-section">
          <h2 className="comps-section-title">Comp / CMA</h2>
          <button title="Build the CMA PDF for this property" type="button" className="cma-export-btn" onClick={() => setShowGenerateComp(true)}>
            <FileText size={14} /> {transaction.last_comp_url ? "Regenerate Comp" : "Generate Comp"}
          </button>
          {transaction.last_comp_url && (
            <a href={transaction.last_comp_url} target="_blank" rel="noreferrer" className="cma-export-btn">
              <FileText size={14} /> View Generated Comp
            </a>
          )}
          <p className="field-help">
            Builds a branded CMA PDF from this comp's details, your write-up, and price recommendation, and files it
            in Dropbox — the listing's Pitch Docs folder once Won, or the shared comps repository before that.
          </p>
        </div>
      )}

      {transaction.stage !== "comps" && !clientIsBuyer && (
        <div className="detail-section">
          <button title="Show or hide the comp data"
            type="button"
            className="comps-section-header comps-collapse-toggle"
            onClick={() => setCompDetailsCollapsed((c) => !c)}
          >
            <h2 className="comps-section-title">Comp Data</h2>
            <ChevronDown size={18} className={`collapse-chevron ${compDetailsCollapsed ? "" : "collapse-chevron--open"}`} />
          </button>
          {!compDetailsCollapsed && (
            <>
              <CompDetailsGrid transaction={transaction} handleFieldSave={handleFieldSave} />
              <button title="Build the CMA PDF for this property" type="button" className="cma-export-btn" onClick={() => setShowGenerateComp(true)}>
                <FileText size={14} /> {transaction.last_comp_url ? "Regenerate Comp" : "Generate Comp"}
              </button>
              {transaction.last_comp_url && (
                <a href={transaction.last_comp_url} target="_blank" rel="noreferrer" className="cma-export-btn">
                  <FileText size={14} /> View Generated Comp
                </a>
              )}
            </>
          )}
        </div>
      )}

      {transaction.stage !== "comps" && (
        <div className="detail-section">
          <h2 className="comps-section-title">{clientIsBuyer ? "Deal Details" : "Listing Details"}</h2>
          <div className="detail-grid">
            <EditableText
              field="price"
              label="Price"
              value={transaction.price ? `$${Number(transaction.price).toLocaleString()}` : ""}
              type="number"
              placeholder="e.g. 350000"
              onSave={(v) => handleFieldSave({ price: v ? Number(v) : null })}
            />

            {!isBuySide && (
              <EditableText
                label="Buyer Agency Commission"
                value={formatBac(transaction.ba_comp)}
                placeholder="e.g. 2.5%"
                onSave={(v) => handleFieldSave({ ba_comp: v || null })}
              />
            )}

            <EditableSelect
              field="property_style"
              label="Property Style"
              value={transaction.property_style}
              options={PROPERTY_STYLES}
              onSave={(v) => handleFieldSave({ property_style: v })}
            />

            {!clientIsBuyer && "showing_access" in transaction && (
              <div className="detail-grid-full" data-field="showing_access">
                <div className="detail-label">Showings</div>
                <RadioGroup
                  name="showingAccess"
                  value={transaction.showing_access || ""}
                  onChange={(v) => handleFieldSave({ showing_access: v })}
                  options={SHOWING_ACCESS_OPTIONS}
                />
              </div>
            )}

            {!isBuySide && (
              <div className="detail-grid-full">
                <div className="detail-label">Sign</div>
                <RadioGroup
                  name="signStatus"
                  value={transaction.sign_status || "No"}
                  onChange={(v) => handleFieldSave({ sign_status: v })}
                  options={[
                    { value: "Yes", label: "Sign Installed" },
                    { value: "No", label: "Not yet" },
                    { value: "Seller Declined", label: "Seller doesn't want one" },
                  ]}
                />
              </div>
            )}

            {(!clientIsBuyer || isUnderContractOrClosed) && (
              <EditableText
                field="seller_name"
                label="Seller Name(s)"
                value={transaction.seller_name}
                placeholder="—"
                editableWhenSet
                onSave={(v) => handleFieldSave({ seller_name: v || null })}
              />
            )}
            {(clientIsBuyer || isUnderContractOrClosed) && (
              <EditableText
                field="buyer_name"
                label="Buyer Name(s)"
                value={transaction.buyer_name}
                placeholder="—"
                editableWhenSet
                onSave={(v) => handleFieldSave({ buyer_name: v || null })}
              />
            )}

            <EditableEmailList
              field="seller_emails"
              label={clientIsBuyer ? "Buyer Email(s)" : "Seller Email(s)"}
              values={transaction.seller_emails || []}
              onSave={(emails) => handleFieldSave({ seller_emails: emails })}
            />

            {!isActiveListing && (
              <>
                <div>
                  <div className="detail-label">Side</div>
                  <div>{transaction.side}</div>
                </div>

                {transaction.side === "Split" && (
                  <div className="detail-grid-full">
                    <div className="detail-label">Your Clients Are The</div>
                    <RadioGroup
                      name="splitClientSide"
                      value={transaction.split_client_side || ""}
                      onChange={(v) => handleFieldSave({ split_client_side: v })}
                      options={[
                        { value: "Sell", label: "Sellers" },
                        { value: "Buy", label: "Buyers" },
                      ]}
                    />
                  </div>
                )}

                {isStaff && (
                  <div>
                    <div className="detail-label">Agent</div>
                    <div>{transaction.agent?.name || "—"}</div>
                  </div>
                )}

                <EditableText
                  field="buyer_attorney"
                  label="Buyer Attorney"
                  value={transaction.buyer_attorney?.name}
                  placeholder="TBD"
                  attorneyList={attorneys}
                  editableWhenSet
                  onSave={(v) => handleAttorneySave("buyer", v)}
                />

                <EditableText
                  field="seller_attorney"
                  label="Seller Attorney"
                  value={transaction.seller_attorney?.name}
                  placeholder="TBD"
                  attorneyList={attorneys}
                  editableWhenSet
                  onSave={(v) => handleAttorneySave("seller", v)}
                />
              </>
            )}
          </div>
        </div>
      )}

      {transaction.stage !== "comps" && (
        <div className="detail-section">
          <h2 className="comps-section-title">Lockbox</h2>
          <label className="tbd-toggle">
            <input
              type="checkbox"
              checked={!!transaction.has_lockbox}
              onChange={(e) => handleHasLockboxToggle(e.target.checked)}
            />
            Has a lockbox
          </label>
          {transaction.has_lockbox && (
            <>
              <input
                placeholder="Lockbox code"
                value={lockboxCode}
                onChange={(e) => setLockboxCode(e.target.value)}
                onBlur={handleLockboxBlur}
              />
              <input
                placeholder="Notes/Location"
                value={lockboxNote}
                onChange={(e) => setLockboxNote(e.target.value)}
                onBlur={handleLockboxBlur}
              />
            </>
          )}
        </div>
      )}

      <div className="detail-section">
        <h2 className="comps-section-title">To-Do</h2>
        <MissingInfoTodo tx={transaction} onPick={focusField} />
        <TodoList
          todos={transaction.todos}
          onAdd={(text, dueDate) => onAddTodo(transaction.id, text, dueDate)}
          onToggle={onToggleTodo}
          onEdit={onEditTodo}
          onDelete={onDeleteTodo}
        />
      </div>

      {transaction.stage !== "comps" && (
        <div className="detail-section">
          <button title="Show or hide the utility providers"
            type="button"
            className="comps-section-header comps-collapse-toggle"
            onClick={() => setUtilitiesCollapsed((c) => !c)}
          >
            <h2 className="comps-section-title">
              Utility Providers
              {(() => {
                const fields = visibleUtilityFields(transaction.utilities);
                const filled = fields.filter((f) => transaction.utilities?.[f.key]).length;
                return filled ? <span className="field-help"> ({filled} of {fields.length})</span> : null;
              })()}
            </h2>
            <ChevronDown size={18} className={`collapse-chevron ${utilitiesCollapsed ? "" : "collapse-chevron--open"}`} />
          </button>
          {!utilitiesCollapsed && (
            <UtilityProvidersEditor
              key={JSON.stringify(transaction.utilities || {})}
              utilities={transaction.utilities}
              onSave={(next) => handleFieldSave({ utilities: next })}
            />
          )}
        </div>
      )}

      <div className="detail-section">
        <h2 className="comps-section-title">Notes</h2>
        <textarea
          defaultValue={transaction.notes || ""}
          placeholder="Notes…"
          onBlur={(e) => onNotesChange(transaction.id, e.target.value)}
          rows={3}
          className="tx-notes"
        />
      </div>

      {(transaction.stage === "contract" || transaction.stage === "closed") && (
        <div className="detail-section">
          <h2 className="comps-section-title">Under Contract Details</h2>
          <p className="field-help">
            {isStaff
              ? "Collected from the Under Contract form."
              : "Read-only — what was submitted on the Under Contract form. Contact Fran or Holly to request a change."}
          </p>
          <div className="detail-grid">
            {isBroker && (
              <div>
                <div className="detail-label">Commission %</div>
                <div>{transaction.closeouts?.commission_pct ?? "—"}</div>
              </div>
            )}
            <div>
              <div className="detail-label">Lead Type</div>
              <div>{transaction.commission_data?.lead_type || "—"}</div>
            </div>
            <div>
              <div className="detail-label">Client Source</div>
              <div>{transaction.commission_data?.client_source || "—"}</div>
            </div>
            <div>
              <div className="detail-label">Referral</div>
              <div>
                {transaction.commission_data?.referral_owed_to
                  ? `${transaction.commission_data.referral_owed_to} (${transaction.commission_data.referral_pct}%)`
                  : "—"}
              </div>
            </div>
            <div>
              <div className="detail-label">Deposit</div>
              <div>
                {transaction.commission_data?.hold_deposit === "Yes"
                  ? `$${Number(transaction.commission_data.deposit_amount).toLocaleString()}`
                  : "No"}
              </div>
            </div>
            <div>
              <div className="detail-label">Second Deposit</div>
              <div>
                {transaction.commission_data?.second_deposit === "Yes"
                  ? `$${Number(transaction.commission_data.second_deposit_amount).toLocaleString()} due ${formatDate(transaction.commission_data.second_deposit_due_date) || "—"}`
                  : "No"}
              </div>
            </div>
            {isStaff ? (
              <EditableText
                field="next_date"
                label="Closing Date"
                type="date"
                value={formatDate(transaction.next_date)}
                rawValue={transaction.next_date?.slice(0, 10)}
                placeholder="—"
                editableWhenSet
                onSave={(v) => handleFieldSave({ next_date: v || null })}
              />
            ) : (
              <div data-field="next_date">
                <div className="detail-label">Closing Date</div>
                <div>{formatDate(transaction.next_date) || "—"}</div>
              </div>
            )}
            {isStaff ? (
              <EditableText
                field="inspection_date"
                label="Inspection Deadline"
                type="date"
                value={formatDate(transaction.commission_data?.inspection_date)}
                rawValue={transaction.commission_data?.inspection_date?.slice(0, 10)}
                placeholder="—"
                editableWhenSet
                onSave={(v) => handleCommissionSave({ inspection_date: v || null })}
              />
            ) : (
              <div data-field="inspection_date">
                <div className="detail-label">Inspection Deadline</div>
                <div>{formatDate(transaction.commission_data?.inspection_date) || "—"}</div>
              </div>
            )}
            {isStaff ? (
              <EditableText
                field="financing_date"
                label="Financing Date"
                type="date"
                value={formatDate(transaction.commission_data?.financing_date)}
                rawValue={transaction.commission_data?.financing_date?.slice(0, 10)}
                placeholder="—"
                editableWhenSet
                onSave={(v) => handleCommissionSave({ financing_date: v || null })}
              />
            ) : (
              <div data-field="financing_date">
                <div className="detail-label">Financing Date</div>
                <div>{formatDate(transaction.commission_data?.financing_date) || "—"}</div>
              </div>
            )}
            {isStaff ? (
              <EditableText
                field="appraiser"
                label="Appraiser"
                type="text"
                value={transaction.commission_data?.appraiser}
                rawValue={transaction.commission_data?.appraiser}
                placeholder="—"
                editableWhenSet
                onSave={(v) => handleCommissionSave({ appraiser: v || null })}
              />
            ) : (
              <div data-field="appraiser">
                <div className="detail-label">Appraiser</div>
                <div>{transaction.commission_data?.appraiser || "—"}</div>
              </div>
            )}
          </div>

          {isBroker && transaction.closeouts?.commission_after_referral != null && (
            <>
              <h3 className="timeframe-group-title closeout-split-title">Close-Out Split</h3>
              <div className="detail-grid">
                <div>
                  <div className="detail-label">Commission After Referral</div>
                  <div>${Number(transaction.closeouts.commission_after_referral).toLocaleString()}</div>
                </div>
                {transaction.closeouts.agent_commission != null ? (
                  <div>
                    <div className="detail-label">Agent Commission</div>
                    <div>${Number(transaction.closeouts.agent_commission).toLocaleString()}</div>
                  </div>
                ) : (
                  <div>
                    <div className="detail-label">Deal Type</div>
                    <div>Owner deal (Fran/Holly)</div>
                  </div>
                )}
                <div>
                  <div className="detail-label">Holly's Commission</div>
                  <div>${Number(transaction.closeouts.holly_commission ?? 0).toLocaleString()}</div>
                </div>
                <div>
                  <div className="detail-label">Fran's Commission</div>
                  <div>${Number(transaction.closeouts.fran_commission ?? 0).toLocaleString()}</div>
                </div>
                {transaction.closeouts.bank_amount != null && (
                  <div>
                    <div className="detail-label">Brokerage Keeps</div>
                    <div>${Number(transaction.closeouts.bank_amount).toLocaleString()}</div>
                  </div>
                )}
                {transaction.closeouts.tc_fee_type && (
                  <div>
                    <div className="detail-label">TC Fee</div>
                    <div>
                      {transaction.closeouts.tc_fee_type} (${Number(transaction.closeouts.tc_fee_amount ?? 0).toLocaleString()})
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {isBroker && (
            <button title="Broker only — review the commission split and close out the file" type="button" className="cma-export-btn" onClick={() => setShowCloseoutCalculator(true)}>
              <FileText size={14} /> {transaction.closeouts?.commission_after_referral != null ? "Edit Close-Out" : "Run Close-Out Calculator"}
            </button>
          )}
        </div>
      )}

      {transaction.stage !== "comps" && (
        <div className="detail-section">
          <h2 className="comps-section-title">Documents</h2>
          <p className="field-help">Files live in Dropbox — this list tracks status only.</p>
          {transaction.dropbox_folder_url ? (
            <>
              <a href={transaction.dropbox_folder_url} target="_blank" rel="noreferrer" className="cma-export-btn" title="Open this deal's folder in Dropbox">
                <FolderOpen size={14} /> Open Dropbox Folder
              </a>
              <button
                type="button"
                className="dbx-change-link"
                onClick={() => setShowFolderPicker((v) => !v)}
                title="Point this deal at a different existing Dropbox folder"
              >
                Change folder
              </button>
              {transaction.side !== "Buy" && (
                <button title="Open an email from your own account with a view-only link to the “- Packet” file in Showing Docs" type="button" className="cma-export-btn" disabled={emailingPacket} onClick={handleEmailShowingPacket}>
                  <Mail size={14} /> {emailingPacket ? "Getting packet…" : "Email Showing Packet"}
                </button>
              )}
            </>
          ) : (
            <>
              <p className="field-help">No Dropbox folder linked yet.</p>
              <button
                type="button"
                className="cma-export-btn"
                onClick={() => setShowFolderPicker((v) => !v)}
                title="Link a Dropbox folder that already exists (e.g. a listing from before HC Flow)"
              >
                <FolderOpen size={14} /> Pair Existing Folder
              </button>
            </>
          )}
          {showFolderPicker && (
            <DropboxFolderPicker
              agentId={transaction.agent_id}
              side={isBuySide ? "Buy" : "Sell"}
              address={transaction.address}
              busy={pairingFolder}
              onPick={handlePairFolder}
              onCancel={() => setShowFolderPicker(false)}
            />
          )}
          {!transaction.dropbox_folder_url && (
            (transaction.stage === "won" || (transaction.side === "Buy" && transaction.stage === "contract")) && (
              <>
                <button title="Create a brand-new Dropbox folder for this deal (with the standard subfolders)"
                  type="button"
                  className="cma-export-btn"
                  disabled={retryingDropbox}
                  onClick={async () => {
                    setRetryingDropbox(true);
                    await onRetryDropboxFolder(transaction.id);
                    setRetryingDropbox(false);
                  }}
                >
                  <FolderOpen size={14} /> {retryingDropbox ? "Creating…" : "Create New Folder"}
                </button>
              </>
            )
          )}
          {transaction.documents?.length ? (
            <ul className="detail-list">
              {transaction.documents.map((d) => (
                <li key={d.id}>
                  {d.name} — {d.status}
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-state">No documents tracked yet.</p>
          )}
        </div>
      )}

      <div className="detail-section">
        <h2 className="comps-section-title">Activity</h2>
        {transaction.activity_log?.length ? (
          <ul className="detail-list">
            {[...transaction.activity_log]
              .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
              .map((a) => (
                <li key={a.id}>
                  <strong>{a.label}</strong>
                  {a.detail ? ` — ${a.detail}` : ""}
                </li>
              ))}
          </ul>
        ) : (
          <p className="empty-state">No activity yet.</p>
        )}
      </div>

      {["won", "market", "contract"].includes(transaction.stage) && (
        <div className="detail-section danger-zone">
          {transaction.terminated_at ? (
            <button title="Bring this terminated deal back to active"
              type="button"
              className="comps-status-btn"
              onClick={() => {
                onReactivate(transaction.id);
                showToast("Deal reactivated");
              }}
            >
              Reactivate Deal
            </button>
          ) : isWonWithoutAgreement ? (
            <p className="field-help">
              Termination requires a signed Listing Agreement — check off "Send Listing Agreement" in the To-Do
              list above once it's signed to enable this.
            </p>
          ) : (
            <>
              {!isBuySide && transaction.stage === "contract" && (
                <>
                  {relistError && <div className="error-banner">{relistError}</div>}
                  <button title="The buyer backed out — put this listing back on the market"
                    type="button"
                    className="comps-status-btn comps-status-btn--danger"
                    onClick={() => setShowRelistConfirm(true)}
                    disabled={relisting}
                  >
                    {relisting ? "Relisting…" : "Buyer Fell Through — Relist"}
                  </button>
                  <p className="field-help">
                    Archives this buyer's Under Contract paperwork and puts the listing back On Market as a fresh
                    deal, linked back to this one for the record — use this instead of Terminate Deal if the seller
                    is still selling, just this buyer fell through.
                  </p>
                </>
              )}
              <button title="The deal fell through — keeps a record, removes it from active pages" type="button" className="comps-status-btn comps-status-btn--danger" onClick={() => setShowTerminateConfirm(true)}>
                Terminate Deal
              </button>
            </>
          )}
        </div>
      )}

      {isBroker && (
        <div className="detail-section danger-zone">
          <button title="Broker only — permanently delete this deal (for test entries and mistakes)" type="button" className="comps-status-btn delete-deal-btn" onClick={() => setShowDeleteConfirm(true)}>
            Delete Deal
          </button>
          <p className="field-help">
            Permanently removes this deal and everything on it — for test entries or mistakes. To keep a record of a
            deal that fell through, use Terminate instead.
          </p>
        </div>
      )}

      <ConfirmDialog
        open={showDeleteConfirm}
        title={`Permanently delete ${transaction.address}?`}
        message="This deletes the deal and all of its to-dos, notes, activity, and commission info. It can't be undone. Its Dropbox folder (if any) is left alone."
        confirmLabel="Delete Forever"
        danger
        onConfirm={async () => {
          setShowDeleteConfirm(false);
          try {
            await deleteTransaction(transaction.id);
            showToast(`Deleted ${transaction.address}`);
            onBack();
            onRefresh();
          } catch (e) {
            showToast(e.message);
          }
        }}
        onCancel={() => setShowDeleteConfirm(false)}
      />

      <ConfirmDialog
        open={showRelistConfirm}
        title="Buyer fell through — relist this listing?"
        message="This terminates this deal (keeping the buyer's info for the record) and creates a fresh active listing at the same address/Dropbox folder for the next buyer."
        promptLabel="Reason (optional)"
        promptPlaceholder="Why did this buyer fall through?"
        confirmLabel="Relist"
        danger
        onConfirm={handleRelistConfirm}
        onCancel={() => setShowRelistConfirm(false)}
      />

      <ConfirmDialog
        open={showTerminateConfirm}
        title="Terminate this deal?"
        message="This can be undone later with Reactivate."
        promptLabel="Reason (optional)"
        promptPlaceholder="Why is this deal being terminated?"
        confirmLabel="Terminate Deal"
        danger
        onConfirm={(reason) => {
          setShowTerminateConfirm(false);
          onTerminate(transaction.id, reason || "");
          showToast("Deal terminated");
        }}
        onCancel={() => setShowTerminateConfirm(false)}
      />
    </div>
  );
}

/** The property/seller details collected on the New Comp form — shown live while
 * in Comps, and preserved (collapsed by default) once the deal moves on so that
 * data isn't lost from view. Most fields are read-only here except via "Edit All"
 * (below) — only Seller Email and the referral note get their own quick pencil-edit,
 * since everything else (radio/checkbox selections) has no single-field editor. */
function CompDetailsGrid({ transaction, handleFieldSave }) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return <CompDetailsEditForm transaction={transaction} handleFieldSave={handleFieldSave} onDone={() => setEditing(false)} />;
  }

  return (
    <div className="detail-grid">
      <div className="detail-grid-full">
        <button title="Edit all of these fields at once" type="button" className="comps-minimize-btn" onClick={() => setEditing(true)}>
          <Pencil size={12} /> Edit All
        </button>
      </div>
      <div>
        <div className="detail-label">Seller Name(s)</div>
        <div>{transaction.seller_name || "—"}</div>
      </div>
      <EditableEmailList
        label="Seller Email(s)"
        values={transaction.seller_emails || []}
        onSave={(emails) => handleFieldSave({ seller_emails: emails })}
      />
      <EditableText
        label="Referral / Lead Source (internal)"
        value={transaction.referral_note}
        placeholder="—"
        onSave={(v) => handleFieldSave({ referral_note: v || null })}
      />
      <div>
        <div className="detail-label">Rough Timeframe</div>
        <div>{transaction.timeframe || "—"}</div>
      </div>
      <div>
        <div className="detail-label">Property Style</div>
        <div>{transaction.property_style || "—"}</div>
      </div>
      <div>
        <div className="detail-label">Electrical</div>
        <div>{transaction.electrical || "—"}</div>
      </div>
      <div>
        <div className="detail-label">Heating System</div>
        <div>{transaction.heating_system?.length ? transaction.heating_system.join(", ") : "—"}</div>
      </div>
      <div>
        <div className="detail-label">Basement</div>
        <div>{transaction.basement?.length ? transaction.basement.join(", ") : "—"}</div>
      </div>
      <div>
        <div className="detail-label">Water Source</div>
        <div>{transaction.water_source || "—"}</div>
      </div>
      <div>
        <div className="detail-label">Septic</div>
        <div>{transaction.septic || "—"}</div>
      </div>
      <div>
        <div className="detail-label">Bedrooms</div>
        <div>{transaction.beds ?? "—"}</div>
      </div>
      <div>
        <div className="detail-label">Bathrooms</div>
        <div>{transaction.baths ?? "—"}</div>
      </div>
      <div>
        <div className="detail-label">Garage Spaces</div>
        <div>{transaction.garage_spaces ?? "—"}</div>
      </div>
      <div>
        <div className="detail-label">Lot Size (acres)</div>
        <div>{transaction.lot_acres ?? "—"}</div>
      </div>
      <div>
        <div className="detail-label">Year Built</div>
        <div>{transaction.year_built ?? "—"}</div>
      </div>
      <div>
        <div className="detail-label">Notable Features / Highlights</div>
        <div>{transaction.features_notes || "—"}</div>
      </div>
      <div>
        <div className="detail-label">Quality of Finishes</div>
        <div>{transaction.finishes_note || "—"}</div>
      </div>
      <div>
        <div className="detail-label">Fuel Type(s)</div>
        <div>{transaction.fuel_types?.length ? transaction.fuel_types.join(", ") : "—"}</div>
      </div>
      <div>
        <div className="detail-label">Private Septic</div>
        <div>{transaction.private_septic || "—"}</div>
      </div>
      <div>
        <div className="detail-label">Private Well</div>
        <div>{transaction.private_well || "—"}</div>
      </div>
      <div>
        <div className="detail-label">View</div>
        <div>{transaction.has_view || "—"}</div>
      </div>
      <div>
        <div className="detail-label">Solar</div>
        <div>{transaction.solar || "—"}</div>
      </div>
      <div>
        <div className="detail-label">Notes on Boundary Lines</div>
        <div>{transaction.boundary_notes || "—"}</div>
      </div>
      <div>
        <div className="detail-label">Recommendations</div>
        <div>{transaction.recommendations?.length ? transaction.recommendations.join(", ") : "—"}</div>
      </div>
    </div>
  );
}

/** Full edit form for every CompDetailsGrid field at once, triggered by "Edit All". */
function CompDetailsEditForm({ transaction, handleFieldSave, onDone }) {
  const [sellerName, setSellerName] = useState(transaction.seller_name || "");
  const [referralNote, setReferralNote] = useState(transaction.referral_note || "");
  const [timeframe, setTimeframe] = useState(transaction.timeframe || "");
  const [propertyStyle, setPropertyStyle] = useState(transaction.property_style || "");
  const [electrical, setElectrical] = useState(transaction.electrical || "");
  const [heatingSystem, setHeatingSystem] = useState(transaction.heating_system || []);
  const [basement, setBasement] = useState(transaction.basement || []);
  const [waterSource, setWaterSource] = useState(transaction.water_source || "");
  const [septic, setSeptic] = useState(transaction.septic || "");
  const [beds, setBeds] = useState(transaction.beds ?? "");
  const [baths, setBaths] = useState(transaction.baths ?? "");
  const [garageSpaces, setGarageSpaces] = useState(transaction.garage_spaces ?? "");
  const [lotAcres, setLotAcres] = useState(transaction.lot_acres ?? "");
  const [yearBuilt, setYearBuilt] = useState(transaction.year_built ?? "");
  const [featuresNotes, setFeaturesNotes] = useState(transaction.features_notes || "");
  const [finishesNote, setFinishesNote] = useState(transaction.finishes_note || "");
  const [fuelTypes, setFuelTypes] = useState(transaction.fuel_types || []);
  const [privateSeptic, setPrivateSeptic] = useState(transaction.private_septic || NOT_SPECIFIED);
  const [privateWell, setPrivateWell] = useState(transaction.private_well || NOT_SPECIFIED);
  const [hasView, setHasView] = useState(transaction.has_view || NOT_SPECIFIED);
  const [solar, setSolar] = useState(transaction.solar || NOT_SPECIFIED);
  const [boundaryNotes, setBoundaryNotes] = useState(transaction.boundary_notes || "");
  const [recommendations, setRecommendations] = useState(transaction.recommendations || []);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await handleFieldSave({
        seller_name: sellerName || null,
        referral_note: referralNote || null,
        timeframe: timeframe || null,
        property_style: propertyStyle || null,
        electrical: electrical || null,
        heating_system: heatingSystem,
        basement,
        water_source: waterSource || null,
        septic: septic || null,
        beds: beds === "" ? null : Number(beds),
        baths: baths === "" ? null : Number(baths),
        garage_spaces: garageSpaces === "" ? null : Number(garageSpaces),
        lot_acres: lotAcres === "" ? null : Number(lotAcres),
        year_built: yearBuilt === "" ? null : Number(yearBuilt),
        features_notes: featuresNotes || null,
        finishes_note: finishesNote || null,
        fuel_types: fuelTypes,
        private_septic: privateSeptic === NOT_SPECIFIED ? null : privateSeptic,
        private_well: privateWell === NOT_SPECIFIED ? null : privateWell,
        has_view: hasView === NOT_SPECIFIED ? null : hasView,
        solar: solar === NOT_SPECIFIED ? null : solar,
        boundary_notes: boundaryNotes || null,
        recommendations,
      });
      onDone();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="uc-form comp-edit-all" onKeyDown={focusNextOnEnter}>
      <label>
        Seller Name(s)
        <input value={sellerName} onChange={(e) => setSellerName(e.target.value)} />
      </label>
      <label>
        Referral / Lead Source (internal)
        <input value={referralNote} onChange={(e) => setReferralNote(e.target.value)} />
      </label>

      <fieldset>
        <legend>Rough Timeframe</legend>
        <RadioGroup name="timeframe" value={timeframe} onChange={setTimeframe} options={TIMEFRAMES} />
      </fieldset>

      <fieldset>
        <legend>Property Type</legend>
        <RadioGroup name="propertyStyle" value={propertyStyle} onChange={setPropertyStyle} options={PROPERTY_STYLES} />
      </fieldset>

      <fieldset>
        <legend>Electrical</legend>
        <RadioGroup name="electrical" value={electrical} onChange={setElectrical} options={ELECTRICAL_OPTIONS} />
      </fieldset>

      <fieldset>
        <legend>Heating System</legend>
        <CheckboxGroup name="heatingSystem" values={heatingSystem} onChange={setHeatingSystem} options={HEATING_OPTIONS} />
      </fieldset>

      <fieldset>
        <legend>Basement</legend>
        <CheckboxGroup name="basement" values={basement} onChange={setBasement} options={BASEMENT_OPTIONS} />
      </fieldset>

      <label>
        Water Source (and where it is)
        <input value={waterSource} onChange={(e) => setWaterSource(e.target.value)} />
      </label>
      <label>
        Septic (type and where it is)
        <input value={septic} onChange={(e) => setSeptic(e.target.value)} />
      </label>

      <fieldset>
        <legend>Subject Property Stats</legend>
        <label>
          Bedrooms
          <input type="number" min="0" value={beds} onChange={(e) => setBeds(e.target.value)} />
        </label>
        <label>
          Bathrooms
          <input type="number" min="0" step="0.5" value={baths} onChange={(e) => setBaths(e.target.value)} />
        </label>
        <label>
          Garage Spaces
          <input type="number" min="0" value={garageSpaces} onChange={(e) => setGarageSpaces(e.target.value)} />
        </label>
        <label>
          Lot Size (acres)
          <input type="number" min="0" step="any" value={lotAcres} onChange={(e) => setLotAcres(e.target.value)} />
        </label>
        <label>
          Year Built
          <input type="number" min="1700" max="2100" value={yearBuilt} onChange={(e) => setYearBuilt(e.target.value)} />
        </label>
        <label>
          Notable Features / Highlights
          <textarea value={featuresNotes} onChange={(e) => setFeaturesNotes(e.target.value)} rows={2} />
        </label>
        <label>
          Quality of Finishes
          <textarea value={finishesNote} onChange={(e) => setFinishesNote(e.target.value)} rows={2} />
        </label>
        <div>
          <div className="detail-label">Fuel Type(s)</div>
          <CheckboxGroup name="fuelTypes" values={fuelTypes} onChange={setFuelTypes} options={FUEL_TYPE_OPTIONS} />
        </div>
        <label>
          Private Septic
          <select value={privateSeptic} onChange={(e) => setPrivateSeptic(e.target.value)}>
            {YES_NO_OPTIONS.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </label>
        <label>
          Private Well
          <select value={privateWell} onChange={(e) => setPrivateWell(e.target.value)}>
            {YES_NO_OPTIONS.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </label>
        <label>
          View
          <select value={hasView} onChange={(e) => setHasView(e.target.value)}>
            {YES_NO_OPTIONS.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </label>
        <label>
          Solar
          <select value={solar} onChange={(e) => setSolar(e.target.value)}>
            {SOLAR_OPTIONS.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </label>
        <label>
          Notes on Boundary Lines
          <textarea value={boundaryNotes} onChange={(e) => setBoundaryNotes(e.target.value)} rows={2} />
        </label>
      </fieldset>

      <fieldset>
        <legend>Recommendations</legend>
        <CheckboxGroup name="recommendations" values={recommendations} onChange={setRecommendations} options={recommendationOptionsFor(propertyStyle)} />
      </fieldset>

      <div className="comp-edit-all-actions">
        <button title="Discard changes" type="button" onClick={onDone} disabled={saving}>
          Cancel
        </button>
        <button title="Save changes" type="button" className="google-btn" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

/** Read view of every provider at once, with one "Edit All" button that turns
 * the whole section into a form (text inputs, plus radios for Water/Septic)
 * saved in a single write — much faster for bulk entry than a pencil per
 * field. Opens straight into edit mode when nothing's been entered yet. */
function UtilityProvidersEditor({ utilities: rawUtilities, onSave }) {
  const utilities = normalizeUtilities(rawUtilities);
  const hasAny = Object.values(utilities || {}).some(Boolean);
  const [editing, setEditing] = useState(!hasAny);
  const [draft, setDraft] = useState(utilities || {});
  const [saving, setSaving] = useState(false);

  if (!editing) {
    return (
      <>
        <div className="detail-grid">
          {visibleUtilityFields(utilities).map((f) => (
            <div key={f.key}>
              <div className="detail-label">{f.key}</div>
              <div className={utilities?.[f.key] ? "" : "editable-missing"}>{utilities?.[f.key] || "Not set"}</div>
            </div>
          ))}
        </div>
        <button title="Edit all of these fields at once" type="button" className="comps-status-btn utility-edit-all-btn" onClick={() => setEditing(true)}>
          <Pencil size={12} /> Edit All
        </button>
      </>
    );
  }

  async function save() {
    const next = {};
    for (const f of visibleUtilityFields(draft)) {
      const v = String(draft[f.key] ?? "").trim();
      if (v) next[f.key] = v;
    }
    setSaving(true);
    try {
      await onSave(next);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="utility-edit-form"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      onKeyDown={focusNextOnEnter}
    >
      {visibleUtilityFields(draft).map((f) =>
        f.options ? (
          <div key={f.key} className="utility-edit-radio">
            <div className="detail-label">{f.key}</div>
            <RadioGroup
              name={`utility-${f.key}`}
              value={draft[f.key] || ""}
              onChange={(v) => setDraft((d) => ({ ...d, [f.key]: v }))}
              options={f.options}
            />
          </div>
        ) : (
          <label key={f.key}>
            {f.key}
            <input
              list={f.suggestions ? `utility-suggest-${f.key}` : undefined}
              value={draft[f.key] || ""}
              onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
              placeholder={f.suggestions ? "Pick one, or type another" : "Provider name"}
            />
            {f.suggestions && (
              <datalist id={`utility-suggest-${f.key}`}>
                {f.suggestions.map((o) => (
                  <option key={o} value={o} />
                ))}
              </datalist>
            )}
          </label>
        )
      )}
      <div className="utility-edit-actions">
        <button title="Save the utility providers" type="submit" className="google-btn" disabled={saving}>
          {saving ? "Saving…" : "Save Utilities"}
        </button>
        {hasAny && (
          <button title="Discard changes"
            type="button"
            className="comps-status-btn"
            disabled={saving}
            onClick={() => {
              setDraft(utilities || {});
              setEditing(false);
            }}
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

/** Shows a value, or an edit icon + inline text input when it's missing/TBD.
 * `editableWhenSet` keeps the pencil visible after a value is saved too (e.g.
 * attorneys, which do change occasionally) — off by default because some
 * callers pass a formatted display value (like "$350,000") that can't be
 * edited back as-is. */
/** `rawValue`: what goes in the input when it differs from the display
 * `value` (e.g. a date shown as "October 1, 2026" but edited as 2026-10-01).
 * `field`: data-field for the Missing Info jump. */
function EditableText({ label, value, rawValue, placeholder, type = "text", attorneyList, onSave, editableWhenSet = false, field }) {
  const editValue = (rawValue !== undefined ? rawValue : value) || "";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(editValue);

  function startEditing() {
    setDraft(editValue);
    setEditing(true);
  }

  if (!value && !editing) {
    return (
      <div data-field={field}>
        <div className="detail-label">{label}</div>
        <div className="editable-missing">
          {placeholder}
          <button title="Edit" type="button" className="edit-icon-btn" onClick={startEditing}>
            <Pencil size={12} />
          </button>
        </div>
      </div>
    );
  }

  if (editing) {
    const listId = attorneyList ? `attorney-list-${label.replace(/\s+/g, "-")}` : undefined;
    return (
      <div data-field={field}>
        <div className="detail-label">{label}</div>
        <input
          type={type}
          list={listId}
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            setEditing(false);
            if (draft !== editValue) onSave(draft);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setDraft(editValue);
              setEditing(false);
            }
          }}
        />
        {attorneyList && (
          <datalist id={listId}>
            {attorneyList.map((a) => (
              <option key={a.id} value={a.name} />
            ))}
          </datalist>
        )}
      </div>
    );
  }

  return (
    <div data-field={field}>
      <div className="detail-label">{label}</div>
      {editableWhenSet ? (
        <div className="editable-missing editable-set">
          {value}
          <button type="button" className="edit-icon-btn" onClick={startEditing} aria-label={`Edit ${label}`} title={`Edit ${label}`}>
            <Pencil size={12} />
          </button>
        </div>
      ) : (
        <div>{value}</div>
      )}
    </div>
  );
}

/** Read-only list of mailto pills with a single pencil that reveals an add/remove/edit
 * form for all of them at once — any number of emails, not just one. */
function EditableEmailList({ label, values, onSave, field }) {
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState(values.length ? values : [""]);

  function startEditing() {
    setDrafts(values.length ? values : [""]);
    setEditing(true);
  }

  function updateDraft(i, v) {
    setDrafts((d) => d.map((x, idx) => (idx === i ? v : x)));
  }
  function removeDraft(i) {
    setDrafts((d) => d.filter((_, idx) => idx !== i));
  }
  function addDraft() {
    setDrafts((d) => [...d, ""]);
  }
  function save() {
    setEditing(false);
    onSave(drafts.map((v) => v.trim()).filter(Boolean));
  }

  if (editing) {
    return (
      <div className="detail-grid-full" data-field={field}>
        <div className="detail-label">{label}</div>
        {drafts.map((v, i) => (
          <div key={i} className="email-list-input-row">
            <input type="email" autoFocus={i === 0} value={v} onChange={(e) => updateDraft(i, e.target.value)} />
            {drafts.length > 1 && (
              <button title="Remove this email" type="button" className="email-list-remove-btn" onClick={() => removeDraft(i)} aria-label="Remove email">
                ×
              </button>
            )}
          </div>
        ))}
        <button title="Add another email address" type="button" className="email-list-add-btn" onClick={addDraft}>
          + Add another email
        </button>
        <div className="comp-edit-all-actions">
          <button title="Discard changes" type="button" onClick={() => setEditing(false)}>
            Cancel
          </button>
          <button title="Save" type="button" className="google-btn" onClick={save}>
            Save
          </button>
        </div>
      </div>
    );
  }

  return (
    <div data-field={field}>
      <div className="detail-label">{label}</div>
      {values.length ? (
        values.map((email) => (
          <div key={email} className="editable-filled">
            <a href={emailComposeUrl({ to: [email] })} target={emailLinkTarget()} rel="noreferrer" className="edit-icon-btn edit-icon-btn--leading" title={`Email ${email}`}>
              <Mail size={12} />
            </a>
            <span className="editable-filled-text">{email}</span>
          </div>
        ))
      ) : (
        <div className="editable-missing">—</div>
      )}
      <button title="Edit" type="button" className="edit-icon-btn" onClick={startEditing}>
        <Pencil size={12} />
      </button>
    </div>
  );
}

function EditableSelect({ label, value, options, onSave, field }) {
  const [editing, setEditing] = useState(false);

  if (!value && !editing) {
    return (
      <div data-field={field}>
        <div className="detail-label">{label}</div>
        <div className="editable-missing">
          —
          <button title="Edit" type="button" className="edit-icon-btn" onClick={() => setEditing(true)}>
            <Pencil size={12} />
          </button>
        </div>
      </div>
    );
  }

  if (editing) {
    return (
      <div data-field={field}>
        <div className="detail-label">{label}</div>
        <select
          autoFocus
          defaultValue={value || ""}
          onChange={(e) => {
            setEditing(false);
            onSave(e.target.value);
          }}
          onBlur={() => setEditing(false)}
        >
          <option value="" disabled>
            Choose…
          </option>
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div data-field={field}>
      <div className="detail-label">{label}</div>
      <div>{value}</div>
    </div>
  );
}

/** Fix a typo'd address, the town, or VT/NH (which decides the Xero trust
 * account for deposits and which state the commission income lands under). */
function AddressEditor({ transaction, onSave, onCancel }) {
  const [address, setAddress] = useState(transaction.address || "");
  const [town, setTown] = useState(transaction.town || "");
  const [region, setRegion] = useState(transaction.region || "");
  const [zip, setZip] = useState(transaction.zip || "");
  const [saving, setSaving] = useState(false);
  const hasFolder = Boolean(transaction.dropbox_folder_path);
  const hasZipColumn = "zip" in transaction;

  async function submit(e) {
    e.preventDefault();
    if (!address.trim()) return;
    setSaving(true);
    try {
      const locationChanged =
        address.trim() !== (transaction.address || "") || town.trim() !== (transaction.town || "") || (region || "") !== (transaction.region || "");
      const zipTyped = zip.trim() !== (transaction.zip || "");
      const patch = { address: address.trim(), town: town.trim() || null, region: region || null };
      // A zip typed by hand wins; otherwise a moved address gets a fresh lookup.
      if (hasZipColumn && zipTyped) patch.zip = zip.trim() || null;
      else if (hasZipColumn && locationChanged) patch.zip = null;
      await onSave(patch, { lookUpZip: hasZipColumn && !zipTyped && (locationChanged || !transaction.zip) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="address-edit-form" onSubmit={submit}>
      <div data-field="address">
        <div className="detail-label">Address</div>
        <input autoFocus value={address} onChange={(e) => setAddress(e.target.value)} required />
      </div>
      <div data-field="town">
        <div className="detail-label">Town</div>
        <input value={town} onChange={(e) => setTown(e.target.value)} />
      </div>
      <div className="address-edit-row">
        <div data-field="region" style={{ flex: 1 }}>
          <div className="detail-label">State</div>
          <RadioGroup name={`region-${transaction.id}`} value={region} onChange={setRegion} options={["VT", "NH"]} />
        </div>
        {hasZipColumn && (
          <div data-field="zip" style={{ width: 110 }}>
            <div className="detail-label">Zip</div>
            <input value={zip} onChange={(e) => setZip(e.target.value)} inputMode="numeric" maxLength={10} placeholder="Auto" />
          </div>
        )}
      </div>
      {hasFolder && address.trim() !== (transaction.address || "") && (
        <div className="address-dropbox-note">Heads up: this doesn't rename the Dropbox folder — rename that in Dropbox if you want them to match.</div>
      )}
      <div className="address-edit-actions">
        <button type="submit" disabled={saving} title="Save address, town, and state">
          {saving ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={onCancel} disabled={saving} title="Discard changes">
          Cancel
        </button>
      </div>
    </form>
  );
}
