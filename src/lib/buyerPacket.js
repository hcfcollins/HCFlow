// Buyer packets: drop PDFs, photos and .zip files → one merged PDF named
// "<street> - Buyer Packet.pdf" for the agent to send their buyer. Everything
// happens in the browser; nothing is uploaded. A small record of each packet
// (address, pages, when) is kept so agents can see what they've made.
import { unzipSync } from "fflate";
import { PDFDocument } from "pdf-lib";
import { supabase } from "./supabaseClient";

const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
const extOf = (name) => (/\.([a-z0-9]+)$/i.exec(name)?.[1] || "").toLowerCase();
const isJunk = (path) => /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db)(\/|$)|(^|\/)\._/i.test(path);
const IMAGE = ["jpg", "jpeg", "png", "webp", "gif", "bmp", "heic", "heif", "tif", "tiff"];

/** What can go in a packet. */
export function kindOf(name) {
  const ext = extOf(name);
  if (ext === "pdf") return "pdf";
  if (ext === "zip") return "zip";
  if (IMAGE.includes(ext)) return "image";
  return "other";
}

/** Files (and the insides of any zips, nested too) → [{ id, name, bytes, kind }], zip contents in name order. */
export async function expandFiles(fileList) {
  const out = [];
  const add = (name, bytes) => {
    const kind = kindOf(name);
    if (kind === "zip") {
      let entries;
      try {
        entries = unzipSync(bytes);
      } catch {
        out.push({ id: crypto.randomUUID(), name, bytes: null, kind: "bad", note: "couldn't open this zip" });
        return;
      }
      Object.keys(entries)
        .filter((p) => !p.endsWith("/") && !isJunk(p) && entries[p].length)
        .sort(natural)
        .forEach((p) => add(p.split("/").pop(), entries[p]));
      return;
    }
    out.push({ id: crypto.randomUUID(), name, bytes, kind });
  };
  for (const f of fileList) add(f.name, new Uint8Array(await f.arrayBuffer()));
  return out;
}

const LETTER = [612, 792];
const MARGIN = 24;

/** Any image the browser can draw → JPEG bytes (for webp/gif/heic…). */
async function toJpeg(bytes, name) {
  const bitmap = await createImageBitmap(new Blob([bytes]));
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0);
  const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.9));
  if (!blob) throw new Error(`couldn't read ${name}`);
  return new Uint8Array(await blob.arrayBuffer());
}

/** Merge in order → { bytes, pageCount, skipped: [{name, why}] }. */
export async function mergePacket(items) {
  const out = await PDFDocument.create();
  const skipped = [];
  for (const it of items) {
    try {
      if (it.kind === "pdf") {
        const doc = await PDFDocument.load(it.bytes, { ignoreEncryption: true });
        const pages = await out.copyPages(doc, doc.getPageIndices());
        pages.forEach((p) => out.addPage(p));
      } else if (it.kind === "image") {
        const ext = extOf(it.name);
        const img = ext === "png" ? await out.embedPng(it.bytes) : ext === "jpg" || ext === "jpeg" ? await out.embedJpg(it.bytes) : await out.embedJpg(await toJpeg(it.bytes, it.name));
        // Landscape photos get a landscape page; fit inside the margins.
        const [w, h] = img.width > img.height ? [LETTER[1], LETTER[0]] : LETTER;
        const scale = Math.min((w - MARGIN * 2) / img.width, (h - MARGIN * 2) / img.height, 1);
        const page = out.addPage([w, h]);
        page.drawImage(img, { x: (w - img.width * scale) / 2, y: (h - img.height * scale) / 2, width: img.width * scale, height: img.height * scale });
      } else {
        skipped.push({ name: it.name, why: it.note || "not a PDF or photo" });
      }
    } catch (e) {
      skipped.push({ name: it.name, why: /encrypt|password/i.test(e.message) ? "password-protected" : "couldn't read it" });
    }
  }
  if (!out.getPageCount()) throw new Error("Nothing in there could be added — packets take PDFs, photos, and zips of them.");
  return { bytes: await out.save(), pageCount: out.getPageCount(), skipped };
}

export function packetFileName(address) {
  const street = String(address || "").split(",")[0].replace(/[\\/:*?"<>|]/g, "").trim() || "Property";
  return `${street} - Buyer Packet.pdf`;
}

export function downloadPdf(bytes, fileName) {
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/** History: a record of the packet (not the file). Best-effort. */
export async function recordPacket(agentId, { address, fileName, fileCount, pageCount }) {
  const { error } = await supabase.from("buyer_packets").insert({ agent_id: agentId, address, file_name: fileName, file_count: fileCount, page_count: pageCount });
  if (error) console.error("Buyer packet history not saved:", error.message);
}

export async function fetchPacketHistory() {
  const { data, error } = await supabase.from("buyer_packets").select("*, agent:agents(name)").order("created_at", { ascending: false }).limit(500);
  if (error) return { rows: [], missing: /buyer_packets|schema cache|does not exist/i.test(error.message) };
  return { rows: data || [], missing: false };
}
