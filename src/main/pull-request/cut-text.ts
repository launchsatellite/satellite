export function cutText(text: string, limit: number): { text: string; cut: boolean } {
  if (text.length <= limit) return { text, cut: false };
  const last = text.charCodeAt(limit - 1);
  const splitsPair = last >= 0xd800 && last <= 0xdbff;
  return { text: text.slice(0, splitsPair ? limit - 1 : limit), cut: true };
}
