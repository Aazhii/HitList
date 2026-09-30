#!/bin/sh
# Proves the `longtext` field kind end to end against a running backend.
#
#   sh tools/probe-longtext.sh <port>
#
# What it must show:
#   1. a longtext field can be created and holds a paragraph (> the 2000 text cap)
#   2. switching longtext -> text KEEPS the value (they are interchangeable)
#   3. switching longtext -> number CLOAKS it (the normal type-change behaviour)
#   4. switching back to longtext restores it, untouched
set -e
PORT="${1:?usage: probe-longtext.sh <port>}"
BASE="http://localhost:$PORT/api"
JAR=$(mktemp)
C() { curl -s -c "$JAR" -b "$JAR" -H 'Content-Type: application/json' -H "Origin: http://localhost:$PORT" "$@"; }
id() { sed -n 's/.*"id":"\([^"]*\)".*/\1/p'; }

DB=$(C -X POST "$BASE/databases" -d '{"name":"Longtext probe"}' | id)
FIELD=$(C -X POST "$BASE/fields" -d "{\"name\":\"Review\",\"kind\":\"longtext\",\"databaseId\":\"$DB\"}" | id)
ROW=$(C -X POST "$BASE/databases/$DB/rows" -d '{"title":"Dune"}' | id)

PARA='Paul Atreides is sent to Arrakis, and the book spends four hundred pages on water, politics and prophecy before anyone rides a worm. It is a paragraph, which is the point: this text has to wrap.'
C -X PUT "$BASE/databases/rows/$ROW/fields/$FIELD" -d "{\"value\":$(printf '%s' "$PARA" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')}" > /dev/null

read_value() { C "$BASE/databases/$DB/field-values" | python3 -c "
import json,sys
rows = json.load(sys.stdin)
v = next((r['value'] for r in rows if r['fieldId'] == '$FIELD'), None)
print('null' if v is None else ('len=%d' % len(v)) if isinstance(v, str) else repr(v))
"; }

set_kind() { C -X PUT "$BASE/fields/$1" -d "{\"name\":\"Review\",\"kind\":\"$2\"}" > /dev/null; }

echo "1. stored as longtext            -> $(read_value)"
set_kind "$FIELD" text
echo "2. after longtext -> text        -> $(read_value)   (expect the same length: interchangeable)"
set_kind "$FIELD" number
echo "3. after text -> number          -> $(read_value)   (expect null: cloaked, not deleted)"
set_kind "$FIELD" longtext
echo "4. after number -> longtext      -> $(read_value)   (expect the original length again)"

C -X POST "$BASE/databases/$DB/delete" -d '{}' > /dev/null 2>&1 || true
rm -f "$JAR"
