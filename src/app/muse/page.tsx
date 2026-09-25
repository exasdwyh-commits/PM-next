import type { Metadata } from "next";
import "./muse.css";
import MuseClient from "./muse-client";
import { studioModel } from "./mock-data";

export const metadata: Metadata = {
  title: "Muse · 你的部门助理",
  description: "对话即操作系统：说目标，Muse 自己推进，需要你点头时才回来找你。",
};

/** 设计蓝图页：读模型目前来自 mock-data，接后端时换成 src/modules/* 的 read model。 */
export default function MusePage() {
  return <MuseClient model={studioModel} />;
}
