import { isIP, isIPv4 } from "node:net";

const mappedPrefix = "::ffff:";
const defaultHttpPort = 80;

function opensAtIpv4(host: string): boolean {
  const address = host.startsWith(mappedPrefix) ? host.slice(mappedPrefix.length) : host;
  return isIPv4(address) && (address === "0.0.0.0" || address === "127.0.0.1");
}

function opensAtIpv6(host: string): boolean {
  return host === "::1" || host === "::";
}

function withPort(host: string, port: number): string {
  return port === defaultHttpPort ? `http://${host}/` : `http://${host}:${String(port)}/`;
}

export function portUrl(hosts: readonly string[], port: number): string | null {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  const known = hosts.filter((host) => isIP(host) !== 0);
  if (known.some(opensAtIpv4)) return withPort("127.0.0.1", port);
  if (known.some(opensAtIpv6)) return withPort("[::1]", port);
  return null;
}
