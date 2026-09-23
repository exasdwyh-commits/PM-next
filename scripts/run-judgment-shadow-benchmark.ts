import fs from "node:fs";
import path from "node:path";

import {
  DecisionIntelligenceKernel,
  LayaJudgmentProvider,
  createDefaultDecisionSpecs,
  createDefaultRulesDecisionEngine,
  runJudgmentShadow,
  type DecisionValue,
} from "../src/modules/decision-intelligence";

interface Fixture {
  id: string;
  decisionKey: string;
  specVersion?: string;
  state: unknown;
  criteria?: unknown;
  language?: string;
  expected: DecisionValue;
}

async function main() {
  const endpoint = process.env.JUDGMENT_RUNTIME_BASE_URL?.trim();
  if (!endpoint) {
    throw new Error("JUDGMENT_RUNTIME_BASE_URL is required");
  }

  const fixturePath = path.join(
    process.cwd(),
    "tests/fixtures/judgment/laya-shadow-cases.json"
  );
  const fixtures = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as Fixture[];

  const kernel = new DecisionIntelligenceKernel(createDefaultDecisionSpecs());
  kernel.registerEngine(createDefaultRulesDecisionEngine());

  const laya = new LayaJudgmentProvider({
    endpoint,
    timeoutMs: Number(process.env.JUDGMENT_RUNTIME_TIMEOUT_MS ?? 5000),
    model: process.env.LAYA_SHADOW_MODEL || undefined,
    task: process.env.LAYA_SHADOW_TASK || undefined,
  });
  kernel.registerProvider(laya);

  const rows = [];
  for (const fixture of fixtures) {
    const result = await runJudgmentShadow(
      kernel,
      {
        decisionKey: fixture.decisionKey,
        specVersion: fixture.specVersion,
        state: fixture.state,
        criteria: fixture.criteria,
        language: fixture.language,
        contextRefs: [`benchmark:${fixture.id}`],
      },
      laya.key
    );
    rows.push({
      id: fixture.id,
      decisionKey: fixture.decisionKey,
      expected: fixture.expected,
      status: result.status,
      authoritative: result.authoritativeValue,
      shadow: result.shadowValue,
      rulesCorrect: Object.is(result.authoritativeValue, fixture.expected),
      shadowCorrect:
        result.shadowValue === null
          ? null
          : Object.is(result.shadowValue, fixture.expected),
      confidence: result.shadow?.engineResult.confidence ?? null,
      providerVersion: result.shadow?.engineResult.providerVersion ?? null,
      reasonCodes: result.shadow?.engineResult.reasonCodes ?? [],
      error: result.shadowError,
    });
  }

  const matches = rows.filter((row) => row.status === "MATCH").length;
  const failures = rows.filter((row) => row.status === "SHADOW_FAILED").length;
  const compared = rows.length - failures;
  const rulesCorrect = rows.filter((row) => row.rulesCorrect).length;
  const shadowCorrect = rows.filter((row) => row.shadowCorrect === true).length;

  console.log(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        provider: laya.key,
        total: rows.length,
        compared,
        matches,
        disagreements: compared - matches,
        shadowFailures: failures,
        agreementRate: compared > 0 ? matches / compared : null,
        rulesAccuracy: rows.length > 0 ? rulesCorrect / rows.length : null,
        shadowAccuracy: compared > 0 ? shadowCorrect / compared : null,
        note:
          "Expected labels are frozen Hermes fixtures. Rules remain authoritative in P2 regardless of benchmark outcome.",
        rows,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
