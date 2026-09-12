/**
 * Prints the deployed AppSail service's URL and status.
 *
 *   pnpm run appsail:url
 *
 * The URL is only otherwise visible in the console or in the output of a
 * successful deploy, which is easy to lose. Credentials come from the Catalyst
 * CLI's own login, so nothing extra needs configuring.
 */
import { accessTokenFromCli, readCatalystRc } from '../server/catalyst/cliCredentials.ts';
import { endpointsFor } from '../server/catalyst/dc.ts';

const project = readCatalystRc();
if (!project) {
  console.error('No .catalystrc here. Run: catalyst init --org <orgId> -p <projectId> -ni');
  process.exit(1);
}

const creds = await accessTokenFromCli();
if (!creds) {
  console.error('The Catalyst CLI is not logged in. Run: catalyst login');
  process.exit(1);
}

const { console: consoleUrl } = endpointsFor(creds.dataCentre);
const res = await fetch(`${consoleUrl}/baas/v1/project/${project.projectId}/appsail`, {
  headers: {
    Authorization: `Zoho-oauthtoken ${creds.accessToken}`,
    'CATALYST-ORG': project.orgId,
    Environment: process.env['CATALYST_ENVIRONMENT'] ?? 'Development',
  },
});

if (!res.ok) {
  console.error(`Could not list AppSail services: ${res.status} ${await res.text()}`);
  process.exit(1);
}

const services = (await res.json()).data ?? [];
if (!services.length) {
  console.log(`No AppSail services in ${project.projectName}. Deploy one with:`);
  console.log('  catalyst deploy appsail --name <service-name>');
  process.exit(0);
}

console.log(`${project.projectName} (${project.projectId}) — ${creds.dataCentre}\n`);
for (const s of services) {
  console.log(`  ${s.name}  [${s.stack}]  ${s.status ? 'running' : 'stopped'}`);
  console.log(`  ${s.url}\n`);
}
