"use client";

import * as React from "react";
import { categoryMeta } from "@/modules/tenant";
import "./glass-card.css";

export function GlassCard({ children, category = "health_food", hover3d = false, magnetic = false, className = "", style = {} as any, ...props }: any) {
  const catInfo = categoryMeta(category);
  const ref = React.useRef<HTMLDivElement>(null);
  const [mousePos, setMousePos] = React.useState({ x: 0, y: 0 });

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!hover3d || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const x = (e.clientX - rect.left - rect.width / 2) / rect.width;
    const y = (e.clientY - rect.top - rect.height / 2) / rect.height;
    setMousePos({ x, y });
  };

  const handleMouseLeave = () => setMousePos({ x: 0, y: 0 });

  return (
    <div
      ref={ref}
      className={`glass-card ${hover3d ? "card-3d" : ""} ${magnetic ? "magnetic-btn" : ""} ${className}`}
      data-category={category}
      style={{
        ...style,
        ...(hover3d ? { transform: `perspective(1000px) rotateX(${mousePos.y * -5}deg) rotateY(${mousePos.x * 5}deg) translateY(${mousePos.x || mousePos.y ? -4 : 0}px)` } : {}),
        boxShadow: `0 8px 32px rgba(0,0,0,0.08), 0 0 0 1px rgba(255,255,255,0.5) inset, ${catInfo.shadow}`,
      } as any}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      {...props}
    >
      <div className="glass-card-inner" style={{ background: catInfo.gradient, opacity: 0.6, position: "absolute", inset: 0, borderRadius: "inherit", pointerEvents: "none" }} />
      <div style={{ position: "relative", zIndex: 1 }}>{children}</div>
    </div>
  );
}

export function BentoGrid({ children, className = "", ...props }: any) {
  return <div className={`bento-grid ${className}`} {...props}>{children}</div>;
}

export function BentoItem({ children, span = 1, rowSpan = 1, category = "health_food", className = "", ...props }: any) {
  return (
    <div className={`bento-item ${span > 1 ? `span-${span}` : ""} ${rowSpan > 1 ? `row-${rowSpan}` : ""} ${className}`} data-category={category} {...props}>
      {children}
    </div>
  );
}

export function GradientText({ children, category = "health_food", className = "", ...props }: any) {
  return <span className={`gradient-text ${className}`} data-category={category} {...props}>{children}</span>;
}

export function AnimatedCounter({ value, suffix = "", prefix = "", duration = 600 }: any) {
  const [displayValue, setDisplayValue] = React.useState(0);
  const ref = React.useRef<HTMLSpanElement>(null);

  React.useEffect(() => {
    let start = 0;
    const end = parseFloat(value) || 0;
    const startTime = Date.now();

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const easeOutExpo = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      const current = Math.floor(start + (end - start) * easeOutExpo);
      setDisplayValue(current);
      if (progress < 1) requestAnimationFrame(animate);
      else setDisplayValue(end);
    };

    const observer = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) {
        animate();
        observer.disconnect();
      }
    });

    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [value, duration]);

  return <span ref={ref} className="count-up">{prefix}{displayValue}{suffix}</span>;
}

export function MeshGradientBg({ category = "health_food", children, className = "", ...props }: any) {
  return <div className={`mesh-bg ${className}`} data-category={category} {...props}>{children}</div>;
}
