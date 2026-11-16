// Folder organizer (Close-Out Calculator): proposes consistent names for every
// file in a deal's Dropbox folder (except Photos), numbered in the order they
// happened — "1) 3673 Fish Hill Rd - Preapproval", "2) 3673 Fish Hill Rd -
// Signed Disclosure Packet", … — with Closing Docs and the Commission Check
// always last. Numbering restarts in each subfolder. Nothing is renamed until
// Fran reviews the list (she can reorder, edit names, or leave files out).

const SUFFIXES = ["rd", "road", "st", "street", "ave", "avenue", "ln", "lane", "dr", "drive", "hwy", "highway", "rte", "route", "rt", "blvd", "boulevard", "cir", "circle", "ct", "court", "way", "pl", "place", "ter", "hill", "brook", "ext", "unit"];
const STATES = ["vt", "nh", "vermont", "hampshire", "new"];

const norm = (t) => String(t).toLowerCase().replace(/[^a-z0-9]/g, "");

/** "3673 Fish Hill Road Randolph, VT" (+ town) → "3673 Fish Hill Road" */
export function streetOf(tx) {
  let street = String(tx.address || "").trim();
  const town = String(tx.town || "").trim();
  if (town) {
    const i = street.toLowerCase().lastIndexOf(town.toLowerCase());
    if (i > 0) street = street.slice(0, i);
  }
  return street
    .replace(/[\s,]+(VT|NH|Vermont|New Hampshire)\b[\s,]*(\d{5})?\s*$/i, "")
    .replace(/[\s,.-]+$/, "")
    .trim();
}

/** Kind of document, for ordering: closing docs and the commission check go last. */
export function docKind(name) {
  const n = name.toLowerCase();
  if (/commission/.test(n) && !/agreement|disclosure|disbursement auth|\bcda\b/.test(n)) return "commission";
  if (/closing doc|\bhud\b|settlement statement|closing disclosure|alta|signed closing/.test(n)) return "closing";
  return "doc";
}

/** Old file name → just the description ("5) 3673 Fish Hill Rd.- Deposit 1 or 2"
 * → "Deposit 1 or 2"): drops the old number and any spelling of the address. */
export function describe(fileName, tx) {
  let base = fileName.replace(/\.[a-z0-9]{2,5}$/i, "");
  base = base.replace(/^\s*\d+\s*[a-z]?\s*[.)]+\s*[-–.]?\s*/i, "");

  const street = streetOf(tx);
  const houseNo = (street.match(/^\s*(\d+[a-z]?)\b/i) || [])[1];
  const streetWords = street.split(/\s+/).map(norm).filter(Boolean);
  const townWords = String(tx.town || "").split(/\s+/).map(norm).filter(Boolean);
  const allowed = new Set([...streetWords, ...townWords, ...SUFFIXES, ...STATES]);
  // Misspellings ("Cemetary" for "Cemetery", "HIll") still count as the address.
  const looksLikeAddressWord = (w) => {
    const t = norm(w);
    if (!t) return true;
    if (allowed.has(t)) return true;
    return [...streetWords, ...townWords].some((s) => s.length >= 4 && t.length >= 4 && s.slice(0, 4) === t.slice(0, 4));
  };

  if (houseNo) {
    const tokens = base.split(/(\s+)/); // keep spaces
    const words = tokens.filter((t) => t.trim());
    const startIdx = words.findIndex((w) => norm(w) === norm(houseNo));
    if (startIdx >= 0) {
      let end = startIdx + 1;
      while (end < words.length && end - startIdx <= 7 && looksLikeAddressWord(words[end].replace(/[-–—]+$/, ""))) end++;
      // If a word ended with a dash ("Rd.-"), the address stops there.
      const removed = words.slice(startIdx, end);
      const rebuilt = [...words.slice(0, startIdx), ...words.slice(end)].join(" ");
      if (removed.length) base = rebuilt;
    }
  }

  base = base
    .replace(/\s*[-–—]\s*[-–—]\s*/g, " - ")
    .replace(/^[\s\-–—_.,:;]+|[\s\-–—_.,:;]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\(\d\)$/, "")
    .trim();
  if (!base) base = "Document";
  if (docKind(fileName) === "commission" && /^commission( pdf| check)?$/i.test(base)) base = "Commission Check";
  return base.charAt(0).toUpperCase() + base.slice(1);
}

