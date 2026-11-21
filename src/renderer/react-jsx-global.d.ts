import type { JSX as ReactJsx } from "react";

declare global {
  namespace JSX {
    type Element = ReactJsx.Element;
    type ElementClass = ReactJsx.ElementClass;
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- hast-util-to-jsx-runtime types read the global JSX namespace that React 19 no longer declares
    interface IntrinsicElements extends ReactJsx.IntrinsicElements {}
  }
}
