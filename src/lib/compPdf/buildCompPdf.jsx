import { pdf } from "@react-pdf/renderer";
import { PDFDocument } from "pdf-lib";
import CmaDocument from "./CmaDocument";

const DEFAULT_COVER_PDF_URL = "/cma/HC-CMA-Cover-Page.pdf";
const LOGO_URL = "/cma/hall_collins_logo.png";

// Legacy static fallback for agents onboarded before Manage Agents existed, ported
// from the Streamlit CMA generator's app.py `_agent_cover_map` — only Rachel has one
// here. Anyone onboarded through Manage Agents gets a real agents.cover_sheet_url
// instead (checked first, below), so this map should never need another entry.
const AGENT_COVER_MAP = {
  "Rachel Noyes": "/cma/HC-Rachel-Noyes-Cover-Sheet.pdf",
};

function coverPdfUrlForAgent(agent) {
  return agent?.cover_sheet_url || AGENT_COVER_MAP[agent?.name] || DEFAULT_COVER_PDF_URL;
}

async function fetchBytes(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}`);
  return res.arrayBuffer();
}

/**
 * Builds the final comp PDF: HC cover page + generated CMA content + (optional)
 * supplemental PDF with its first 2 pages stripped + (optional) ANR map PDF appended
 * as-is — the exact order used by the Streamlit CMA generator's merge_cma_pdf.
 *
 * @param {object} transaction - the HC Flow transaction row
 * @param {object} form - { priceLow, priceHigh, priceRec, priceNotes, agentNotes, land?, multiFamily? }
 * @param {File|null} supplementalFile - existing comp PDF; first 2 pages get dropped
 * @param {File|null} anrFile - ANR map PDF; appended as-is
 * @returns {Promise<Uint8Array>}
 */
export async function buildCompPdf(transaction, form, supplementalFile, anrFile) {
  const contentBlob = await pdf(<CmaDocument transaction={transaction} form={form} logoDataUrl={LOGO_URL} />).toBlob();
  const contentBytes = await contentBlob.arrayBuffer();

  const coverPdfUrl = coverPdfUrlForAgent(transaction.agent);
  const [coverBytes, contentDoc] = await Promise.all([fetchBytes(coverPdfUrl), PDFDocument.load(contentBytes)]);

  const out = await PDFDocument.create();

  const coverDoc = await PDFDocument.load(coverBytes);
  const coverPages = await out.copyPages(coverDoc, coverDoc.getPageIndices());
  coverPages.forEach((p) => out.addPage(p));

  const contentPages = await out.copyPages(contentDoc, contentDoc.getPageIndices());
  contentPages.forEach((p) => out.addPage(p));

  if (supplementalFile) {
    const suppDoc = await PDFDocument.load(await supplementalFile.arrayBuffer());
    const indices = suppDoc.getPageIndices().slice(2); // drop the first 2 pages
    if (indices.length) {
      const suppPages = await out.copyPages(suppDoc, indices);
      suppPages.forEach((p) => out.addPage(p));
    }
  }

  if (anrFile) {
    const anrDoc = await PDFDocument.load(await anrFile.arrayBuffer());
    const anrPages = await out.copyPages(anrDoc, anrDoc.getPageIndices());
    anrPages.forEach((p) => out.addPage(p));
  }

  return out.save();
}

export function compPdfFileName(transaction) {
  const date = new Date().toISOString().slice(0, 10);
  const safeAddress = (transaction.address || "Comp").replace(/[/\\<>:"|?*]/g, "-").trim();
  return `${safeAddress} - CMA - ${date}.pdf`;
}
