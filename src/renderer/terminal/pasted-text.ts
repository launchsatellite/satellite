const controls = /(?![\t\n\r])\p{Cc}/gu;

export function pastedText(text: string): string {
  return text.replace(controls, "");
}
