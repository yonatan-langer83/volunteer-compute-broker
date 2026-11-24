export function redact(text: string, secrets: readonly string[] = []): string {
  let out = text
  const extras = secrets.filter((secret) => secret.length >= 8).sort((a, b) => b.length - a.length)
  for (const secret of extras) {
    out = out.split(secret).join('[REDACTED]')
  }
  out = out.replace(/sk-ant-[A-Za-z0-9_-]{8,}/g, '[REDACTED]')
  out = out.replace(/sk-[A-Za-z0-9_-]{16,}/g, '[REDACTED]')
  out = out.replace(/xai-[A-Za-z0-9_-]{8,}/g, '[REDACTED]')
  out = out.replace(/AIza[0-9A-Za-z_-]{16,}/g, '[REDACTED]')
  out = out.replace(/ya29\.[0-9A-Za-z\-_.]+/g, '[REDACTED]')
  out = out.replace(/([?&]key=)[^&\s]+/gi, '$1[REDACTED]')
  out = out.replace(/vbk_[A-Za-z0-9_-]{16,}/g, '[REDACTED]')
  return out
}
