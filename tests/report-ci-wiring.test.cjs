const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
// Already pinned at node_modules/js-yaml in the repository lockfile (ESLint toolchain).
const yaml = require('js-yaml');
const requiredReports = ['quality', 'delivery-gate', 'edit', 'poster', 'content-agent'].map(n => `tests/kern-report-${n}.test.ts`);
const triggerFiles = [
  'tests/kern-report-content-agent.test.ts', 'tests/model-gateway-routing.test.ts',
  'tests/test-safety.ts', 'tests/test-isolation-proof.test.ts', 'tests/report-ci-wiring.test.cjs',
  'scripts/run-test.ts', 'scripts/check-test-isolation.ts', 'scripts/lib/test-isolation-proof.ts',
  'src/shared/report-quality-store.ts', 'tests/flow-zoom-guard.test.ts', 'tests/flow-zoom-render.test.ts',
  'tests/kern-execution-flow.test.ts', 'tests/role-callout-radius-guard.test.ts',
];
function readConfig() {
  return { scripts: JSON.parse(fs.readFileSync('package.json', 'utf8')).scripts,
    quality: yaml.load(fs.readFileSync('.github/workflows/quality-ci.yml', 'utf8')),
    supervisor: yaml.load(fs.readFileSync('.github/workflows/kern-supervisor-ci.yml', 'utf8')) };
}
function violations(config) {
  const errors = [], scripts = config.scripts;
  const expectedReport = 'node --import tsx --test ' + requiredReports.join(' ');
  if (scripts['test:report-quality'] !== expectedReport) errors.push('all five report suites must execute exactly once');
  if (scripts['test:report-edit-wiring'] !== 'tsx scripts/run-test.ts tests/kern-report-edit-wiring.test.ts') errors.push('wiring must retain the safe wrapper');
  if (scripts['test:db-isolation'] !== 'tsx scripts/run-test.ts scripts/check-test-isolation.ts') errors.push('isolation preflight must use the safe wrapper');
  if (scripts['test:ci-contracts'] !== 'node --import tsx --test tests/test-isolation-proof.test.ts tests/report-ci-wiring.test.cjs') errors.push('both pure CI/isolation contracts must run');
  if (scripts['test:flow-zoom'] !== 'node --import tsx --test tests/flow-zoom-guard.test.ts tests/flow-zoom-render.test.ts tests/kern-execution-flow.test.ts') errors.push('flow guards and SSR must be wired');
  if (scripts['test:role-callout-radius'] !== 'node --import tsx --test tests/role-callout-radius-guard.test.ts') errors.push('role guard must be wired');
  for (const [workflow, jobName] of [[config.quality, 'typecheck'], [config.supervisor, 'supervisor']]) {
    const job = workflow.jobs[jobName], steps = job.steps || [];
    if ('if' in job || job['continue-on-error']) errors.push('contract job cannot be conditional or optional');
    for (const command of ['test:report-quality', 'test:ci-contracts', 'test:flow-zoom', 'test:role-callout-radius']) {
      const found = steps.filter(s => s.run?.trim() === `npm run ${command}`);
      if (found.length !== 1 || found[0]?.['continue-on-error'] || found[0] && 'if' in found[0]) errors.push(`hard job step missing/optional: ${jobName}/${command}`);
    }
  }
  const steps = config.supervisor.jobs.supervisor.steps;
  const preflight = steps.findIndex(s => s.run?.trim() === 'npm run test:db-isolation');
  const migration = steps.findIndex(s => s.run?.trim() === 'npx prisma migrate deploy');
  const wiring = steps.findIndex(s => s.run?.trim() === 'npm run test:report-edit-wiring');
  const contracts = steps.findIndex(s => s.run?.trim() === 'npm run test:ci-contracts');
  if (contracts < 0 || preflight < 0 || migration < 0 || wiring < 0 || !(contracts < preflight && preflight < migration && migration < wiring) ||
      steps[preflight]?.['continue-on-error'] || steps[preflight] && 'if' in steps[preflight]) errors.push('hard isolation preflight must precede migrations and DB wiring');
  for (const event of ['pull_request', 'push']) for (const file of triggerFiles) {
    if (!(config.supervisor.on[event].paths || []).includes(file)) errors.push(`missing trigger: ${event}/${file}`);
  }
  return errors;
}
test('CI contract: real candidate scripts/jobs/triggers form a hard, safe suite-to-job chain', () => {
  assert.deepEqual(violations(readConfig()), []);
});
const mutations = {
  'drop content-agent suite': c => { c.scripts['test:report-quality'] = c.scripts['test:report-quality'].replace(' tests/kern-report-content-agent.test.ts', ''); },
  'bypass wiring wrapper': c => { c.scripts['test:report-edit-wiring'] = 'node --import tsx --test tests/kern-report-edit-wiring.test.ts'; },
  'skip guard-only PR trigger': c => { c.supervisor.on.pull_request.paths = c.supervisor.on.pull_request.paths.filter(p => p !== 'tests/test-safety.ts'); },
  'skip isolation test trigger': c => { c.supervisor.on.push.paths = c.supervisor.on.push.paths.filter(p => p !== 'tests/test-isolation-proof.test.ts'); },
  'optional contract step': c => { c.quality.jobs.typecheck.steps.find(s => s.run === 'npm run test:ci-contracts')['continue-on-error'] = true; },
  'conditional report step': c => { c.supervisor.jobs.supervisor.steps.find(s => s.run === 'npm run test:report-quality').if = 'false'; },
  'move preflight after migrations': c => { const s = c.supervisor.jobs.supervisor.steps, i = s.findIndex(x => x.run === 'npm run test:db-isolation'); s.push(...s.splice(i, 1)); },
  'omit new UI guard': c => { c.scripts['test:flow-zoom'] = 'echo skipped'; },
};
for (const [name, mutate] of Object.entries(mutations)) test(`CI contract mutation: ${name} must be rejected`, () => {
  const config = readConfig();
  // This is a mutation of a valid candidate, not an already-broken fixture.
  assert.deepEqual(violations(config), []);
  mutate(config); assert.notDeepEqual(violations(config), []);
});

for (const succeeds of [true, false]) test(`isolation preflight delegates to the actual guard and closes client: ${succeeds}`, async () => {
  const ts = require('typescript'), vm = require('node:vm');
  const source = fs.readFileSync('scripts/check-test-isolation.ts', 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  let calls = 0, disconnected = 0;
  const process = { exitCode: 0 };
  vm.runInNewContext(compiled, { exports: {}, process, console: { error() {} }, require: name => {
    assert.equal(name, '../tests/test-safety', 'no real database import allowed in the probe');
    return { assertTestDatabaseSafety: () => { calls++; return succeeds ? Promise.resolve() : Promise.reject(new Error('synthetic guard failure')); },
      testPrisma: { $disconnect: async () => { disconnected++; } } };
  } }, { timeout: 1000 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1); assert.equal(disconnected, 1); assert.equal(process.exitCode, succeeds ? 0 : 1);
});