const SKIP = [
  // The listing packet ("1) 15C Harlow Hill - Packet.pdf") — not a "Signed Packet".
  { test: /\s-\s*packet\.[a-z0-9]+$/i, why: "listing packet (keeps its name)" },
  { test: /^instagram\b/i, why: "Instagram graphic" },
];

/** A file left mid-rename ("__renaming__ 3) 12 Main St - Deed.pdf") → its intended name. */
const unstrand = (name) => name.replace(/^__renaming__\s*/, "");

/** Dropbox files → [{ folder, items: [{ path, oldName, newName, include, kind, added, skip }] }] */
export function planRenames(files, tx) {
  const street = streetOf(tx).replace(/[\\/:*?"<>|]/g, "");
  const byFolder = new Map();
  for (const f of files) {
    if (!byFolder.has(f.folder)) byFolder.set(f.folder, []);
    byFolder.get(f.folder).push(f);
  }
  const order = { doc: 0, closing: 1, commission: 2 };
  const groups = [...byFolder.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([folder, list]) => {
      const items = list
        .map((f) => {
          const name = unstrand(f.name);
          const skip = SKIP.find((s) => s.test.test(name))?.why || null;
          // A file left mid-rename always gets renamed (back to its intended name).
          const stranded = name !== f.name;
          return { path: f.path, oldName: f.name, added: f.added, kind: docKind(name), skip: stranded ? null : skip, include: stranded || !skip, desc: describe(name, tx) };
        })
        .sort((a, b) => order[a.kind] - order[b.kind] || String(a.added).localeCompare(String(b.added)) || a.oldName.localeCompare(b.oldName));
      return { folder, items: renumber(items, street) };
    });
  return groups;
}

/** (Re)numbers the included items in their current order. */
export function renumber(items, street) {
  let n = 0;
  return items.map((it) => {
    if (!it.include) return { ...it, newName: it.oldName };
    n += 1;
    const ext = (it.oldName.match(/\.([a-z0-9]{2,5})$/i) || [])[1];
    return { ...it, newName: `${n}) ${street} - ${it.desc}${ext ? `.${ext.toLowerCase()}` : ""}` };
  });
}

// ── Dropping new files onto a deal (deal screen) ──
// Which of the deal's own subfolders a file belongs in, by its name. Listing
// folders: 1) Pitch Docs, 2) Listing Agreement, 3) Showing Docs, 4) Photos,
// 5) Under Contract (older ones: 5) Contract Docs). Buyer folders often have
// no subfolders — then everything goes in the deal folder itself.
const FOLDER_RULES = [
  { match: /photo/i, test: /\.(jpe?g|png|heic|webp|gif)$/i },
  { match: /pitch/i, test: /\b(cma|comps?|market analysis|pitch)\b/i },
  { match: /listing agreement/i, test: /listing (agreement|contract)|exclusive right|amendment to listing|\bcid\b|listing doc/i },
  { match: /closing/i, test: /closing doc|\bhud\b|settlement statement|closing disclosure|\balta\b|commission/i },
  { match: /financ/i, test: /pre-?approval|pre-?qual|commitment|appraisal|lender|financ|proof of funds/i },
  { match: /inspection/i, test: /inspection|radon|water test|pest|home inspect/i },
  { match: /under contract|contract docs|purchase & sale|purchase and sale/i, test: /contract|p\s*&\s*s|purchase|addend|deposit|waiver|extension|extend|amend|walkthrough|closing|hud|commission|inspection|appraisal|financ|commitment|pre-?approval/i },
  { match: /showing/i, test: /\bmls\b|disclosure|\bspir\b|property information|deed|tax bill|list card|survey|septic|\bwell\b|\blbp\b|lead|\banr\b|fema|flood|permit|vendor|plat/i },
];

/** Best guess of the subfolder (exact name from `folders`) for a dropped file,
 * or "" for the deal folder itself. */
export function suggestFolder(fileName, folders) {
  for (const rule of FOLDER_RULES) {
    if (!rule.test.test(fileName)) continue;
    const f = folders.find((name) => rule.match.test(name));
    if (f) return f;
  }
  return "";
}

export const isPhoto = (name) => /\.(jpe?g|png|heic|webp|gif)$/i.test(name);

/** Highest "N)" already used in a folder's file names (0 if none). */
export function highestNumber(names) {
  return names.reduce((max, n) => {
    const m = /^\s*(\d+)\s*[a-z]?\s*[.)]/i.exec(n);
    return m ? Math.max(max, Number(m[1])) : max;
  }, 0);
}
