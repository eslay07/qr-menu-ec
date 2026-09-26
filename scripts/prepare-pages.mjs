import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const output = path.resolve("dist-pages");
await fs.mkdir(path.join(output, "demo"), { recursive: true });
await fs.copyFile("public/demo/encebollado.jpg", path.join(output, "demo/encebollado.jpg"));
await fs.copyFile("public/icon.svg", path.join(output, "icon.svg"));
for (const size of [192, 512])
  await sharp("public/icon.svg")
    .resize(size, size)
    .png()
    .toFile(path.join(output, `icon-${size}.png`));

// Retire earlier caches so an old browser cannot keep showing stale prices.
await fs.writeFile(
  path.join(output, "sw.js"),
  `self.addEventListener('install',event=>{self.skipWaiting()});
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  for(const name of await caches.keys())await caches.delete(name);
  await self.registration.unregister();
  await self.clients.claim();
})()));\n`,
);

await fs.mkdir(path.join(output, "downloads"), { recursive: true });
await fs.copyFile("deployment/android/qr-menu-ec.apk", path.join(output, "downloads/qr-menu-ec.apk"));
await fs.copyFile("deployment/android/qr-menu-android.apk", path.join(output, "downloads/qr-menu-android.apk"));
await fs.copyFile("deployment/android/SHA256SUMS.txt", path.join(output, "downloads/SHA256SUMS.txt"));
console.log("Pages: menú HTTPS, APK online y retiro de cachés preparados.");
