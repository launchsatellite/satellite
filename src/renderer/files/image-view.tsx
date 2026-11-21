import { useState } from "react";
import type { FileRead } from "../../shared/bridge-contract.ts";
import { visibleText } from "../../shared/visible-text.ts";
import { imageBrokenSentence } from "./file-words.ts";

type ImageRead = Extract<FileRead, { kind: "image" }>;

interface ImageViewProps {
  type: ImageRead["type"];
  data: string;
  name: string;
}

const seeThrough =
  "repeating-conic-gradient(var(--line) 0% 25%, var(--raised) 0% 50%) 0 0 / 16px 16px";

export function ImageView({ type, data, name }: ImageViewProps) {
  const [size, setSize] = useState<{ width: number; height: number }>();
  const [broken, setBroken] = useState(false);
  if (broken) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <p data-testid="file-sentence" className="max-w-[360px] text-center text-[13px] text-fg2">
          {imageBrokenSentence}
        </p>
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="grid min-h-0 flex-1 place-items-center overflow-hidden p-4">
        <img
          data-testid="file-image"
          src={`data:${type};base64,${data}`}
          alt={visibleText(name)}
          draggable={false}
          decoding="async"
          style={{ background: seeThrough }}
          className="max-h-full max-w-full object-contain"
          onLoad={(event) => {
            setSize({
              width: event.currentTarget.naturalWidth,
              height: event.currentTarget.naturalHeight,
            });
          }}
          onError={() => {
            setBroken(true);
          }}
        />
      </div>
      <p
        data-testid="file-image-size"
        className="flex-none border-t border-line px-3 py-2 text-[12px] text-fg2"
      >
        {size === undefined
          ? " "
          : `${size.width.toLocaleString("en-US")} × ${size.height.toLocaleString("en-US")} pixels`}
      </p>
    </div>
  );
}
