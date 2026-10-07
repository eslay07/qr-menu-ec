// Header validation shared by server-side copies. This is not an image decoder.
export function validateStoredImage(bytes: Uint8Array, type: string) {
  if (!bytes.length || bytes.length > 1_000_000) throw Error('Imagen fuera de límite.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (from: number, to: number) => new TextDecoder().decode(bytes.subarray(from, to));
  let width = 0, height = 0;
  if (type === 'image/png' && bytes.length >= 33 && [137,80,78,71,13,10,26,10].every((v, i) => bytes[i] === v) && text(12, 16) === 'IHDR') {
    width = view.getUint32(16); height = view.getUint32(20);
  } else if (type === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216) {
    let at = 2;
    while (at + 4 <= bytes.length && bytes[at] === 255) {
      const marker = bytes[at + 1], size = view.getUint16(at + 2);
      if (size < 2 || at + size + 2 > bytes.length) break;
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker) && size >= 8) {
        height = view.getUint16(at + 5); width = view.getUint16(at + 7); break;
      }
      at += size + 2;
    }
  } else if (type === 'image/webp' && bytes.length >= 30 && text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP') {
    const chunk = text(12, 16);
    if (chunk === 'VP8X') {
      width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
      height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
    } else if (chunk === 'VP8 ' && bytes[23] === 157 && bytes[24] === 1 && bytes[25] === 42) {
      width = view.getUint16(26, true) & 16383; height = view.getUint16(28, true) & 16383;
    } else if (chunk === 'VP8L' && bytes[20] === 47) {
      const bits = view.getUint32(21, true);
      width = 1 + (bits & 16383); height = 1 + ((bits >>> 14) & 16383);
    }
  }
  if (width < 1 || height < 1 || width > 4096 || height > 4096 || width * height > 12_000_000) throw Error('Formato o dimensiones de imagen inválidos.');
  return { width, height };
}
