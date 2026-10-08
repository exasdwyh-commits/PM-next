"use client";

import type { ComponentProps } from "react";
import { ProjectBrief } from "@/components/workspace/project-brief";

/** All role views use the same project facts and actionable destinations. */
export function OverviewRoleBased(props: ComponentProps<typeof ProjectBrief>) {
  return <ProjectBrief {...props} />;
}
