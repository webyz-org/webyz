"use client";

import { useEffect } from "react";

/**
 * The header's dropdowns are native <details> elements, which only toggle from
 * their own <summary>. This adds the behaviour people expect from a menu:
 * a click or tap anywhere else closes it, so does Escape, and so does choosing
 * a link inside it (the product links are same-page anchors, so nothing else
 * would close the menu after the jump). Renders nothing.
 */
export default function MenuAutoClose() {
  useEffect(() => {
    const openMenus = () => Array.from(document.querySelectorAll<HTMLDetailsElement>("header details[open]"));

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      for (const menu of openMenus()) {
        if (target && menu.contains(target)) continue;
        menu.removeAttribute("open");
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      for (const menu of openMenus()) menu.removeAttribute("open");
    };

    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest("a");
      if (!link) return;
      for (const menu of openMenus()) {
        if (menu.contains(link)) menu.removeAttribute("open");
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("click", onClick);
    };
  }, []);

  return null;
}
