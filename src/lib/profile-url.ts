/** Browser-safe validation; hashing and network policy stay on the server. */
export function isLinkedInProfileUrl(raw: string): boolean {
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`);
    return url.protocol === "https:" && !url.username && !url.password && (!url.port || url.port === "443") &&
      (url.hostname === "linkedin.com" || url.hostname.endsWith(".linkedin.com")) && /^\/in\/[^/]+\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}
