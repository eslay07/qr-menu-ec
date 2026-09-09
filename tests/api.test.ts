import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import QRCode from "qrcode";
import sharp from "sharp";
import jsQR from "jsqr";
import { handleApi } from "../lib/api";
import { Catalog, defaultSettings, demoCatalog, wifiPayload } from "../lib/contracts";
import type { Store, Stored } from "../lib/store";

const pair = generateKeyPairSync("ed25519");
const publicKey = Buffer.from(pair.publicKey.export({ type: "spki", format: "der" }).subarray(-32)).toString("base64");

function harness() {
  let data: Stored | null = null;
  let ownerAccess = true;
  const media = new Map<string, { bytes: Uint8Array; type: string }>();
  const store: Store = {
    async read() { return structuredClone(data); },
    async commit(state, revision) {
      if (revision === null ? data !== null : !data || data.revision !== revision) return false;
      data = { state: structuredClone(state), revision: revision === null ? 0 : revision + 1 };
      return true;
    },
    async mediaGet(id) { return media.get(id) || null; },
    async mediaPut(id, bytes, type) { media.set(id, { bytes, type }); },
  };
  let cookie = "";
  return {
    async call(path: string, method = "GET", value?: unknown, origin?: string) {
      const response = await handleApi(new Request("https://menu.test/api/v1/" + path, {
        method,
        headers: { cookie, ...(value ? { "Content-Type": "application/json" } : {}), ...(origin ? { origin } : {}) },
        body: value ? JSON.stringify(value) : undefined,
      }), store, { publicKey, setupToken: "setup-secret", runtime: "local", ownerAccess });
      if (response.headers.has("set-cookie")) cookie = response.headers.get("set-cookie")!.split(";")[0];
      return { status: response.status, body: (await response.json()) as any };
    },
    license(restaurantId: string, modes = ["web"]) {
      const bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, restaurantId, licenseId: "test-license", modes, issuedAt: new Date().toISOString(), customer: "Prueba" }));
      return { payload: bytes.toString("base64"), signature: Buffer.from(sign(null, bytes, pair.privateKey)).toString("base64") };
    },
    suspend() { ownerAccess = false; },
  };
}

async function decode(payload: string) {
  const png = await QRCode.toBuffer(payload, { type: "png", width: 1200, margin: 4, errorCorrectionLevel: "M" });
  const image = await (sharp as any)(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return jsQR(new Uint8ClampedArray(image.data), image.info.width, image.info.height)?.data;
}

test("web is the default and produces one permanent menu QR", async () => {
  const h = harness();
  const setup = await h.call("setup", "POST", { name: "Mesa", password: "test-password-123", setupToken: "setup-secret" });
  assert.equal((await h.call("logout", "POST", {})).status, 200);
  assert.equal((await h.call("login", "POST", { code: "otro", password: "test-password-123" })).status, 401);
  assert.equal((await h.call("login", "POST", { code: setup.body.restaurantId, password: "test-password-123" })).status, 200);
  let state = (await h.call("state")).body;
  assert.equal(state.settings.mode, "web");
  await h.call("license", "POST", h.license(setup.body.restaurantId));
  state = (await h.call("state")).body;
  await h.call("draft", "PUT", { revision: state.revision, catalog: demoCatalog });
  state = (await h.call("state")).body;
  const webUrl = "https://qr-menu-ec.pages.dev/restaurante-demo";
  await h.call("settings", "PUT", { revision: state.revision, settings: { ...state.settings, webUrl } });
  state = (await h.call("state")).body;
  assert.equal((await h.call("publish", "POST", { revision: state.revision })).status, 200);
  const result = await h.call("qr");
  assert.deepEqual(result.body.codes.map((code: any) => code.kind), ["web"]);
  assert.equal(await decode(result.body.codes[0].payload), webUrl);
});

test("local mode produces menu and Wi-Fi codes", async () => {
  const h = harness();
  const setup = await h.call("setup", "POST", { name: "Mesa", password: "test-password-123", setupToken: "setup-secret" });
  await h.call("license", "POST", h.license(setup.body.restaurantId, ["local"]));
  let state = (await h.call("state")).body;
  await h.call("draft", "PUT", { revision: state.revision, catalog: demoCatalog });
  state = (await h.call("state")).body;
  await h.call("settings", "PUT", { revision: state.revision, settings: { ...state.settings, mode: "local" } });
  state = (await h.call("state")).body;
  await h.call("publish", "POST", { revision: state.revision });
  const result = await h.call("qr");
  assert.deepEqual(result.body.codes.map((code: any) => code.kind), ["local_menu", "wifi"]);
  assert.match(result.body.codes[1].payload, /^WIFI:/);
});

test("scoped Cloudflare media paths and Wi-Fi escaping are valid", () => {
  const path = "/r/998d4980-a169-469f-b009-634a373ca7ad/api/v1/media/11111111-1111-4111-8111-111111111111";
  assert.doesNotThrow(() => Catalog.parse({ ...demoCatalog, logo: path }));
  assert.match(wifiPayload({ ...defaultSettings, ssid: "Mesa;:A" }), /S:Mesa\\;\\:A/);
});

test("central suspension invalidates the session and public menu immediately", async () => {
  const h = harness();
  const setup = await h.call("setup", "POST", { name: "Mesa", password: "test-password-123", setupToken: "setup-secret" });
  await h.call("license", "POST", h.license(setup.body.restaurantId));
  let state = (await h.call("state")).body;
  await h.call("draft", "PUT", { revision: state.revision, catalog: demoCatalog });
  state = (await h.call("state")).body;
  await h.call("settings", "PUT", { revision: state.revision, settings: { ...state.settings, webUrl: "https://example.com/menu" } });
  state = (await h.call("state")).body;
  await h.call("publish", "POST", { revision: state.revision });
  h.suspend();
  const session = await h.call("session");
  assert.equal(session.body.authenticated, false);
  assert.equal(session.body.suspended, true);
  assert.equal((await h.call("menu")).status, 403);
  assert.equal((await h.call("state")).status, 403);
});

test("draft conflicts, recovery and snapshots remain atomic", async () => {
  const h = harness();
  const setup = await h.call("setup", "POST", { name: "Mesa", password: "test-password-123", setupToken: "setup-secret" });
  await h.call("license", "POST", h.license(setup.body.restaurantId, ["local"]));
  let state = (await h.call("state")).body;
  assert.equal((await h.call("draft", "PUT", { revision: state.revision, catalog: demoCatalog })).status, 200);
  assert.equal((await h.call("draft", "PUT", { revision: state.revision, catalog: demoCatalog })).status, 409);
  state = (await h.call("state")).body;
  await h.call("settings", "PUT", { revision: state.revision, settings: { ...state.settings, mode: "local" } });
  state = (await h.call("state")).body;
  await h.call("publish", "POST", { revision: state.revision });
  state = (await h.call("state")).body;
  await h.call("draft", "PUT", { revision: state.revision, catalog: { ...demoCatalog, name: "Borrador nuevo" } });
  assert.equal((await h.call("menu")).body.catalog.name, "La Mesa");
  assert.equal((await h.call("logout", "POST", {}, "https://evil.test")).status, 403);
  assert.equal((await h.call("logout", "POST", {})).status, 200);
  assert.equal((await h.call("recover", "POST", { recovery: setup.body.recovery, password: "new-password-123" })).status, 200);
});
