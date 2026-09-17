import { useEffect, useState } from "react";
import { Pencil, Mail } from "lucide-react";
import TodoList from "./TodoList";
import RadioGroup from "./RadioGroup";
import { fetchAttorneys, resolveAttorneyId, updateTransactionFields, updateTransactionAttorneys } from "../lib/transactions";

const PROPERTY_STYLES = ["Residential", "Land", "Commercial"];

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
}) {
  const isBroker = currentAgent.role === "broker";
  const isActiveListing = transaction.stage === "won" || transaction.stage === "market";
  const isBuySide = transaction.side === "Buy";
  const [lockboxCode, setLockboxCode] = useState(transaction.lockbox_code || "");
  const [lockboxNote, setLockboxNote] = useState(transaction.lockbox_note || "");
  const [attorneys, setAttorneys] = useState([]);

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
          {["Need to Send Comp", "Waiting to List"].map((status) => (
            <button
              key={status}
              type="button"
              className={`comps-status-btn ${transaction.comps_status === status ? "active" : ""}`}
              onClick={() => onCompsStatusChange(transaction.id, status)}
            >
              {status}
            </button>
          ))}
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
              <div>
                <div className="detail-label">Sign</div>
                <RadioGroup
                  name="signStatus"
                  value={transaction.sign_status || "No"}
                  onChange={(v) => handleFieldSave({ sign_status: v })}
                  options={[
                    { value: "Yes", label: "Yes" },
                    { value: "No", label: "Not yet" },
                    { value: "Seller Declined", label: "Seller doesn't want one" },
                  ]}
                />
              </div>
            )}

            <EditableText
              label="Seller Email"
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

      <div className="detail-section">
        <h2 className="comps-section-title">Documents</h2>
        <p className="field-help">Files live in Dropbox — this list tracks status only.</p>
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
          <span>{value}</span>
          <a href={`mailto:${value}`} className="edit-icon-btn" title="Email seller">
            <Mail size={12} />
          </a>
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
