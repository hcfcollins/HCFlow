import { useEffect, useState } from "react";
import { Pencil, Mail, FileText, FolderOpen, ChevronDown } from "lucide-react";
import TodoList from "./TodoList";
import RadioGroup from "./RadioGroup";
import CheckboxGroup from "./CheckboxGroup";
import GenerateCompForm from "./GenerateCompForm";
import { fetchAttorneys, resolveAttorneyId, updateTransactionFields, updateTransactionAttorneys } from "../lib/transactions";
import {
  PROPERTY_STYLES,
  TIMEFRAMES,
  ELECTRICAL_OPTIONS,
  HEATING_OPTIONS,
  BASEMENT_OPTIONS,
  RECOMMENDATION_OPTIONS,
} from "../lib/compFieldOptions";

/** Formats a "YYYY-MM-DD" date string as "Month Day, Year"; returns other formats unchanged. */
function formatDate(dateStr) {
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
  stages,
  currentAgent,
  onBack,
  onStageChange,
  onNotesChange,
  onCompsStatusChange,
  onAddTodo,
  onToggleTodo,
  onLockboxChange,
  onRefresh,
  onRetryDropboxFolder,
  onTerminate,
  onReactivate,
}) {
  const isBroker = currentAgent.role === "broker";
  const isActiveListing = transaction.stage === "won" || transaction.stage === "market";
  const isBuySide = transaction.side === "Buy";
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
  const [showGenerateComp, setShowGenerateComp] = useState(false);

  useEffect(() => {
    fetchAttorneys().then(setAttorneys).catch(() => {});
  }, []);

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

  async function handleFieldSave(patch) {
    await updateTransactionFields(transaction.id, patch);
    onRefresh();
  }

  async function handleAttorneySave(side, name) {
    const id = await resolveAttorneyId(name, attorneys);
    await updateTransactionAttorneys(transaction.id, side === "buyer" ? { buyerAttorneyId: id } : { sellerAttorneyId: id });
    onRefresh();
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

  return (
    <div className="deal-detail">
      <header className="app-header">
        <div>
          <div className="brand-eyebrow">{transaction.town || transaction.side}</div>
          <h1>{transaction.address}</h1>
        </div>
        <button type="button" onClick={onBack}>
          Back
        </button>
      </header>

      {transaction.terminated_at && (
        <div className="error-banner">
          <strong>Terminated</strong> {formatDate(transaction.terminated_at.slice(0, 10))}
          {transaction.termination_reason ? ` — ${transaction.termination_reason}` : ""}
        </div>
      )}

      <label>
        Stage
        <select
          value={transaction.stage}
          onChange={(e) => onStageChange(transaction, e.target.value)}
          className="stage-select"
        >
          {stages.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
      </label>

      {transaction.stage === "comps" && onCompsStatusChange && (
        <div className="comps-status-toggle">
          <span className="comps-status-toggle-label">Move to:</span>
          {transaction.comps_status === "Waiting to List" ? (
            <button
              type="button"
              className="comps-status-btn"
              onClick={() => onCompsStatusChange(transaction.id, "Need to Send Comp")}
            >
              Need to Send Comp
            </button>
          ) : (
            <button
              type="button"
              className="comps-status-btn"
              onClick={() => onCompsStatusChange(transaction.id, "Waiting to List")}
            >
              Waiting to List
            </button>
          )}
          <button type="button" className="comps-status-btn" onClick={() => onStageChange(transaction, "won")}>
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

      <div className="detail-section">
        <h2 className="comps-section-title">Comp / CMA</h2>
        <button type="button" className="cma-export-btn" onClick={() => setShowGenerateComp(true)}>
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

      {transaction.stage !== "comps" && (
        <div className="detail-section">
          <button
            type="button"
            className="comps-section-header comps-collapse-toggle"
            onClick={() => setCompDetailsCollapsed((c) => !c)}
          >
            <h2 className="comps-section-title">Comp Data</h2>
            <ChevronDown size={18} className={`collapse-chevron ${compDetailsCollapsed ? "" : "collapse-chevron--open"}`} />
          </button>
          {!compDetailsCollapsed && <CompDetailsGrid transaction={transaction} handleFieldSave={handleFieldSave} />}
        </div>
      )}

      {transaction.stage !== "comps" && (
        <div className="detail-section">
          <h2 className="comps-section-title">Listing Details</h2>
          <div className="detail-grid">
            <EditableText
              label="Price"
              value={transaction.price ? `$${Number(transaction.price).toLocaleString()}` : ""}
              type="number"
              placeholder="e.g. 350000"
              onSave={(v) => handleFieldSave({ price: v ? Number(v) : null })}
            />

            {!isBuySide && (
              <EditableText
                label="Buyer Agency Commission"
                value={transaction.ba_comp}
                placeholder="e.g. 2.5%"
                onSave={(v) => handleFieldSave({ ba_comp: v || null })}
              />
            )}

            <EditableSelect
              label="Property Style"
              value={transaction.property_style}
              options={PROPERTY_STYLES}
              onSave={(v) => handleFieldSave({ property_style: v })}
            />

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

            <EditableText
              label={isBuySide ? "Buyer Email" : "Seller Email"}
              value={transaction.seller_email}
              type="email"
              placeholder="—"
              mailto
              onSave={(v) => handleFieldSave({ seller_email: v || null })}
            />

            {!isActiveListing && (
              <>
                <div>
                  <div className="detail-label">Side</div>
                  <div>{transaction.side}</div>
                </div>

                {isBroker && (
                  <div>
                    <div className="detail-label">Agent</div>
                    <div>{transaction.agent?.name || "—"}</div>
                  </div>
                )}

                <EditableText
                  label="Buyer Attorney"
                  value={transaction.buyer_attorney?.name}
                  placeholder="TBD"
                  attorneyList={attorneys}
                  onSave={(v) => handleAttorneySave("buyer", v)}
                />

                <EditableText
                  label="Seller Attorney"
                  value={transaction.seller_attorney?.name}
                  placeholder="TBD"
                  attorneyList={attorneys}
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

      {transaction.stage === "won" && (
        <div className="detail-section">
          <h2 className="comps-section-title">To-Do</h2>
          <TodoList
            todos={transaction.todos}
            onAdd={(text) => onAddTodo(transaction.id, text)}
            onToggle={onToggleTodo}
          />
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

      {isBroker && (transaction.stage === "contract" || transaction.stage === "closed") && (
        <div className="detail-section">
          <h2 className="comps-section-title">Under Contract Details</h2>
          <p className="field-help">Broker-only — collected from the Under Contract form.</p>
          <div className="detail-grid">
            <div>
              <div className="detail-label">Commission %</div>
              <div>{transaction.closeouts?.commission_pct ?? "—"}</div>
            </div>
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
            <div>
              <div className="detail-label">Closing Date</div>
              <div>{formatDate(transaction.next_date) || "—"}</div>
            </div>
            <div>
              <div className="detail-label">Inspection Deadline</div>
              <div>{formatDate(transaction.commission_data?.inspection_date) || "—"}</div>
            </div>
            <div>
              <div className="detail-label">Financing Date</div>
              <div>{formatDate(transaction.commission_data?.financing_date) || "—"}</div>
            </div>
            <div>
              <div className="detail-label">Appraiser</div>
              <div>{transaction.commission_data?.appraiser || "—"}</div>
            </div>
          </div>
        </div>
      )}

      {transaction.stage !== "comps" && (
        <div className="detail-section">
          <h2 className="comps-section-title">Documents</h2>
          <p className="field-help">Files live in Dropbox — this list tracks status only.</p>
          {transaction.dropbox_folder_url ? (
            <a href={transaction.dropbox_folder_url} target="_blank" rel="noreferrer" className="cma-export-btn">
              <FolderOpen size={14} /> Open Dropbox Folder
            </a>
          ) : (
            transaction.stage === "won" && (
              <>
                <p className="field-help">Dropbox folder not created yet.</p>
                <button
                  type="button"
                  className="cma-export-btn"
                  disabled={retryingDropbox}
                  onClick={async () => {
                    setRetryingDropbox(true);
                    await onRetryDropboxFolder(transaction.id);
                    setRetryingDropbox(false);
                  }}
                >
                  <FolderOpen size={14} /> {retryingDropbox ? "Creating…" : "Retry Dropbox Folder"}
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
            <button type="button" className="comps-status-btn" onClick={() => onReactivate(transaction.id)}>
              Reactivate Deal
            </button>
          ) : isWonWithoutAgreement ? (
            <p className="field-help">
              Termination requires a signed Listing Agreement — check off "Send Listing Agreement" in the To-Do
              list above once it's signed to enable this.
            </p>
          ) : (
            <button
              type="button"
              className="comps-status-btn comps-status-btn--danger"
              onClick={() => {
                if (!window.confirm("Are you sure you want to terminate this deal? This can be undone later with Reactivate.")) {
                  return;
                }
                const reason = window.prompt("Why is this deal being terminated? (optional)") || "";
                onTerminate(transaction.id, reason);
              }}
            >
              Terminate Deal
            </button>
          )}
        </div>
      )}
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
        <button type="button" className="comps-minimize-btn" onClick={() => setEditing(true)}>
          <Pencil size={12} /> Edit All
        </button>
      </div>
      <div>
        <div className="detail-label">Seller Name(s)</div>
        <div>{transaction.seller_name || "—"}</div>
      </div>
      <EditableText
        label="Seller Email"
        value={transaction.seller_email}
        type="email"
        placeholder="—"
        mailto
        onSave={(v) => handleFieldSave({ seller_email: v || null })}
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
        <div className="detail-label">Recommendations</div>
        <div>{transaction.recommendations?.length ? transaction.recommendations.join(", ") : "—"}</div>
      </div>
    </div>
  );
}

/** Full edit form for every CompDetailsGrid field at once, triggered by "Edit All". */
function CompDetailsEditForm({ transaction, handleFieldSave, onDone }) {
  const [sellerName, setSellerName] = useState(transaction.seller_name || "");
  const [sellerEmail, setSellerEmail] = useState(transaction.seller_email || "");
  const [referralNote, setReferralNote] = useState(transaction.referral_note || "");
  const [timeframe, setTimeframe] = useState(transaction.timeframe || "");
  const [propertyStyle, setPropertyStyle] = useState(transaction.property_style || "");
  const [electrical, setElectrical] = useState(transaction.electrical || "");
  const [heatingSystem, setHeatingSystem] = useState(transaction.heating_system || []);
  const [basement, setBasement] = useState(transaction.basement || []);
  const [waterSource, setWaterSource] = useState(transaction.water_source || "");
  const [septic, setSeptic] = useState(transaction.septic || "");
  const [recommendations, setRecommendations] = useState(transaction.recommendations || []);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await handleFieldSave({
        seller_name: sellerName || null,
        seller_email: sellerEmail || null,
        referral_note: referralNote || null,
        timeframe: timeframe || null,
        property_style: propertyStyle || null,
        electrical: electrical || null,
        heating_system: heatingSystem,
        basement,
        water_source: waterSource || null,
        septic: septic || null,
        recommendations,
      });
      onDone();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="uc-form comp-edit-all">
      <label>
        Seller Name(s)
        <input value={sellerName} onChange={(e) => setSellerName(e.target.value)} />
      </label>
      <label>
        Seller Email
        <input type="email" value={sellerEmail} onChange={(e) => setSellerEmail(e.target.value)} />
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
        <legend>Recommendations</legend>
        <CheckboxGroup name="recommendations" values={recommendations} onChange={setRecommendations} options={RECOMMENDATION_OPTIONS} />
      </fieldset>

      <div className="comp-edit-all-actions">
        <button type="button" onClick={onDone} disabled={saving}>
          Cancel
        </button>
        <button type="button" className="google-btn" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

/** Shows a value, or an edit icon + inline text input when it's missing/TBD. */
function EditableText({ label, value, placeholder, type = "text", attorneyList, mailto, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || "");

  if (!value && !editing) {
    return (
      <div>
        <div className="detail-label">{label}</div>
        <div className="editable-missing">
          {placeholder}
          <button type="button" className="edit-icon-btn" onClick={() => setEditing(true)}>
            <Pencil size={12} />
          </button>
        </div>
      </div>
    );
  }

  if (editing) {
    const listId = attorneyList ? `attorney-list-${label.replace(/\s+/g, "-")}` : undefined;
    return (
      <div>
        <div className="detail-label">{label}</div>
        <input
          type={type}
          list={listId}
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            setEditing(false);
            onSave(draft);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
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
    <div>
      <div className="detail-label">{label}</div>
      {mailto ? (
        <div className="editable-filled">
          <a href={`mailto:${value}`} className="edit-icon-btn edit-icon-btn--leading" title="Email seller">
            <Mail size={12} />
          </a>
          <span className="editable-filled-text">{value}</span>
        </div>
      ) : (
        <div>{value}</div>
      )}
    </div>
  );
}

function EditableSelect({ label, value, options, onSave }) {
  const [editing, setEditing] = useState(false);

  if (!value && !editing) {
    return (
      <div>
        <div className="detail-label">{label}</div>
        <div className="editable-missing">
          —
          <button type="button" className="edit-icon-btn" onClick={() => setEditing(true)}>
            <Pencil size={12} />
          </button>
        </div>
      </div>
    );
  }

  if (editing) {
    return (
      <div>
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
    <div>
      <div className="detail-label">{label}</div>
      <div>{value}</div>
    </div>
  );
}
