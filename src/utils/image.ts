// Downscales an uploaded image to a small square data URL before it ever touches storage --
// Preferences persists as a plain string (native SharedPreferences on Android), and a
// full-resolution phone photo would be megabytes of base64 for a marker that only ever renders at
// ~20px on the map. Cover-fit crop to a centered square keeps the subject framed regardless of the
// source photo's aspect ratio.
export function downscaleImageToDataUrl(file: File, sizePx = 96): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = sizePx;
      canvas.height = sizePx;
      const ctx = canvas.getContext("2d");
      URL.revokeObjectURL(objectUrl);
      if (!ctx) { reject(new Error("Canvas unavailable")); return; }
      const scale = Math.max(sizePx / img.width, sizePx / img.height);
      const drawWidth = img.width * scale;
      const drawHeight = img.height * scale;
      ctx.drawImage(img, (sizePx - drawWidth) / 2, (sizePx - drawHeight) / 2, drawWidth, drawHeight);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Image load failed"));
    };
    img.src = objectUrl;
  });
}
