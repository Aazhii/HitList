// electron-builder skips signing without an Apple certificate, but leaves Electron's original placeholder signature on a
// bundle that has since been changed (the app code and resources were added), which macOS on Apple silicon reports as
// "HitList is damaged and can't be opened". Re-signing the whole bundle with an ad-hoc signature (no certificate needed)
// makes the signature match the contents again. It does not make the app "trusted": the first-open steps still apply.
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { smokeBackend } = require('./smoke-backend');

exports.default = async function afterPack(context) {
  const resources = context.electronPlatformName === 'darwin'
    ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : path.join(context.appOutDir, 'resources');
  await smokeBackend({
    java: path.join(resources, 'jre', 'bin', context.electronPlatformName === 'win32' ? 'java.exe' : 'java'),
    jar: path.join(resources, 'hitlist.jar'),
  });
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
  console.log('  • ad-hoc signed and verified', app);
};
