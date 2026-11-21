import { isIP, isIPv4 } from "node:net";

const mappedPrefix = "::ffff:";

function opensAtIpv4(host: string): boolean {
  const address = host.startsWith(mappedPrefix) ? host.slice(mappedPrefix.length) : host;
  return isIPv4(address) && (address === "0.0.0.0" || address.startsWith("127."));
}

function opensAtIpv6(host: string): boolean {
  return host === "::1" || host === "::";
}

export function portUrl(hosts: readonly string[], port: number): string | null {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  const known = hosts.filter((host) => isIP(host) !== 0);
  if (known.some(opensAtIpv4)) return `http://127.0.0.1:${String(port)}/`;
  if (known.some(opensAtIpv6)) return `http://[::1]:${String(port)}/`;
  return null;
}
