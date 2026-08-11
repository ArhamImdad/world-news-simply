"use client";

import NextImage, { type ImageProps } from "next/image";
import { useState } from "react";

export default function SafeImage({ src, alt, onError, ...props }: Omit<ImageProps, "src"> & { src: string }) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const currentSource = !src || failedSource === src ? "/og-default.svg" : src;

  return (
    <NextImage
      {...props}
      src={currentSource}
      alt={alt}
      onError={(event) => {
        if (currentSource !== "/og-default.svg") setFailedSource(src);
        onError?.(event);
      }}
    />
  );
}
