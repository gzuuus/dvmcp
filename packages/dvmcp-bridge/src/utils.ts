export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function getServerId(
  serverName: string,
  publicKey: string,
  configServerId?: string
): string {
  if (configServerId) {
    return slugify(configServerId);
  }
  const combinedId = `${serverName}-${publicKey.slice(0, 6)}`;

  return slugify(combinedId);
}
