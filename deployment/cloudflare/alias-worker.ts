type Env = { CORE: Fetcher };

const worker = {
  fetch(request: Request, env: Env) {
    return env.CORE.fetch(request);
  },
};

export default worker;
