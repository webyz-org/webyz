import { useEffect, useState } from "react";

export function useResizeObserver(ref: React.RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    if (!ref.current) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      setWidth(entry.contentRect.width);
    });

    observer.observe(ref.current);

    return () => observer.disconnect();
  }, [ref]);

  return width;
}
