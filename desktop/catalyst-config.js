/**
 * Where HitList's Catalyst project lives. The hosted pages are Catalyst's own (Authentication → Hosted, enabled for
 * the Development environment with Zoho and Google sign-in); the desktop opens them in a window and then calls the
 * `backup` Function as the signed-in user. Moving to production means changing `ENV` and these hosts.
 */
const ENV = 'development';
const HOST = `hitlist-60090109165.${ENV}.catalystserverless.in`;

module.exports = {
  ENV,
  HOST,
  LOGIN_URL: `https://${HOST}/__catalyst/auth/login`,
  SIGNUP_URL: `https://${HOST}/__catalyst/auth/signup`,
  RESET_PASSWORD_URL: `https://${HOST}/__catalyst/auth/reset-password`,
  BACKUP_FUNCTION_URL: `https://${HOST}/server/backup`,
};
