// electron-builder skips signing without an Apple certificate, but leaves Electron's original placeholder signature on a
// bundle that has since been changed (the app code and resources were added), which macOS on Apple silicon reports as
// "HitList is damaged and can't be opened". Re-signing the whole bundle with an ad-hoc signature (no certificate needed)
// makes the signature match the contents again. It does not make the app "trusted": the first-open steps still apply.
const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
  console.log('  • ad-hoc signed and verified', app);
};
