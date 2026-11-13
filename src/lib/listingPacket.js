// Listing packet: a branded cover sheet + every file in the listing's
// "3) Showing Docs" folder, combined into one PDF and saved back to Showing
// Docs as "<address> - Packet.pdf" (the file the "Packet ➤" button emails).
//
// The cover is built ON TOP of Fran's blank Canva templates (public/
// cover-templates), so the rules, footer, icons and logos stay vector-sharp:
//   standard.pdf      Holly and/or Fran only — their names/phones are printed on it
//   two-agents.pdf    listing agent (left) + co-list agent (right)
//   single-agent.pdf  any other agent on their own (Hall Collins logo on the right)
// Drawn over it: the listing photo filling the white top area, the white
// Hall Collins logo over the photo (same spot as the template's), the street
// address big in the pink band with "CITY, ST" smaller below, and — on the
// two-agent / single-agent templates — each agent's name, phone (bold, next
// to the phone icon) and email.
// Measurements are in PDF points (612 × 792, letter), read from the templates.

import { PDFDocument, rgb, setCharacterSpacing } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { supabase } from "./supabaseClient";
import { fetchListingFile } from "./transactions";

const PAGE_W = 612;
const PAGE_H = 792;
const PHOTO_BOTTOM = 512; // top of the navy rule above the pink band
const BAND_CENTER = 568; // the pink band runs 516–622
const LOGO = { x: 117.9, y: 30.9, w: 360.5, h: 104.2 }; // white logo, from the template
const NAVY = rgb(0x17 / 255, 0x33 / 255, 0x48 / 255);
const WHITE = rgb(1, 1, 1);
// Agent columns: [left, right]. Phone text starts just right of the pink icon.
const COLUMNS = [
  { x: 39, phoneX: 66, maxW: 212 },
  { x: 365, phoneX: 392, maxW: 210 },
];
const NAME_BASELINE = 662;
const PHONE_BASELINE = 691;
const EMAIL_BASELINE = 714;

const OWNER_EMAILS = ["holly.hall@hallcollins.com", "fran.collins@hallcollins.com"];
const isOwner = (a) => Boolean(a) && OWNER_EMAILS.includes(String(a.email || "").toLowerCase());

/** Which cover to use, and for whom. */
export function coverPlan(tx, agents) {
  const primary = agents.find((a) => a.id === tx.agent_id) || null;
  const colist = tx.colist_agent_id ? agents.find((a) => a.id === tx.colist_agent_id) || null : null;
  if (isOwner(primary) && (!colist || isOwner(colist))) {
    return { template: "standard", label: "Standard Holly & Fran", agents: [] };
  }
  if (colist) return { template: "two-agents", label: "Two agents", agents: [primary, colist].filter(Boolean) };
  return { template: "single-agent", label: "Single agent", agents: [primary].filter(Boolean) };
}

/** "8024313421" → "(802)-431-3421" (the templates' style); anything else as typed. */
export function formatPhone(phone) {
  const d = String(phone || "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? `(${d.slice(0, 3)})-${d.slice(3, 6)}-${d.slice(6)}` : String(phone || "").trim();
}

/** Street on its own + "CITY, ST" (the stored address sometimes already has the town). */
export function splitAddress(tx) {
  let street = String(tx.address || "").trim();
  const town = String(tx.town || "").trim();
  if (town) {
    const i = street.toLowerCase().lastIndexOf(town.toLowerCase());
    if (i > 0) street = street.slice(0, i);
  }
  street = street.replace(/[\s,]+(VT|NH|Vermont|New Hampshire)\b[\s,]*(\d{5})?\s*$/i, "").replace(/[\s,]+$/, "").trim();
  const city = [town, tx.region].filter(Boolean).join(", ");
  return { street, city };
}

export function packetFileName(tx) {
  const { street } = splitAddress(tx);
  return `${(street || tx.address).replace(/[\\/:*?"<>|]/g, "")} - Packet.pdf`;
}

async function fetchBytes(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't load ${url}`);
  return new Uint8Array(await res.arrayBuffer());
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Couldn't read that photo (try a JPG or PNG)"));
    img.src = src;
  });
}

