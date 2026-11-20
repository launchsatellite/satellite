import { linkRefusal } from "../../shared/bridge-contract.ts";
import { openInBrowser } from "../platform/browser.ts";
import { BridgeFailure, type BridgeHandlers } from "../bridge/registry.ts";
import { checkedLink } from "./link-check.ts";

const openGapMs = 1000;

export function linkHandlers(): Pick<BridgeHandlers, "links.open"> {
  let lastOpen = Number.NEGATIVE_INFINITY;
  return {
    "links.open": async ({ url }) => {
      const link = checkedLink(url);
      if (link === null) {
        throw new BridgeFailure("refused", linkRefusal);
      }
      const now = performance.now();
      if (now - lastOpen < openGapMs) {
        throw new BridgeFailure(
          "limit",
          "Satellite opens one link at a time. Try again in a moment.",
        );
      }
      lastOpen = now;
      try {
        await openInBrowser(link.href);
      } catch (error) {
        console.error("A link could not be opened", error);
        throw new BridgeFailure("failed", "Satellite couldn't open that link in your browser.");
      }
      return {};
    },
  };
}
