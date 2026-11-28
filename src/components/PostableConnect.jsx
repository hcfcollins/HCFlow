// Manage Agents → Brokerage: connect the Postable account once. The app logs in
// and keeps Postable's token (not the password) to add closed buyers.
import { useEffect, useState } from "react";
import { Mailbox } from "lucide-react";
import { postableStatus, connectPostable } from "../lib/postable";

export default function PostableConnect() {
  const [status, setStatus] = useState(null);
  const [editing, setEditing] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = () => postableStatus().then(setStatus).catch((e) => setStatus({ connected: false, error: e.message }));
  useEffect(() => {
    load();
  }, []);

  async function connect(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await connectPostable(email.trim(), password);
      setPassword("");
      setEditing(false);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="detail-section postable-connect">
      <h2 className="comps-section-title">
        <Mailbox size={18} style={{ verticalAlign: -3 }} /> Postable
      </h2>
      <p className="field-help">
        When a close-out is saved, our buyer clients are added to Postable with their new address, in a “Closed {new Date().getFullYear()}” group.
      </p>
      {!status ? (
        <p className="field-help">Checking…</p>
      ) : status.connected && !editing ? (
        <p>
          ✓ Connected{status.account ? ` as ${status.account}` : ""}.{" "}
          <button type="button" className="license-mini-btn" onClick={() => setEditing(true)}>
            Reconnect
          </button>
        </p>
      ) : (
        <form className="postable-form" onSubmit={connect}>
          {status.error && !error && <div className="field-help" style={{ color: "var(--color-danger-text)" }}>{status.error}</div>}
          <label>
            Postable email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" required />
          </label>
          <label>
            Postable password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required />
          </label>
          <p className="field-help">Used once to sign in — only Postable's access key is kept, not the password.</p>
          {error && <div className="error-banner">{error}</div>}
          <div className="polish-actions">
            <button type="submit" className="google-btn" disabled={busy}>
              {busy ? "Connecting…" : "Connect Postable"}
            </button>
            {status.connected && (
              <button type="button" className="comps-status-btn" onClick={() => setEditing(false)}>
                Cancel
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
