#!/bin/sh
# Turns the one-time code from api-console.zoho.in (Generate Code tab) into the long-lived refresh token the workflow needs.
# Run it in your own terminal right after creating the code (it is valid for 3-10 minutes). It asks for the values, hides the
# secret as you type, prints ONLY the refresh token, and leaves nothing in your shell history.
#   sh scripts/ci/workdrive-token.sh            (India data centre)
#   WORKDRIVE_DC=com sh scripts/ci/workdrive-token.sh   (com, eu, com.au or jp)
set -e
DC="${WORKDRIVE_DC:-in}"
printf 'Client ID: '; read -r CLIENT_ID
printf 'Client Secret (hidden): '; stty -echo; read -r CLIENT_SECRET; stty echo; echo
printf 'Code from the Generate Code tab: '; read -r CODE
ANSWER=$(curl -s -X POST "https://accounts.zoho.${DC}/oauth/v2/token" \
  --data-urlencode "grant_type=authorization_code" \
  --data-urlencode "client_id=${CLIENT_ID}" \
  --data-urlencode "client_secret=${CLIENT_SECRET}" \
  --data-urlencode "code=${CODE}")
TOKEN=$(printf '%s' "$ANSWER" | sed -n 's/.*"refresh_token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
if [ -z "$TOKEN" ]; then
  echo "No refresh token came back. Zoho said:" >&2
  printf '%s' "$ANSWER" | sed 's/"access_token"[^,}]*,\{0,1\}//' >&2; echo >&2
  echo "If it says invalid_code, the code expired or was already used: generate a new one and run this again straight away." >&2
  exit 1
fi
echo
echo "WORKDRIVE_REFRESH_TOKEN (copy this into the GitHub secret):"
echo "$TOKEN"
