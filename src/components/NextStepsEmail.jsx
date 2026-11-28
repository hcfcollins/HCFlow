// "Congratulations! Next Steps!" email to a buyer who just went under
// contract: dates from the deal, the agent can edit everything, and the deal's
// contract / disclosure / agency docs from Dropbox are attached.
import { useEffect, useRef, useState } from "react";
import { X, Mail } from "lucide-react";
import { useToast } from "../lib/ToastContext";
import { supabase } from "../lib/supabaseClient";
import { previewNextStepsEmail, sendNextStepsEmail } from "../lib/transactions";
import { buildNextStepsHtml, nextStepsDefaults, nextStepsSubject } from "../lib/nextStepsEmail";

export default function NextStepsEmail({ transaction, defaults, agentName, onClose }) {
  const showToast = useToast();
  const [fields, setFields] = useState({ ...nextStepsDefaults(transaction), ...(defaults || {}) });
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState(nextStepsSubject(transaction));
  const [preview, setPreview] = useState(null);
  const [edited, setEdited] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const bodyRef = useRef(null);
  const name = agentName || transaction.agent?.name || "";

  useEffect(() => {
    previewNextStepsEmail(transaction.id)
      .then((p) => {
        setPreview(p);
        if (p.to?.length) setTo((cur) => cur || p.to.join(", "));
      })
      .catch((e) => setPreview({ files: [], error: e.message }));
  }, [transaction.id]);

  // Rebuild the body from the dates until the agent starts editing the text.
  useEffect(() => {
    if (!edited && bodyRef.current) bodyRef.current.innerHTML = buildNextStepsHtml(transaction, fields, name);
  }, [fields, edited, name]);

  const set = (k) => (e) => setFields((f) => ({ ...f, [k]: e.target.value }));

  async function send() {
    const list = to.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
    if (!list.length) return setError("Add the client's email address.");
    setSending(true);
    setError(null);
    try {
      const r = await sendNextStepsEmail(transaction.id, { to: list, subject, html: bodyRef.current?.innerHTML || "" });
      // Remember the client's email on the deal if it didn't have one.
      if (!preview?.to?.length) {
        await supabase.from("transactions").update({ seller_emails: list }).eq("id", transaction.id);
      }
      showToast(`Next Steps email sent to ${r.to.join(", ")}${r.files?.length ? ` with ${r.files.length} file${r.files.length === 1 ? "" : "s"}` : ""}`);
      window.dispatchEvent(new Event("hcflow:refresh"));
      onClose(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="modal-backdrop next-steps-backdrop" role="dialog" aria-modal="true" aria-label="Next Steps email">
      <div className="next-steps-modal">
        <div className="next-steps-head">
          <strong>
            <Mail size={16} style={{ verticalAlign: -3 }} /> Send the buyer a Next Steps email?
          </strong>
          <button type="button" className="license-mini-btn" onClick={() => onClose(false)} aria-label="Close">
            <X size={14} />
          </button>
        </div>
        {error && <div className="error-banner">{error}</div>}

        <label className="next-steps-field">
          To
          <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="buyer@email.com, second buyer…" />
        </label>
        <label className="next-steps-field">
          Subject
          <input value={subject} onChange={(e) => setSubject(e.target.value)} />
        </label>

        <div className="next-steps-dates">
          <label>
            Deposit amount
            <input type="number" value={fields.depositAmount} onChange={set("depositAmount")} placeholder="5000" />
          </label>
          <label>
            Deposit due
            <input type="date" value={fields.depositDate} onChange={set("depositDate")} />
          </label>
          <label>
            2nd deposit amount
            <input type="number" value={fields.secondDepositAmount} onChange={set("secondDepositAmount")} placeholder="none" />
          </label>
          <label>
            2nd deposit due
            <input type="date" value={fields.secondDepositDate} onChange={set("secondDepositDate")} />
          </label>
          <label>
            Inspection deadline
            <input type="date" value={fields.inspectionDate} onChange={set("inspectionDate")} />
          </label>
          <label>
            Financing commitment
            <input type="date" value={fields.financingDate} onChange={set("financingDate")} />
          </label>
          <label>
            Closing
            <input type="date" value={fields.closingDate} onChange={set("closingDate")} />
          </label>
        </div>
        {edited && (
          <p className="field-help">
            You've edited the text, so date changes above won't update it.{" "}
            <button type="button" className="license-mini-btn" onClick={() => setEdited(false)}>
              Rebuild from the template
            </button>
          </p>
        )}

        <div className="field-help next-steps-files">
          {!preview
            ? "Looking for the contract and disclosures in Dropbox…"
            : preview.error
              ? `Couldn't check Dropbox: ${preview.error}`
              : preview.files?.length
                ? `${preview.attach ? "Attached" : "Linked (too large to attach)"}: ${preview.files.join(", ")}`
                : "No fully executed contract or signed packet found in this deal's Dropbox folder yet — it'll send without attachments."}
          {preview?.cc?.length ? ` · CC: ${preview.cc.join(", ")}` : ""}
        </div>

        <div
          ref={bodyRef}
          className="next-steps-body"
          contentEditable
          suppressContentEditableWarning
          onInput={() => setEdited(true)}
          aria-label="Email text (you can edit it)"
        />

        <div className="next-steps-actions">
          <button type="button" className="comps-status-btn" onClick={() => onClose(false)} disabled={sending}>
            Not now
          </button>
          <button type="button" className="google-btn" onClick={send} disabled={sending || !preview}>
            {sending ? "Sending…" : "Send Next Steps email"}
          </button>
        </div>
      </div>
    </div>
  );
}
