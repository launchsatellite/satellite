import { describe, expect, it } from "vitest";
import { processRow } from "../../shared/bridge-contract.ts";
import { checkedLink } from "../terminal/link-check.ts";
import { portUrl } from "./port-address.ts";

describe("portUrl", () => {
  it("opens 127.0.0.1 for an IPv4 loopback or wildcard bind", () => {
    expect(portUrl(["127.0.0.1"], 3000)).toBe("http://127.0.0.1:3000/");
    expect(portUrl(["0.0.0.0"], 3000)).toBe("http://127.0.0.1:3000/");
    expect(portUrl(["::", "0.0.0.0"], 3000)).toBe("http://127.0.0.1:3000/");
  });

  it("opens [::1] for an IPv6 loopback or wildcard bind with no IPv4 one", () => {
    expect(portUrl(["::1"], 3000)).toBe("http://[::1]:3000/");
    expect(portUrl(["::"], 3000)).toBe("http://[::1]:3000/");
    expect(portUrl(["192.168.1.20", "::1"], 3000)).toBe("http://[::1]:3000/");
  });

  it("treats an IPv4 mapped loopback as IPv4", () => {
    expect(portUrl(["::ffff:127.0.0.1"], 3000)).toBe("http://127.0.0.1:3000/");
  });

  it("gives no address for a LAN, link-local or unreadable bind", () => {
    for (const host of [
      "192.168.1.20",
      "fe80::1",
      "10.0.0.5",
      "example.com",
      "127.evil",
      "127.0.0.2",
      "127.0.0.53",
    ]) {
      expect(portUrl([host], 3000)).toBeNull();
    }
    expect(portUrl([], 3000)).toBeNull();
    expect(portUrl(["127.0.0.1"], 0)).toBeNull();
    expect(portUrl(["127.0.0.1"], 70000)).toBeNull();
  });

  it("builds an address links.open accepts for every kind of port, loopback only", () => {
    for (const host of ["127.0.0.1", "::1"]) {
      for (const port of [1, 80, 443, 5173, 65535]) {
        const url = portUrl([host], port);
        expect(url).not.toBeNull();
        expect(checkedLink(url ?? "")?.href).toBe(url);
        expect(["127.0.0.1", "[::1]"]).toContain(URL.parse(url ?? "")?.hostname);
        expect(processRow.shape.ports.element.shape.url.safeParse(url).success).toBe(true);
      }
    }
  });

  it("builds an address links.open accepts as it is", () => {
    for (const host of ["127.0.0.1", "::1"]) {
      const url = portUrl([host], 5173) ?? "";
      expect(checkedLink(url)?.href).toBe(url);
    }
  });
});
