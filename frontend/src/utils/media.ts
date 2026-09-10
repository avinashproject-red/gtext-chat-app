export const MAX_ATTACH_BYTES = 3.5 * 1024 * 1024;

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not read that image.'));
    image.src = url;
  });
}

async function compressImageFile(file: File, maxEdge: number, quality: number): Promise<string> {
  const sourceUrl = await fileToDataUrl(file);
  if (typeof document === 'undefined') return sourceUrl;

  const image = await loadImage(sourceUrl);
  const longest = Math.max(image.width || 1, image.height || 1);
  const scale = Math.min(1, maxEdge / longest);
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) return sourceUrl;
  context.fillStyle = '#111';
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  const compressed = canvas.toDataURL('image/jpeg', quality);
  return compressed.length < sourceUrl.length ? compressed : sourceUrl;
}

export async function compressAvatar(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please choose an image file.');
  }
  return compressImageFile(file, 320, 0.72);
}

export async function prepareMediaPayload(
  file: File
): Promise<{ dataUrl: string; filename: string; size: number }> {
  if (file.type.startsWith('image/') && file.type !== 'image/gif') {
    const dataUrl = await compressImageFile(file, 1280, 0.7);
    if (dataUrl.length > MAX_ATTACH_BYTES * 1.4) {
      throw new Error('That image is still too large after compression. Try a smaller photo.');
    }
    return {
      dataUrl,
      filename: file.name.replace(/\.[^.]+$/, '.jpg'),
      size: Math.ceil((dataUrl.length * 3) / 4),
    };
  }

  if (file.size > MAX_ATTACH_BYTES) {
    throw new Error('That file is too large. Please choose a smaller image, video, or document.');
  }

  return {
    dataUrl: await fileToDataUrl(file),
    filename: file.name,
    size: file.size,
  };
}
