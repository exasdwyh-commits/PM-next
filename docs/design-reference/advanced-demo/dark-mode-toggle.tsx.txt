"use client";

import * as React from "react";
import "./dark-mode-toggle.css";

export function DarkModeToggle() {
  const [theme, setTheme] = React.useState<"light" | "dark">("light");

  React.useEffect(() => {
    const saved = localStorage.getItem("theme") as "light" | "dark" | null;
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const initial = saved || (prefersDark ? "dark" : "light");
    setTheme(initial);
    document.documentElement.setAttribute("data-theme", initial);
  }, []);

  const toggle = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("theme", next);
  };

  return (
    <button className="dark-mode-toggle" onClick={toggle} aria-label={`切换到${theme === "light" ? "深色" : "浅色"}模式`}>
      <span className="toggle-track">
        <span className={`toggle-thumb ${theme}`}>
          {theme === "light" ? "☀️" : "🌙"}
        </span>
      </span>
      <small>{theme === "light" ? "浅色" : "深色"}</small>
    </button>
  );
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
