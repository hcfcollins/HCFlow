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