/** Cover-crops the photo to the template's photo area as a sharp JPEG. */
async function photoForCover(photoBlob) {
  const url = URL.createObjectURL(photoBlob);
  try {
    const img = await loadImage(url);
    const scale = 3; // 3 px per point → ~216 dpi, plenty for print
    const tw = PAGE_W * scale;
    const th = PHOTO_BOTTOM * scale;
    const target = tw / th;
    const source = img.width / img.height;
    let sx = 0;
    let sy = 0;
    let sw = img.width;
    let sh = img.height;
    if (source > target) {
      sw = img.height * target;
      sx = (img.width - sw) / 2;
    } else {
      sh = img.width / target;
      sy = (img.height - sh) / 2;
    }
    const canvas = document.createElement("canvas");
    canvas.width = tw;
    canvas.height = th;
    canvas.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, tw, th);
    const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.9));
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Width of text drawn with extra space after each letter. */
const spacedWidth = (font, text, size, spacing) => font.widthOfTextAtSize(text, size) + spacing * Math.max(0, text.length - 1);

/** Draws text (top-down y = baseline) with letter spacing, shrinking to fit maxW. */
function drawSpaced(page, text, { font, size, spacing, x, baseline, color, maxW, center = false, minSize = 8 }) {
  let s = size;
  let sp = spacing;
  while (maxW && spacedWidth(font, text, s, sp) > maxW && s > minSize) {
    s -= 0.5;
    sp = Math.max(0, sp * 0.95);
  }
  const w = spacedWidth(font, text, s, sp);
  const left = center ? PAGE_W / 2 - w / 2 : x;
  page.pushOperators(setCharacterSpacing(sp));
  page.drawText(text, { x: left, y: PAGE_H - baseline, size: s, font, color });
  page.pushOperators(setCharacterSpacing(0));
}

/** One cover page added to `doc`. */
async function addCoverPage(doc, { plan, photoBlob, tx }) {
  doc.registerFontkit(fontkit);
  const [templateBytes, logoBytes, serif, serifBold, sans, sansBold, photoBytes] = await Promise.all([
    fetchBytes(`/cover-templates/${plan.template}.pdf`),
    fetchBytes("/hall-collins-logo-white.png"),
    fetchBytes("/fonts/playfair-display-400.ttf"),
    fetchBytes("/fonts/playfair-display-700.ttf"),
    fetchBytes("/fonts/montserrat-400.ttf"),
    fetchBytes("/fonts/montserrat-700.ttf"),
    photoForCover(photoBlob),
  ]);
  const [template] = await doc.embedPdf(templateBytes, [0]);
  const fonts = {
    serif: await doc.embedFont(serif, { subset: true }),
    serifBold: await doc.embedFont(serifBold, { subset: true }),
    sans: await doc.embedFont(sans, { subset: true }),
    sansBold: await doc.embedFont(sansBold, { subset: true }),
  };
  const photo = await doc.embedJpg(photoBytes);
  const logo = await doc.embedPng(logoBytes);

  const page = doc.addPage([PAGE_W, PAGE_H]);
  page.drawPage(template, { x: 0, y: 0, width: PAGE_W, height: PAGE_H });
  page.drawImage(photo, { x: 0, y: PAGE_H - PHOTO_BOTTOM, width: PAGE_W, height: PHOTO_BOTTOM });
  page.drawImage(logo, { x: LOGO.x, y: PAGE_H - LOGO.y - LOGO.h, width: LOGO.w, height: LOGO.h });

  // Address in the pink band: street big, "CITY, ST" smaller below.
  const { street, city } = splitAddress(tx);
  drawSpaced(page, street.toUpperCase(), { font: fonts.serif, size: 38, spacing: 1.5, baseline: BAND_CENTER + (city ? 3 : 14), color: WHITE, maxW: 560, center: true, minSize: 22 });
  if (city) drawSpaced(page, city.toUpperCase(), { font: fonts.serif, size: 27, spacing: 1.5, baseline: BAND_CENTER + 38, color: WHITE, maxW: 540, center: true, minSize: 16 });

  // Agents (the standard template already has Holly & Fran printed).
  plan.agents.forEach((agent, i) => {
    const col = COLUMNS[i];
    if (!agent || !col) return;
    drawSpaced(page, agent.name.toUpperCase(), { font: fonts.serifBold, size: 20, spacing: 4.6, x: col.x, baseline: NAME_BASELINE, color: NAVY, maxW: col.maxW, minSize: 12 });
    if (agent.phone) {
      drawSpaced(page, formatPhone(agent.phone), { font: fonts.sansBold, size: 16.5, spacing: 2, x: col.phoneX, baseline: PHONE_BASELINE, color: NAVY, maxW: col.maxW - (col.phoneX - col.x), minSize: 10 });
    }
    if (agent.email) {
      drawSpaced(page, agent.email.toLowerCase(), { font: fonts.sans, size: 12.5, spacing: 1.1, x: col.x, baseline: EMAIL_BASELINE, color: NAVY, maxW: col.maxW, minSize: 7.5 });
    }
  });
}

