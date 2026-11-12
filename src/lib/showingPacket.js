import { emailShowingPacket } from "./transactions";
import { gmailComposeUrl, mailtoUrl, isMobileDevice } from "./clientEmail";

/** The showing-packet email, worded exactly as Fran wants it. */
export function showingPacketEmail(address, url) {
  return {
    to: [],
    subject: `Listing Packet - ${address}`,
    body: `Hello,\n\nHere is the listing packet for ${address}:\n${url}\n\nLet me know if you have any questions!`,
  };
}

/** Gets a view-only Dropbox link to the listing's "- Packet" file and opens a
 * pre-filled email from YOUR OWN account (phone mail app on mobile, a Gmail
 * tab on a computer); you add the recipient. Must be called straight from a
 * click — the desktop tab is opened before the network call so it isn't
 * popup-blocked. Returns the packet's file name; throws with a readable
 * message otherwise. */
export async function sendShowingPacket(tx) {
  const mobile = isMobileDevice();
  // Not "noopener" — that makes window.open() return null, so the tab could
  // never be pointed at Gmail (the old blank page).
  const composeTab = mobile ? null : window.open("", "_blank");
  if (composeTab) {
    try {
      composeTab.opener = null;
      composeTab.document.title = "Getting the showing packet…";
      composeTab.document.body.innerHTML =
        '<p style="font-family:Montserrat,Arial,sans-serif;color:#173348;padding:24px">Getting the showing packet link…</p>';
    } catch {
      /* cosmetic only */
    }
  }
  try {
    const { fileName, url } = await emailShowingPacket(tx.id);
    const email = showingPacketEmail(tx.address, url);
    if (composeTab) composeTab.location.href = gmailComposeUrl(email);
    else window.location.href = mobile ? mailtoUrl(email) : gmailComposeUrl(email);
    return fileName;
  } catch (e) {
    if (composeTab) composeTab.close();
    throw e;
  }
}
