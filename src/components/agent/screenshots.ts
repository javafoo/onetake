/* A screenshot pasted, dropped or picked into a message box. Shrunk here, in
   the browser, so three of them still fit one request, and the words on a
   post survive 1200px easily. Shared by both chats. */

export type Attachment = { id: string; name: string; dataUrl: string };
const ATTACHMENT_MAX_SIDE = 1200;
const ATTACHMENT_MAX_CHARS = 800_000; // ~600KB of JPEG once base64 is taken off

export async function shrink(file: File): Promise<Attachment> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, ATTACHMENT_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot read the image.");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  let quality = 0.86;
  let dataUrl = canvas.toDataURL("image/jpeg", quality);
  while (dataUrl.length > ATTACHMENT_MAX_CHARS && quality > 0.4) {
    quality -= 0.14;
    dataUrl = canvas.toDataURL("image/jpeg", quality);
  }
  return { id: crypto.randomUUID(), name: file.name || "screenshot", dataUrl };
}

export const isImageFile = (file: File) => /^image\/(jpeg|png|webp|gif|heic|heif)$/i.test(file.type) || /^image\//i.test(file.type);
