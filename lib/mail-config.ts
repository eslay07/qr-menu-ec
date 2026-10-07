export type MailConfig = { MAIL_DOMAIN?: string; EMAIL_FROM?: string; MAIL_SANDBOX?: string; MAIL_SANDBOX_TO?: string };

// Server configuration only. A domain is usable only after its DNS and sending
// provider have been verified externally; this function cannot provision DNS.
export function mailFrom(config: MailConfig): string | undefined {
  const domain = config.MAIL_DOMAIN?.trim().toLowerCase();
  if (!domain) return config.MAIL_SANDBOX === 'true' ? 'QR Menu EC <onboarding@resend.dev>' : config.EMAIL_FROM;
  if (domain === 'workers.dev' || domain.endsWith('.workers.dev') ||
      domain.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) {
    throw Error('MAIL_DOMAIN requiere un dominio propio verificado, no workers.dev.');
  }
  return `QR Menu EC <notificaciones@${domain}>`;
}

export function validateMailRecipient(config: MailConfig, to: string) {
  if (!config.MAIL_DOMAIN?.trim() && config.MAIL_SANDBOX === 'true') {
    if (!config.MAIL_SANDBOX_TO || to.trim().toLowerCase() !== config.MAIL_SANDBOX_TO.trim().toLowerCase()) throw Error('Modo de pruebas: solo se permite el destinatario de la cuenta Resend configurado.');
  }
}
