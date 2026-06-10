// Glass card surface. The base container for most panels and tiles.

import type { HTMLAttributes } from "react";

type PanelProps = HTMLAttributes<HTMLDivElement> & {
  // tighter padding for dense tiles
  tight?: boolean;
};

export function Panel({ tight, className = "", children, ...rest }: PanelProps) {
  return (
    <div
      className={`glass rounded-2xl ${tight ? "p-4" : "p-5"} ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}
