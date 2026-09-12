/**
 * Catalyst data-centre endpoints.
 *
 * Catalyst is partitioned by data centre and the hostnames differ per region.
 * Defaulting to the US endpoints silently fails for every other region with an
 * INVALID_TOKEN, which reads like a credential problem rather than a routing
 * one — this project is on `in`, and that cost a debugging detour.
 */
export type DataCentre = 'us' | 'eu' | 'in' | 'au' | 'ca' | 'jp' | 'sa';

interface Endpoints { console: string; accounts: string }

const ENDPOINTS: Record<DataCentre, Endpoints> = {
  us: { console: 'https://api.catalyst.zoho.com',      accounts: 'https://accounts.zoho.com' },
  eu: { console: 'https://api.catalyst.zoho.eu',       accounts: 'https://accounts.zoho.eu' },
  in: { console: 'https://api.catalyst.zoho.in',       accounts: 'https://accounts.zoho.in' },
  au: { console: 'https://api.catalyst.zoho.com.au',   accounts: 'https://accounts.zoho.com.au' },
  ca: { console: 'https://api.catalyst.zohocloud.ca',  accounts: 'https://accounts.zohocloud.ca' },
  jp: { console: 'https://api.catalyst.zoho.jp',       accounts: 'https://accounts.zoho.jp' },
  sa: { console: 'https://api.catalyst.zoho.sa',       accounts: 'https://accounts.zoho.sa' },
};

export function isDataCentre(v: string): v is DataCentre {
  return v in ENDPOINTS;
}

/** Explicit env overrides win, then the data centre, then US. */
export function endpointsFor(dc: string | undefined): Endpoints {
  const base = (dc && isDataCentre(dc)) ? ENDPOINTS[dc] : ENDPOINTS.us;
  return {
    console:  process.env['X_ZOHO_CATALYST_CONSOLE_URL']  ?? base.console,
    accounts: process.env['X_ZOHO_CATALYST_ACCOUNTS_URL'] ?? base.accounts,
  };
}
