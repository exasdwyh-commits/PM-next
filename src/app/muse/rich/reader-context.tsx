"use client";
/**
 * Reader + composer bridge for rich replies.
 * Rich blocks and artifact frames never call business APIs themselves: they ask the host
 * (muse-client) to open the reading pane, prefill the composer, or send through the
 * existing message handler.
 */
import { createContext, useContext } from "react";
import type { ArtifactCitation } from "@/modules/artifacts/protocol";

export type ReaderItem =
  | { kind: "artifact"; id: string; version?: number; title?: string }
  | { kind: "message"; messageId: string; title?: string }
  | { kind: "mission"; missionId: string; text: string; title?: string };

export type KernHost = {
  reader: ReaderItem | null;
  openReader: (item: ReaderItem, opener?: HTMLElement | null) => void;
  closeReader: () => void;
  /** Put text in the composer (user decides whether to send). */
  prefill: (text: string) => void;
  /** Send through the real message handler. Resolves false when not sent. */
  send: (text: string) => Promise<boolean>;
  busy: boolean;
  /** Look up artifact metadata attached to any loaded message. */
  artifact: (id: string) => ArtifactCitation | null;
};

export const KernHostContext = createContext<KernHost | null>(null);
export function useKernHost() { return useContext(KernHostContext); }

/** Scope for source anchors so [n] in one reply never jumps into another reply. */
export const RichScopeContext = createContext<string>("global");
export function useRichScope() { return useContext(RichScopeContext); }
