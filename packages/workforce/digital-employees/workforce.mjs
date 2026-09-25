/**
 * Legacy/reference pure-worker orchestration loop.
 *
 * This class intentionally does not own tool handles or identities.
 * Any worker that needs file/shell/network side effects must receive a governed
 * service whose effects already pass through ToolBroker. This loop is safe only
 * for pure/in-memory transformations and test doubles.
 */
export class Workforce {
  async softwareLoop({ spec, coder, qa, reviewer, maxRounds = 3 }) {
    const history = [];
    let artifact = null;
    for (let round = 1; round <= maxRounds; round++) {
      const code = await coder({ spec, round, previous: artifact, history });
      const test = await qa({ spec, artifact: code, round });
      const review = await reviewer({ spec, artifact: code, test, round });
      history.push({ round, code, test, review });
      artifact = code;
      if (test.pass && review.pass) return { status: 'accepted', rounds: round, artifact, history };
    }
    return { status: 'needs-human-review', rounds: maxRounds, artifact, history };
  }
}
