"use client";

import { useState, type ReactNode } from "react";
import { Drawer } from "./kx";
import Icon from "./icons";

export function MobileNavigation({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className="hermes-mobile-menu hermes-ghost-btn" aria-label="打开导航"
      aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(true)}>
      <Icon name="menu" size={20} />
    </button>
    <Drawer title="导航" open={open} onClose={() => setOpen(false)}>
      <nav className="hermes-mobile-nav" aria-label="专业管理后台导航" onClick={event => {
        if (!event.ctrlKey && !event.metaKey && (event.target as HTMLElement).closest("a[href]")) setOpen(false);
      }}>{children}</nav>
    </Drawer>
  </>;
}
