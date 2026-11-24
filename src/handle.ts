export function publicHandle(name: string, id: string): string {
  if (name.includes('@')) return anonymousHandle(id)
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (/^[a-z][a-z0-9-]{1,31}$/.test(slug)) return slug
  return anonymousHandle(id)
}

function anonymousHandle(id: string): string {
  return `donor-${id.replace(/-/g, '').slice(0, 8)}`
}
