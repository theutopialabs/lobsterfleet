// Decides whether a TCP peer is allowed to set X-Forwarded-Proto / Forwarded.
// Those headers flip https detection and the Secure cookie flag, so a random
// internet client must never control them.
//
// LOBSTERFLEET_TRUST_PROXY=always trusts any peer, =never trusts none. Unset
// trusts loopback + private ranges, which covers the usual LXC-behind-nginx
// and Docker setups without config.

export function trustForwardedHeaders(
  address: string | undefined,
  setting: string | undefined = process.env.LOBSTERFLEET_TRUST_PROXY,
): boolean {
  const mode = (setting ?? "").trim().toLowerCase();
  if (mode === "always" || mode === "1" || mode === "true") return true;
  if (mode === "never" || mode === "0" || mode === "false") return false;
  return isLoopbackAddress(address) || isPrivateAddress(address);
}

export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  return address === "::1" || address === "127.0.0.1" || address.startsWith("::ffff:127.");
}

export function isPrivateAddress(address: string | undefined): boolean {
  if (!address) return false;
  const v4 = address.startsWith("::ffff:") ? address.slice(7) : address;
  if (/^10\./.test(v4)) return true;
  if (/^192\.168\./.test(v4)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(v4)) return true;
  // fc00::/7 unique local ipv6
  return /^f[cd]/i.test(address);
}
