#!/bin/sh
# Seed a SCRATCH backend (never the desktop app's real DB) so shoot.mjs has
# something to photograph. Writes the owner cookie to /tmp/hitlist-seed-jar.txt,
# which shoot.mjs reads. Usage: tools/seed.sh [port]   (default 3002)
# Start the backend first — see 00-INDEX.md "Getting a populated app to shoot".
PORT=${1:-3002}; B=http://localhost:$PORT/api; J=/tmp/hitlist-seed-jar.txt
rm -f $J
curl -s -c $J -b $J $B/health >/dev/null || { echo "no backend on :$PORT"; exit 1; }
post() { curl -s -c $J -b $J -X POST "$B$1" -H 'Content-Type: application/json' -d "$2"; }
put()  { curl -s -c $J -b $J -X PUT  "$B$1" -H 'Content-Type: application/json' -d "$2" >/dev/null; }
id()   { grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4; }
d() { date -v${1} +%Y-%m-%d; }

STAGE=$(post /fields '{"name":"Stage","kind":"select","options":[{"label":"Backlog","color":"sage"},{"label":"In progress","color":"sky"},{"label":"In review","color":"sand"},{"label":"Shipped","color":"rose"}]}')
FID=$(echo "$STAGE" | id)
OPT() { echo "$STAGE" | sed -E 's/\},\{/}\n{/g' | grep "\"label\":\"$1\"" | grep -o '"id":"[^"]*"' | tail -1 | cut -d'"' -f4; }
BACKLOG=$(OPT Backlog); PROG=$(OPT 'In progress'); REVIEW=$(OPT 'In review')

add() { # title quadrant due category stageOptionId
  T=$(post /tasks "{\"title\":\"$1\",\"quadrant\":\"$2\",\"dueDate\":${3:-null},\"category\":\"$4\"}" | id)
  [ -n "$5" ] && put "/tasks/$T/fields/$FID" "{\"value\":\"$5\"}"
}
add "Prepare Q4 roadmap review"            do        "\"$(d +0d)\"" Planning "$PROG"
add "Reply to legal about vendor contract" do        "\"$(d -2d)\"" Legal    "$BACKLOG"
add "Fix export failing on empty datasets" do        "\"$(d +1d)\"" Bug      "$BACKLOG"
add "Draft onboarding checklist"           schedule  "\"$(d +3d)\"" Docs     "$REVIEW"
add "Plan team offsite agenda"             schedule  "\"$(d +9d)\"" Planning "$BACKLOG"
add "Approve expense reports"              delegate  "\"$(d +0d)\"" Admin    "$BACKLOG"
add "Schedule vendor demo calls"           delegate  "\"$(d +1d)\"" Vendors  "$PROG"
add "Clear old email newsletters"          eliminate null           Admin    ""
echo "seeded field $FID and 8 tasks on :$PORT"
