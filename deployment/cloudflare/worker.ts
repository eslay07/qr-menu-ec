import { handleApi } from "../../lib/api";
import { cloudStore } from "../../lib/cloud-store";
import {
  handleCreatorApi,
  isCreatorRequest,
  type CentralEnv,
} from "../../lib/central-api";
import type { Mode } from "../../lib/contracts";

type Env = CentralEnv & { ASSETS: Fetcher; LICENSE_PUBLIC_KEY?: string };
const restaurantPath = /^\/r\/([a-f0-9-]{36})(\/.*)?$/;

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/creator/"))
      return handleCreatorApi(request, env);
    const match = url.pathname.match(restaurantPath);
    if (match && match[2]?.startsWith("/api/v1/")) {
      const id = match[1],
        store = cloudStore(id, env),
        stored = await store.read();
      const creator = await isCreatorRequest(request, env);
      url.pathname = match[2];
      const scopedRequest = new Request(url, request);
      return handleApi(scopedRequest, store, {
        publicKey: env.LICENSE_PUBLIC_KEY || "",
        setupToken: "",
        platformUser: undefined,
        runtime: "cloud",
        forcedRole: creator ? "creator" : undefined,
        grantedModes: (stored?.state.access?.modes || []) as Mode[],
        ownerAccess: stored?.state.access?.active !== false,
        basePath: `/r/${id}`,
      });
    }
    if (url.pathname === "/")
      return Response.redirect(`${url.origin}/creator`, 302);
    if (
      url.pathname === "/creator" ||
      url.pathname === "/owner" ||
      url.pathname === "/demo" ||
      (match && ["/", "/menu", "/portal", "/preview"].includes(match[2] || "/"))
    ) {
      url.pathname = "/";
      return env.ASSETS.fetch(new Request(url, request));
    }
    return env.ASSETS.fetch(request);
  },
};
