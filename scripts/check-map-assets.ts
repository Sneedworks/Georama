import { checkSelectedMapAssets } from '../electron/data/map-asset-check.ts';

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--help') {
  console.log('usage: node scripts/check-map-assets.ts --config <config-file> --map <map-file>');
  process.exitCode = 0;
} else if (args.length === 4 && ((args[0] === '--config' && args[2] === '--map') || (args[0] === '--map' && args[2] === '--config'))) {
  let configFile = '';
  let mapFile = '';
  if (args[0] === '--config') {
    configFile = args[1] as string;
    mapFile = args[3] as string;
  } else {
    mapFile = args[1] as string;
    configFile = args[3] as string;
  }
  try {
    const report = await checkSelectedMapAssets(mapFile, configFile);
    console.log(JSON.stringify(report));
    process.exitCode = report.ok ? 0 : 1;
  } catch {
    console.error(JSON.stringify({ ok: false, error: 'CHECK_FAILED' }));
    process.exitCode = 2;
  }
} else {
  console.error(JSON.stringify({ ok: false, error: 'USAGE' }));
  process.exitCode = 2;
}
