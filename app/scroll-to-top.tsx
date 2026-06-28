"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

export function scrollToPageTop() {
  window.scrollTo({ top: 0, behavior: "smooth" });
}

export default function ScrollToTop() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();

  useEffect(() => {
    scrollToPageTop();
  }, [pathname, search]);

  return null;
}
