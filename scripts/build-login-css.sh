#!/usr/bin/env bash
# Builds public/catalyst-login.css = Catalyst's base sheet + our theme block.
#
# The theme source lives in styles/ rather than public/ so only the generated
# sheet is published — otherwise vite copies the fragment into dist/ too and we
# ship the same rules twice.
#
# The base sheet is Catalyst's, downloaded verbatim: it carries the rules that
# hide the inactive steps (OTP, MFA, captcha, recovery, field errors). Their
# docs say to style only after its last line, so we concatenate rather than
# replace. Re-run this if Catalyst updates the sheet.
set -euo pipefail

BASE_URL='https://api.catalyst.zoho.com/baas/v1/auth/static-file?file_name=embedded_signin.css'
OUT='public/catalyst-login.css'

{
  # @import must be the first rule in a stylesheet, so the web fonts are
  # declared above Catalyst's code. This adds a line; it alters nothing.
  echo "@import url('https://fonts.googleapis.com/css2?family=Caprasimo&family=Figtree:wght@400;500;600;700&display=swap');"
  echo
  curl -fsSL "$BASE_URL"
  echo
  cat styles/catalyst-login.append.css
} > "$OUT"

echo "wrote $OUT ($(wc -l < "$OUT") lines)"
