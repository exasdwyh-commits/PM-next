/** Poll the public execution receipt; never call the synchronous service from HTTP acceptance tests. */
export async function waitForAcceptedMessage(
  receipt: { status: number; json: any },
  read: () => Promise<{ status: number; json: any }>,
) {
  if (receipt.status !== 202 && receipt.status !== 200) return receipt;
  const execution = receipt.json?.execution;
  if (!execution?.runId) throw new Error("Acceptance receipt has no runId");
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const result = await read();
    if (result.status !== 200) throw new Error(`Read receipt failed: ${result.status}`);
    const current = result.json.executions?.find((run: any) => run.runId === execution.runId);
    if (current && current.status !== "QUEUED" && current.status !== "RUNNING") {
      const message = result.json.messages?.find((item: any) => item.id === current.outputMessageId);
      if (!message) throw new Error(`Execution ${current.status}: ${current.error || "missing output"}`);
      return { ...receipt, json: { ...receipt.json, execution: current, message } };
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("Accepted message did not finish within 30 seconds");
}
