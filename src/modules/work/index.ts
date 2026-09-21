// Module work: Work items, execution runs, receipts, and deliverables
export interface SubmitReceiptInput {
  workItemId: string;
  inputRevision: number;
  runMode: "MANUAL" | "TEST_STUB" | "AUTOMATED";
  status: "SUCCESS" | "FAILED" | "CANCELLED";
  artifactIds?: string[];
  errorMessage?: string;
}
