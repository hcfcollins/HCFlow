// Ports create_instagram_posts() from hall-collins-listing-packet-combiner's
// ultra_simple_combiner.py to an in-browser canvas composite — same 1080x1350
// layout, photo crop, and text positioning for all three post types, using
// Playfair Display (this app's existing brand serif) instead of the original's
// hardcoded Times New Roman system-font path, which has no web equivalent to ship.

const CANVAS_WIDTH = 1080;
const CANVAS_HEIGHT = 1350;
const PHOTO_WIDTH = 1080;
const PHOTO_HEIGHT = 1085;
const ADDRESS_Y = 1206;
const ADDRESS_FONT_SIZE = 59;
const CITY_FONT_SIZE = 40;
const CITY_Y_OFFSET = 60;
const TEXT_X_OFFSET = 100;

export const POST_TYPES = {
  newListing: { label: "New Listing", templateUrl: "/instagram-new-listing-template.png", textColor: "white" },
  underContract: { label: "Under Contract", templateUrl: "/instagram-under-contract-template.png", textColor: "#173348" },
  sold: { label: "Sold", templateUrl: "/instagram-sold-template.png", textColor: "#173348" },
};

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });
}

/** Cover-fit crop: center-crops the source to the target aspect ratio before
 * the caller draws it scaled to the target box — mirrors the Python original's
 * crop-then-resize (not a plain stretch). */
function coverFitCrop(img, targetWidth, targetHeight) {
  const targetAspect = targetWidth / targetHeight;
  const sourceAspect = img.width / img.height;
  if (sourceAspect > targetAspect) {
    const sw = img.height * targetAspect;
    return { sx: (img.width - sw) / 2, sy: 0, sw, sh: img.height };
  }
  const sh = img.width / targetAspect;
  return { sx: 0, sy: (img.height - sh) / 2, sw: img.width, sh };
}

function canvasToBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

/**
 * @param {{postType: keyof typeof POST_TYPES, photoBlob: Blob, address: string, cityState: string}} args
 * @returns {Promise<Blob>} a PNG blob ready to download.
 */
