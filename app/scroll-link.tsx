"use client";

import Link from "next/link";
import type { LinkProps } from "next/link";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { scrollToPageTop } from "./scroll-to-top";

type ScrollLinkProps = LinkProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof LinkProps> & {
    children: ReactNode;
  };

export default function ScrollLink({ children, onClick, ...props }: ScrollLinkProps) {
  return (
    <Link
      {...props}
      onClick={(event) => {
        scrollToPageTop();
        onClick?.(event);
      }}
    >
      {children}
    </Link>
  );
}
