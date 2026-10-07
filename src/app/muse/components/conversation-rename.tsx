"use client";

import { useEffect, useRef, useState } from "react";
import { Btn, StatefulBtn } from "./kit";
import { useBtnState } from "@/components/motion/react";
import { Sheet } from "./sheet";

export function ConversationRename({
  conversation, onClose, onSave,
}: {
  conversation: { id: string; title: string };
  onClose: () => void;
  onSave: (title: string) => Promise<void>;
}) {
  const [title, setTitle] = useState(conversation.title);
  const [btnState, runBtn] = useBtnState();
  const [error, setError] = useState<string | null>(null);
  const busy = btnState === "busy" || btnState === "done";
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  return (
    <Sheet title="重命名对话" sub="修改名称不会改变对话内容。" onClose={onClose}>
      <form className="m-rename-form" onSubmit={async (event) => {
        event.preventDefault();
        if (busy || !title.trim()) return;
        setError(null);
        try {
          await runBtn(() => onSave(title.trim()));
          if (!mounted.current) return;
          await new Promise((resolve) => setTimeout(resolve, 900));
          if (mounted.current) onClose();
        } catch (error) {
          setError(error instanceof Error ? error.message : "重命名失败，请重试");
        }
      }}>
        <label htmlFor="conversation-title">对话名称</label>
        <input id="conversation-title" value={title} onChange={(event) => setTitle(event.target.value)}
          required disabled={busy} autoComplete="off" />
        {error ? <p className="m-hint" role="alert">{error}</p> : null}
        <div className="m-rename-actions">
          <Btn onClick={onClose} disabled={busy}>取消</Btn>
          <StatefulBtn type="submit" v="primary" state={btnState} disabled={!title.trim()}>
            保存名称
          </StatefulBtn>
        </div>
      </form>
    </Sheet>
  );
}
