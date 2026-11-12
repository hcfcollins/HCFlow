import { useState } from "react";
import { X, FolderOpen } from "lucide-react";
import { createActiveListing, pairDropboxFolder } from "../lib/transactions";
import DropboxFolderPicker from "./DropboxFolderPicker";
import AgentField from "./AgentField";
import RadioGroup from "./RadioGroup";
import EmailListInput from "./EmailListInput";
import { PROPERTY_STYLES } from "../lib/compFieldOptions";
import { SHOWING_ACCESS_OPTIONS } from "../lib/showingAccess";
import { focusNextOnEnter } from "../lib/formKeyNav";
import { useToast } from "../lib/ToastContext";

/** Deliberately short — for moving a pile of listings that already exist
 * outside the app into it quickly. Everything else can be filled in later from
 * the deal's detail screen. "Save & Add Another" keeps the agent/status/region
 * picks and clears the rest, since bulk entry is usually one agent at a time. */
export default function ActiveListingForm({ currentAgent, onCancel, onSubmitted }) {
  const defaultsToSelf = currentAgent.role !== "coordinator";
  const [agentId, setAgentId] = useState(defaultsToSelf ? currentAgent.id : null);
  const [stage, setStage] = useState("market");
  const [region, setRegion] = useState("VT");
  const [address, setAddress] = useState("");
  const [town, setTown] = useState("");
  const [price, setPrice] = useState("");
  const [propertyStyle, setPropertyStyle] = useState(PROPERTY_STYLES[0]);
  const [baComp, setBaComp] = useState("");
  const [sellerName, setSellerName] = useState("");
  const [sellerEmails, setSellerEmails] = useState([""]);
  const [lockboxCode, setLockboxCode] = useState("");
  const [showingAccess, setShowingAccess] = useState("");
  const [notes, setNotes] = useState("");
  // The existing Dropbox folder to pair once the listing's saved:
  // { folderId, name } or { link }.
  const [folder, setFolder] = useState(null);
  const [pickingFolder, setPickingFolder] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [addedCount, setAddedCount] = useState(0);
  const showToast = useToast();

  function resetForNext() {
    setAddress("");
    setTown("");
    setPrice("");
    setBaComp("");
    setSellerName("");
    setSellerEmails([""]);
    setLockboxCode("");
    setShowingAccess("");
    setNotes("");
    setFolder(null);
    setPickingFolder(false);
  }

  async function save(addAnother) {
    if (!address.trim()) {
      setError("Address is required.");
      return;
    }
    if (!agentId) {
      setError("Pick which agent this listing belongs to.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const tx = await createActiveListing({
        address: address.trim(),
        town: town.trim() || null,
        region,
        side: "Sell",
        stage,
        agent_id: agentId,
        price: price ? Number(String(price).replace(/[$,]/g, "")) : null,
        property_style: propertyStyle,
        ba_comp: baComp.trim() || null,
        seller_name: sellerName.trim() || null,
        seller_emails: sellerEmails.map((e) => e.trim()).filter(Boolean),
        has_lockbox: Boolean(lockboxCode.trim()),
        lockbox_code: lockboxCode.trim() || null,
        notes: notes.trim(),
        ...(showingAccess ? { showing_access: showingAccess } : {}),
      });
      setAddedCount((n) => n + 1);
      let folderNote = "";
      if (folder) {
        try {
          await pairDropboxFolder(tx.id, folder);
          folderNote = " + Dropbox folder paired";
        } catch (e) {
          // The listing itself saved fine — just say so and let them pair
          // from the deal screen.
          showToast(`Saved, but the Dropbox folder didn't pair: ${e.message}`);
        }
      }
      if (addAnother) {
        showToast(`Added ${tx.address}${folderNote}`);
        resetForNext();
        document.querySelector(".active-listing-address")?.focus();
      } else {
        onSubmitted(tx);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="uc-form"
      onSubmit={(e) => {
        e.preventDefault();
        save(true);
      }}
      onKeyDown={focusNextOnEnter}
    >
      <header className="app-header">
        <div>
          <div className="brand-eyebrow">Existing Listing{addedCount ? ` · ${addedCount} added` : ""}</div>
          <h1>Add Active Listing</h1>
        </div>
        <button type="button" className="header-icon-btn" onClick={() => (addedCount ? onSubmitted(null) : onCancel())} aria-label="Close" title="Close">
          <X size={20} />
        </button>
      </header>

      {error && <div className="error-banner">{error}</div>}

      <AgentField currentAgent={currentAgent} value={agentId} onChange={(id) => setAgentId(id)} />

      <fieldset>
        <legend>Status</legend>
        <RadioGroup
          name="alStage"
          value={stage}
          onChange={setStage}
          options={[
            { value: "market", label: "On Market" },
            { value: "won", label: "Private Listing" },
          ]}
        />
      </fieldset>

      <label>
        Address
        <input className="active-listing-address" value={address} onChange={(e) => setAddress(e.target.value)} required autoFocus />
      </label>
      <label>
        Town
        <input value={town} onChange={(e) => setTown(e.target.value)} />
      </label>
      <fieldset>
        <legend>State</legend>
        <RadioGroup name="alRegion" value={region} onChange={setRegion} options={["VT", "NH"]} />
      </fieldset>
      <label>
        List Price
        <input inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="e.g. 350000" />
      </label>
      <label>
        Property Style
        <select value={propertyStyle} onChange={(e) => setPropertyStyle(e.target.value)}>
          {PROPERTY_STYLES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <label>
        Buyer Agency Commission
        <input value={baComp} onChange={(e) => setBaComp(e.target.value)} placeholder="e.g. 2.5" />
      </label>
      <label>
        Seller Name(s)
        <input value={sellerName} onChange={(e) => setSellerName(e.target.value)} />
      </label>
      <label>
        Seller Email(s)
        <EmailListInput values={sellerEmails} onChange={setSellerEmails} />
      </label>
      <fieldset>
        <legend>Showings</legend>
        <RadioGroup name="alShowingAccess" value={showingAccess} onChange={setShowingAccess} options={SHOWING_ACCESS_OPTIONS} />
      </fieldset>
      <label>
        Lockbox Code
        <input value={lockboxCode} onChange={(e) => setLockboxCode(e.target.value)} placeholder="Leave blank if none" />
      </label>
      <fieldset>
        <legend>Existing Dropbox Folder (optional)</legend>
        {folder?.folderId ? (
          <div className="dbx-chosen">
            <FolderOpen size={14} /> <span>{folder.name}</span>
            <button type="button" onClick={() => setFolder(null)} title="Don't pair a folder">
              Remove
            </button>
          </div>
        ) : (
          <>
            <input
              value={folder?.link || ""}
              onChange={(e) => setFolder(e.target.value.trim() ? { link: e.target.value } : null)}
              placeholder="Paste the Dropbox folder link (or path)"
              title="Paste a link to this listing's existing Dropbox folder — it gets paired when you save"
            />
            {pickingFolder ? (
              <DropboxFolderPicker
                agentId={agentId}
                side="Sell"
                address={address}
                onPick={(choice) => {
                  setFolder(choice);
                  setPickingFolder(false);
                }}
                onCancel={() => setPickingFolder(false)}
              />
            ) : (
              <button type="button" className="dbx-change-link" onClick={() => setPickingFolder(true)} title="Pick from the agent's listing folders instead of pasting a link">
                or browse the agent's Dropbox folders
              </button>
            )}
          </>
        )}
      </fieldset>
      <label>
        Notes
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      </label>

      <div className="comp-edit-all-actions">
        <button title="Save this listing and start a blank form for the next one" type="submit" className="google-btn uc-submit" disabled={saving}>
          {saving ? "Saving…" : "Save & Add Another"}
        </button>
        <button title="Save this listing and go back" type="button" className="uc-submit" disabled={saving} onClick={() => save(false)}>
          {saving ? "Saving…" : "Save & Done"}
        </button>
      </div>
    </form>
  );
}
