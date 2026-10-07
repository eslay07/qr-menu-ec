// Node-only test shim for the optional ambient binding. Tests must inject env.
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'cloudflare:workers') return { url: 'data:text/javascript,export const env = Object.freeze({});', shortCircuit: true };
  return nextResolve(specifier, context);
}
