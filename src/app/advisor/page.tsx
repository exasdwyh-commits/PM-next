import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Keep historical bookmarks while using one durable conversation interface. */
export default async function AdvisorPage({ searchParams }: {
  searchParams: Promise<{ product?: string; c?: string; query?: string }>;
}) {
  const input = await searchParams;
  const params = new URLSearchParams();
  for (const key of ["c", "product", "query"] as const) if (input[key]) params.set(key, input[key]);
  redirect(`/muse${params.size ? `?${params}` : ""}`);
}