export async function composeListingGraphic({ postType, photoBlob, address, cityState }) {
  const { templateUrl, textColor } = POST_TYPES[postType] || POST_TYPES.newListing;

  await document.fonts.load(`${ADDRESS_FONT_SIZE}px "Playfair Display"`);
  await document.fonts.load(`${CITY_FONT_SIZE}px "Playfair Display"`);

  const [template, photo] = await Promise.all([loadImage(templateUrl), loadImage(URL.createObjectURL(photoBlob))]);

  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  const ctx = canvas.getContext("2d");

  ctx.drawImage(template, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  const crop = coverFitCrop(photo, PHOTO_WIDTH, PHOTO_HEIGHT);
  ctx.drawImage(photo, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, PHOTO_WIDTH, PHOTO_HEIGHT);

  ctx.textBaseline = "top";
  ctx.fillStyle = textColor;

  if (address) {
    const addressUpper = address.toUpperCase();
    ctx.font = `${ADDRESS_FONT_SIZE}px "Playfair Display"`;
    const addressWidth = ctx.measureText(addressUpper).width;
    const addressX = CANVAS_WIDTH / 2 - addressWidth / 2 + TEXT_X_OFFSET;
    ctx.fillText(addressUpper, addressX, ADDRESS_Y);
  }

  if (cityState) {
    const cityUpper = cityState.toUpperCase();
    ctx.font = `${CITY_FONT_SIZE}px "Playfair Display"`;
    const cityWidth = ctx.measureText(cityUpper).width;
    const cityX = CANVAS_WIDTH / 2 - cityWidth / 2 + TEXT_X_OFFSET;
    ctx.fillText(cityUpper, cityX, ADDRESS_Y + CITY_Y_OFFSET);
  }

  return canvasToBlob(canvas);
}

// ── Open House (square 1080×1080) ──
// Template: Fran's "HC - Insta Post OPEN HOUSE Blank.pdf" rendered to
// /instagram-open-house-template.png (pink bar, "OPEN HOUSE", dotted line).
// The photo fills everything above the pink bar, the white Hall Collins logo
// (/hall-collins-logo-white.png, transparent) goes over the photo in the same
// spot as the template, the full address is centered in the pink bar, and the
// date/time sits centered between the dotted line and the bottom edge.
const OH_SIZE = 1080;
const OH_PHOTO_HEIGHT = 734; // pink bar starts here
const OH_BAR_TOP = 734;
const OH_BAR_BOTTOM = 830;
const OH_DOTTED_LINE_Y = 977;
const OH_LOGO = { x: 33, y: 34, width: 495 };
const OH_PINK_TEXT_MAX = 1000;

/** Draws text centered on (cx, cy) with extra space between letters
 * (ctx.letterSpacing isn't in every browser yet, so letters are placed one by one). */
function drawSpacedCentered(ctx, text, cx, cy, spacing) {
  const chars = [...text];
  const widths = chars.map((c) => ctx.measureText(c).width);
  const total = widths.reduce((a, b) => a + b, 0) + spacing * (chars.length - 1);
  let x = cx - total / 2;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  chars.forEach((c, i) => {
    ctx.fillText(c, x, cy);
    x += widths[i] + spacing;
  });
  return total;
}

/**
 * @param {{photoBlob: Blob, addressLine: string, dateLine: string}} args
 *   addressLine: "408 Ridge Road Brookfield, VT"
 *   dateLine: "Sunday August 10th at 8:00 am - 11:00 am"
 * @returns {Promise<Blob>} PNG
 */
export async function composeOpenHouseGraphic({ photoBlob, addressLine, dateLine }) {
  await Promise.all([document.fonts.load(`600 48px "Playfair Display"`), document.fonts.load(`500 38px "Montserrat"`)]);
  const [template, logo, photo] = await Promise.all([
    loadImage("/instagram-open-house-template.png"),
    loadImage("/hall-collins-logo-white.png"),
    loadImage(URL.createObjectURL(photoBlob)),
  ]);

  const canvas = document.createElement("canvas");
  canvas.width = OH_SIZE;
  canvas.height = OH_SIZE;
  const ctx = canvas.getContext("2d");

  ctx.drawImage(template, 0, 0, OH_SIZE, OH_SIZE);
  const crop = coverFitCrop(photo, OH_SIZE, OH_PHOTO_HEIGHT);
  ctx.drawImage(photo, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, OH_SIZE, OH_PHOTO_HEIGHT);
  const logoHeight = (logo.height / logo.width) * OH_LOGO.width;
  ctx.drawImage(logo, OH_LOGO.x, OH_LOGO.y, OH_LOGO.width, logoHeight);

  // Address in the pink bar — shrinks to fit a long address.
  if (addressLine) {
    let size = 48;
    ctx.font = `600 ${size}px "Playfair Display"`;
    while (ctx.measureText(addressLine).width > OH_PINK_TEXT_MAX && size > 26) {
      size -= 2;
      ctx.font = `600 ${size}px "Playfair Display"`;
    }
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(addressLine, OH_SIZE / 2, (OH_BAR_TOP + OH_BAR_BOTTOM) / 2 + 2);
  }

  // Date/time under the dotted line, letter-spaced like the template.
  if (dateLine) {
    let size = 38;
    let spacing = 3;
    ctx.font = `500 ${size}px "Montserrat"`;
    const fits = () => {
      const w = [...dateLine].reduce((a, c) => a + ctx.measureText(c).width, 0) + spacing * (dateLine.length - 1);
      return w <= 940;
    };
    while (!fits() && size > 22) {
      size -= 1;
      spacing = Math.max(1, spacing - 0.2);
      ctx.font = `500 ${size}px "Montserrat"`;
    }
    ctx.fillStyle = "#173348";
    drawSpacedCentered(ctx, dateLine, OH_SIZE / 2, (OH_DOTTED_LINE_Y + OH_SIZE) / 2, spacing);
  }

  return canvasToBlob(canvas);
}

/** "2026-08-10" → "Sunday August 10th" */
export function openHouseDateText(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const day = dt.toLocaleDateString("en-US", { weekday: "long" });
  const month = dt.toLocaleDateString("en-US", { month: "long" });
  const suffix = d % 100 >= 11 && d % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][d % 10] || "th";
  return `${day} ${month} ${d}${suffix}`;
}

/** "13:30" → "1:30 pm"; "10:00 AM" → "10:00 am" */
export function openHouseTimeText(t) {
  const s = String(t || "").trim();
  const ampm = /^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/.exec(s);
  if (ampm) return `${Number(ampm[1])}:${ampm[2]} ${ampm[3].toLowerCase()}`;
  const h24 = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (h24) {
    const h = Number(h24[1]);
    return `${h % 12 || 12}:${h24[2]} ${h >= 12 ? "pm" : "am"}`;
  }
  return s;
}
