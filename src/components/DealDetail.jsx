import { useEffect, useState } from "react";
import { Pencil } from "lucide-react";
import TodoList from "./TodoList";
import { fetchAttorneys, resolveAttorneyId, updateTransactionFields, updateTransactionAttorneys } from "../lib/transactions";

const PROPERTY_STYLES = ["Residential", "Land", "Commercial"];

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
          <h2 className="comps-section-title">Deal Info</h2>
          <div className="detail-grid">
            <div>
              <div className="detail-label">Side</div>
              <div>{transaction.side}</div>
            </div>

            <EditableSelect
              label="Property Style"
              value={transaction.property_style}
              options={PROPERTY_STYLES}
              onSave={(v) => handleFieldSave({ property_style: v })}
            />

            <EditableText
              label="Price"
              value={transaction.price ? `$${Number(transaction.price).toLocaleString()}` : ""}
              type="number"
              placeholder="e.g. 350000"
              onSave={(v) => handleFieldSave({ price: v ? Number(v) : null })}
            />

            <EditableText
              label="Buyer Agency Commission"
              value={transaction.ba_comp}
              placeholder="e.g. 2.5%"
              onSave={(v) => handleFieldSave({ ba_comp: v || null })}
            />

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

            <div>
              <div className="detail-label">Sign</div>
              <label className="tbd-toggle">
                <input
                  type="checkbox"
                  checked={!!transaction.has_sign}
                  onChange={(e) => handleFieldSave({ has_sign: e.target.checked })}
                />
                Sign is up
              </label>
            </div>
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
function EditableText({ label, value, placeholder, type = "text", attorneyList, onSave }) {
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
      <div>{value}</div>
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
