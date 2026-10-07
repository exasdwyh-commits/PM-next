"use client";

import { createContext, useContext, useRef, useState, type ReactNode } from "react";

export type ConclusionChoice = { missionId: string; question: string; label: string; demo: boolean };
export type ChoiceState = { busy?: boolean; disabled?: boolean; selected?: string; error?: string };

/** A report choice is a conversational instruction; connector grants use their own approval gate. */
export function conclusionChoiceMessage({ question, label }: ConclusionChoice): string {
  return `关于报告中的「${question}」，我选择：${label}。`;
}

const Decisions = createContext<{
  state: (choice: ConclusionChoice, options: string[]) => ChoiceState;
  choose: (choice: ConclusionChoice) => Promise<void>;
} | null>(null);

export function ConclusionDecisions({ replies, disabled, send, children }: {
  replies: string[];
  disabled: boolean;
  send: (text: string) => Promise<boolean>;
  children: ReactNode;
}) {
  const [states, setStates] = useState<Record<string, ChoiceState>>({});
  const pending = useRef(false);
  const key = (c: ConclusionChoice) => JSON.stringify([c.missionId, c.question]);
  return <Decisions.Provider value={{
    state: (choice, options) => {
      const saved = states[key(choice)];
      const selected = !choice.demo ? options.find(label => replies.includes(conclusionChoiceMessage({ ...choice, label }))) : undefined;
      return { ...saved, selected: saved?.selected ?? selected, error: selected ? undefined : saved?.error, disabled };
    },
    choose: async choice => {
      if (pending.current || disabled) return;
      const id = key(choice);
      pending.current = true;
      setStates(current => ({ ...current, [id]: { busy: true } }));
      try {
        if (!choice.demo && !await send(conclusionChoiceMessage(choice))) throw new Error("选择没有发送成功，请重试。");
        setStates(current => ({ ...current, [id]: { selected: choice.label } }));
      } catch (error) {
        setStates(current => ({ ...current, [id]: { error: error instanceof Error ? error.message : "提交失败，请重试。" } }));
      } finally {
        pending.current = false;
      }
    },
  }}>{children}</Decisions.Provider>;
}

export function useConclusionDecisions() { return useContext(Decisions); }
