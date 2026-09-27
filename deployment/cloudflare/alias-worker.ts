type Env = { CORE: Fetcher };

export default {
  fetch(request: Request, env: Env) {
    return env.CORE.fetch(request);
  },
};
