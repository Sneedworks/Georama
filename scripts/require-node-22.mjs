// Verification gates run on Node 22 only (see docs/DEV.md and .nvmrc).
// The engines range in package.json is the runtime range of the application, not a gate range;
// this guard keeps typecheck, test, build, e2e and corpus on one major so results are reproducible.
const major = Number(process.versions.node.split('.')[0]);
if (major !== 22) {
  console.error(
    `The verification gates run on Node 22 (found ${process.version}). ` +
      'Use the version in .nvmrc, for example with "nvm use" or "mise use node@22".',
  );
  process.exit(1);
}
