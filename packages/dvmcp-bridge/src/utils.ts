export function slugify(input: string): string {
  return (
    input
      .trim()
      .toLowerCase()
      // Normalize unicode characters to their base form
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      // Remove non-word characters except spaces and hyphens
      .replace(/[^\w\s-]/g, '')
      // Replace spaces, underscores, or multiple hyphens with a single hyphen
      .replace(/[\s_-]+/g, '-')
      // Remove leading and trailing hyphens
      .replace(/^-+|-+$/g, '')
  );
}

export function getServerId(
  serverName: string,
  publicKey: string,
  configServerId?: string
): string {
  // If custom server ID is provided in config, use it
  if (configServerId) {
    return slugify(configServerId);
  }

  // Generate a stable ID by combining server name and first 6 characters of public key
  const combinedId = `${serverName}-${publicKey.slice(0, 6)}`;

  // Slugify the combined ID to make it URL-friendly
  return slugify(combinedId);
}