/** Just the cover sheet, as PDF bytes (for a preview). */
export async function buildCoverSheet({ tx, plan, photoBlob }) {
  const doc = await PDFDocument.create();
  await addCoverPage(doc, { plan, photoBlob, tx });
  return doc.save();
}

/** Showing Docs files for the packet, each marked include/skip. */
export async function listShowingDocs(transactionId) {
  const { data, error } = await supabase.functions.invoke("social-post-assets", { body: { action: "listShowingDocs", transactionId } });
  if (error) throw error;
  return (data?.files || []).map((f) => {
    const lower = f.name.toLowerCase();
    let skip = null;
    if (/packet/.test(lower)) skip = "an earlier packet";
    else if (!/\.(pdf|jpe?g|png)$/.test(lower)) skip = "not a PDF or image";
    return { ...f, skip };
  });
}

/** Cover + every included Showing Docs file → one PDF. onProgress(text). */
export async function buildPacket({ tx, plan, photoBlob, files, onProgress }) {
  const doc = await PDFDocument.create();
  onProgress?.("Making the cover sheet…");
  await addCoverPage(doc, { plan, photoBlob, tx });

  const problems = [];
  const included = files.filter((f) => !f.skip);
  for (let i = 0; i < included.length; i++) {
    const f = included[i];
    onProgress?.(`Adding ${i + 1} of ${included.length}: ${f.name}`);
    try {
      const blob = await fetchListingFile(tx.id, f.path);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (/\.pdf$/i.test(f.name)) {
        const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const pages = await doc.copyPages(src, src.getPageIndices());
        pages.forEach((p) => doc.addPage(p));
      } else {
        // A photo/scan: its own letter page, fit inside half-inch margins.
        const img = /\.png$/i.test(f.name) ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
        const page = doc.addPage([PAGE_W, PAGE_H]);
        const fit = img.scaleToFit(PAGE_W - 72, PAGE_H - 72);
        page.drawImage(img, { x: (PAGE_W - fit.width) / 2, y: (PAGE_H - fit.height) / 2, width: fit.width, height: fit.height });
      }
    } catch (e) {
      problems.push({ name: f.name, error: e.message || String(e) });
    }
  }
  onProgress?.("Finishing the PDF…");
  return { bytes: await doc.save(), problems };
}

/** Saves the packet into Showing Docs (replacing an older copy). The browser
 * uploads straight to Dropbox through a one-time link. Returns the Dropbox path. */
export async function savePacketToDropbox(tx, bytes) {
  const fileName = packetFileName(tx);
  const { data, error } = await supabase.functions.invoke("social-post-assets", { body: { action: "packetUploadLink", transactionId: tx.id, fileName } });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  const res = await fetch(data.link, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: bytes });
  if (!res.ok) throw new Error(`Dropbox upload failed (${res.status})`);
  return data.path;
}
