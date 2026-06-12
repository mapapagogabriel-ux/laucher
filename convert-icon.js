const sharp = require('sharp');
const fs = require('fs');

async function createIco() {
  // Create 256x256 PNG buffer
  const pngBuffer = await sharp('assets/icon.png')
    .resize(256, 256)
    .png()
    .toBuffer();

  // Build ICO file manually (single 256x256 PNG entry)
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);     // Reserved
  header.writeUInt16LE(1, 2);     // Type: ICO
  header.writeUInt16LE(1, 4);     // Number of images

  const entry = Buffer.alloc(16);
  entry.writeUInt8(0, 0);         // Width (0 = 256)
  entry.writeUInt8(0, 1);         // Height (0 = 256)
  entry.writeUInt8(0, 2);         // Color palette
  entry.writeUInt8(0, 3);         // Reserved
  entry.writeUInt16LE(1, 4);      // Color planes
  entry.writeUInt16LE(32, 6);     // Bits per pixel
  entry.writeUInt32LE(pngBuffer.length, 8);  // Size of image data
  entry.writeUInt32LE(22, 12);    // Offset to image data (6 + 16 = 22)

  const ico = Buffer.concat([header, entry, pngBuffer]);
  fs.writeFileSync('assets/icon.ico', ico);
  console.log('icon.ico created! Size:', ico.length, 'bytes');
}

createIco().catch(console.error);
