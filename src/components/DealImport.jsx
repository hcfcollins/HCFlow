import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Upload, ListChecks } from "lucide-react";
import { parseDealTracker, importDeals, yearOf, IMPORT_SHEET_NAME } from "../lib/dealImport";
import { fetchAllAgents } from "../lib/transactions";
import { missingInfoItems } from "../lib/missingInfo";

// TEMPORARY catch-up screen (brokers only): bring this year's deals over from
// the old Google Sheet Deal Tracker, then step through every deal one at a time
// to fill in whatever the app still needs. Safe to delete once everything's in.

const STATUS_LABEL = { closed: "Closed", contract: "Under Contract", terminated: "Terminated" };
const SIDE_LABEL = { Buy: "Buyer", Sell: "Seller", Split: "Both sides" };
const money = (n) => (n == null ? "—" : `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
const shortDate = (iso) => (iso ? `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}` : "—");

/** This year's Under Contract + Closed deals that still have something
 * missing, oldest closing first — the line-by-line queue. */
export function reviewQueueFor(transactions, year) {
  return transactions
    .filter((t) => !t.terminated_at && (t.stage === "contract" || t.stage === "closed") && yearOf(t.next_date) === year)
    .filter((t) => missingInfoItems(t, { review: true }).length > 0)
    .sort((a, b) => String(normalize(a.next_date)).localeCompare(String(normalize(b.next_date))))
    .map((t) => t.id);
}
function normalize(d) {
  const y = yearOf(d);
  if (!y) return "9999";
  const us = /^(\d{1,2})\/(\d{1,2})\/\d{4}$/.exec(String(d).trim());
  return us ? `${y}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}` : String(d);
}

export default function DealImport({ transactions, onBack, onImported, onStartReview }) {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [agents, setAgents] = useState([]);
  const [fileRows, setFileRows] = useState(null);
  const [fileName, setFileName] = useState("");
  const [deals, setDeals] = useState(null);
  const [parseError, setParseError] = useState(null);
  const [progress, setProgress] = useState(null); // { done, total, address }
  const [result, setResult] = useState(null);

  useEffect(() => {
    fetchAllAgents().then(setAgents).catch((e) => setParseError(`Couldn't load the agent list: ${e.message}`));
  }, []);

  // Re-parse when the year changes (or once agents load).
  useEffect(() => {
    if (!fileRows || !agents.length) return;
    try {
      setDeals(parseDealTracker(fileRows, { year, agents, existing: transactions }));
      setParseError(null);
    } catch (e) {
      setDeals(null);
      setParseError(e.message);
    }
    // Only on file/year/agents — not every transactions refresh, which would
    // wipe out checkbox changes mid-way.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileRows, year, agents]);

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setResult(null);
    setParseError(null);
    setFileName(file.name);
    try {
      const { default: readXlsxFile, readSheetNames } = await import("read-excel-file");
      const names = await readSheetNames(file);
      const sheet = names.find((n) => n.trim().toLowerCase() === IMPORT_SHEET_NAME.toLowerCase()) || names[0];
      setFileRows(await readXlsxFile(file, { sheet }));
    } catch (err) {
      setFileRows(null);
      setDeals(null);
      setParseError(`Couldn't read that file: ${err.message}. It should be the Deal Tracker downloaded as Excel (.xlsx).`);
    }
  }

  const selected = deals?.filter((d) => d.selected) || [];
  const counts = useMemo(() => {
    if (!deals) return null;
    return {
      total: deals.length,
      inApp: deals.filter((d) => d.existingId).length,
      terminated: deals.filter((d) => d.status === "terminated").length,
    };
  }, [deals]);

  const toggle = (i) => setDeals((ds) => ds.map((d, j) => (j === i ? { ...d, selected: !d.selected } : d)));
  const setAll = (fn) => setDeals((ds) => ds.map((d) => ({ ...d, selected: fn(d) })));
  const canImport = (d) => !d.existingId && d.agentId && d.side;

  async function handleImport() {
    const toImport = selected.filter(canImport);
    if (!toImport.length) return;
    setProgress({ done: 0, total: toImport.length, address: toImport[0].address });
    try {
      const r = await importDeals(toImport, (done, total, address) => setProgress({ done, total, address }));
      setResult(r);
      await onImported();
      // Imported ones now show "In app" and are unchecked.
      setDeals((ds) => ds.map((d) => (toImport.includes(d) && !r.failed.some((f) => f.address === d.address) ? { ...d, existingId: "new", existingStage: d.status === "closed" ? "closed" : "contract", selected: false } : d)));
    } catch (e) {
      setResult({ created: [], failed: [{ address: "Import", error: e.message }] });
    } finally {
      setProgress(null);
    }
  }

  const queue = reviewQueueFor(transactions, year);

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <div className="brand-eyebrow">Temporary · Catch-up</div>
          <h1>Import Deals</h1>
        </div>
        <button type="button" className="header-icon-btn" onClick={onBack} aria-label="Back" title="Back">
          <ArrowLeft size={20} />
        </button>
      </header>

      <div className="import-screen">
        <section className="import-card">
          <h2 className="import-step-title">
            <span className="import-step-num">1</span> Bring in this year's deals
          </h2>
          <p className="field-help">
            In Google Sheets, open the Deal Tracker and choose <strong>File → Download → Microsoft Excel (.xlsx)</strong>, then pick that
            file here. Only rows with a closing date in the year below come in. Deals that are already in the app are skipped. Each side of a
            Split deal stays its own deal with its own close-out (agent, commission and referral), just like the sheet, and the two sides are
            linked to each other.
          </p>
          <div className="import-controls">
            <label className="import-file-btn" title="Choose the Deal Tracker .xlsx file">
              <Upload size={16} /> {fileName ? "Choose a different file" : "Choose Deal Tracker file"}
              <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={handleFile} hidden />
            </label>
            <label className="import-year">
              Year{" "}
              <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
                {[thisYear, thisYear - 1].map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {fileName && <div className="import-file-name">{fileName}</div>}
          {parseError && <div className="error-banner">{parseError}</div>}

          {deals && counts && (
            <>
              <div className="import-summary">
                <strong>{counts.total}</strong> deals in {year} · <strong>{selected.length}</strong> selected · {counts.inApp} already in the app ·{" "}
                {counts.terminated} terminated (unchecked; check any you want on record)
              </div>
              <div className="import-select-links">
                <button type="button" className="import-link-btn" onClick={() => setAll((d) => canImport(d) && d.status !== "terminated")} title="Select every new deal that isn't terminated">
                  Select all new
                </button>
                <button type="button" className="import-link-btn" onClick={() => setAll((d) => canImport(d))} title="Also select the terminated ones">
                  + terminated
                </button>
                <button type="button" className="import-link-btn" onClick={() => setAll(() => false)} title="Uncheck everything">
                  Select none
                </button>
              </div>
              <div className="import-table-wrap">
                <table className="import-table">
                  <thead>
                    <tr>
                      <th />
                      <th>Closing</th>
                      <th>Address</th>
                      <th>Agent</th>
                      <th>Side</th>
                      <th>Price</th>
                      <th>Comm.</th>
                      <th>Comes in as</th>
                      <th>Heads up</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deals.map((d, i) => (
                      <tr key={d.rowNums.join("-")} className={d.existingId ? "import-row--in-app" : d.selected ? "import-row--selected" : ""}>
                        <td>
                          <input
                            type="checkbox"
                            checked={d.selected}
                            disabled={!canImport(d) || Boolean(progress)}
                            onChange={() => toggle(i)}
                            aria-label={`Import ${d.address}`}
                          />
                        </td>
                        <td>{shortDate(d.closingDate)}</td>
                        <td className="import-address">{d.address}</td>
                        <td>{d.agentName || "—"}</td>
                        <td>{SIDE_LABEL[d.side] || "?"}</td>
                        <td>{money(d.price)}</td>
                        <td>{d.commissionPct != null ? `${d.commissionPct}%` : "—"}</td>
                        <td>
                          <span className={`import-status import-status--${d.status}`}>{STATUS_LABEL[d.status]}</span>
                        </td>
                        <td className="import-warnings">
                          {d.existingId ? <span className="import-in-app">✓ In the app{d.existingStage ? ` (${STATUS_LABEL[d.existingStage] || d.existingStage})` : ""}</span> : null}
                          {d.warnings.map((w) => (
                            <div key={w}>{w}</div>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {progress ? (
                <div className="import-progress">
                  <div className="import-progress-bar">
                    <div style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} />
                  </div>
                  Importing {Math.min(progress.done + 1, progress.total)} of {progress.total}
                  {progress.address ? ` — ${progress.address}` : "…"}
                </div>
              ) : (
                <button type="button" className="google-btn import-go-btn" disabled={!selected.length} onClick={handleImport} title="Add the checked deals to the app">
                  Import {selected.length} deal{selected.length === 1 ? "" : "s"}
                </button>
              )}
            </>
          )}

          {result && (
            <div className={`import-result ${result.failed.length ? "import-result--warn" : ""}`}>
              ✓ {result.created.length} deal{result.created.length === 1 ? "" : "s"} imported. Zip codes and towns are being looked up in the
              background.
              {result.failed.length > 0 && (
                <ul>
                  {result.failed.map((f) => (
                    <li key={f.address}>
                      <strong>{f.address}</strong>: {f.error}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>

        <section className="import-card">
          <h2 className="import-step-title">
            <span className="import-step-num">2</span> Fill in what's missing, line by line
          </h2>
          <p className="field-help">
            Goes through every {year} Under Contract and Closed deal that's still missing something, one at a time, oldest closing first.
            Each one opens on its deal screen with the missing items listed at the top. Tap one to jump to that field, fill it in, then hit{" "}
            <strong>Next</strong>. You can stop any time and pick up later.
          </p>
          <button
            type="button"
            className="google-btn import-go-btn"
            disabled={!queue.length || Boolean(progress)}
            onClick={() => onStartReview(queue)}
            title="Open the first deal that's missing info"
          >
            <ListChecks size={16} /> {queue.length ? `Start — ${queue.length} deal${queue.length === 1 ? "" : "s"} need info` : `All ${year} deals are complete ✓`}
          </button>
        </section>
      </div>
    </div>
  );
}
