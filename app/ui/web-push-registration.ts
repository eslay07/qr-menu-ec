export type RegistrationPort = {
  subscribe: (next: (fid: string) => void, error: (error: Error) => void) => () => void;
  register: () => Promise<void>;
};
/** Wait for both initiation and the FID event; always dispose this temporary observer. */
export function waitForPushRegistration(port: RegistrationPort, timeoutMs = 10_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let stop: (() => void) | undefined, settled = false, initiated = false, fid: string | undefined;
    const finish = (error?: Error) => { if (settled) return; settled = true; clearTimeout(timer); stop?.(); if (error) reject(error); else resolve(fid!); };
    const timer = setTimeout(() => finish(Error('No se recibió el identificador de notificaciones. Vuelve a intentar.')), timeoutMs);
    const complete = () => { if (initiated && fid) finish(); };
    try {
      stop = port.subscribe(value => { if (!/^[cdef][A-Za-z0-9_-]{21}$/.test(value)) { finish(Error('Identificador de notificaciones inválido.')); return; } fid = value; complete(); }, error => finish(error));
      if (settled) { stop(); return; }
      void port.register().then(() => { initiated = true; complete(); }, error => finish(error instanceof Error ? error : Error('No se pudo registrar este navegador.')));
    } catch (error) { finish(error instanceof Error ? error : Error('No se pudo registrar este navegador.')); }
  });
}
