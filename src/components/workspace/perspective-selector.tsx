"use client";
import { useEffect, useState } from "react";
import { perspectiveStorageKey, readPerspective, WORK_PERSPECTIVES, type WorkPerspective } from "@/modules/workspace/perspective";
export function useWorkPerspective(organizationId: string, userId: string) {
  const key = perspectiveStorageKey(organizationId, userId);
  const [selection, setSelection] = useState<{ key: string; role: WorkPerspective } | null>(null);
  useEffect(() => {
    const load = () => {
      let role: WorkPerspective = "leadership";
      try { role = readPerspective(localStorage.getItem(key)); } catch { /* Session-only selection when storage is disabled. */ }
      setSelection({ key, role });
    };
    load();
    const sync = (event: StorageEvent) => { if (event.key === key || event.key === null) load(); };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [key]);
  const role = selection?.key === key ? selection.role : "leadership";
  return { role, select: (role: WorkPerspective) => {
    setSelection({ key, role });
    try { localStorage.setItem(key, role); } catch { /* The visible selection remains usable. */ }
  } };
}
export function PerspectiveSelector({ role, onSelect }: { role: WorkPerspective; onSelect: (role: WorkPerspective) => void }) {
  return <div className="kern-perspective" role="group" aria-label="工作视角">
    <span>工作视角</span>
    {WORK_PERSPECTIVES.map(item => <button type="button" key={item.value} aria-pressed={role === item.value}
      title={item.focus} onClick={() => onSelect(item.value)}>{item.label}</button>)}
  </div>;
}
