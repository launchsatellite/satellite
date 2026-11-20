interface SenderEvent {
  readonly senderFrame: { readonly url: string } | null;
  readonly sender: { readonly mainFrame: unknown };
}

export function isAllowedSender(url: string, isMainFrame: boolean, allowedOrigin: string): boolean {
  if (!isMainFrame) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.username !== "" || parsed.password !== "") return false;
  return `${parsed.protocol}//${parsed.host}` === allowedOrigin;
}

export function isTrustedSender(event: SenderEvent, allowedOrigin: string): boolean {
  try {
    const frame = event.senderFrame;
    if (frame === null) return false;
    return isAllowedSender(frame.url, frame === event.sender.mainFrame, allowedOrigin);
  } catch {
    return false;
  }
}
