#!/usr/bin/env python3
"""Seed the prototype's "Reading list" database (showcase 1539-1560) into a SCRATCH backend.
Called by seed.sh; reads the owner cookie from /tmp/hitlist-seed-jar.txt. Usage: seed_db.py <port>"""
import json, sys, urllib.request

port = sys.argv[1] if len(sys.argv) > 1 else '3002'
base = f'http://localhost:{port}/api'
cookie = ''
for line in open('/tmp/hitlist-seed-jar.txt'):
    if 'hitlist_owner_v1' in line:
        cookie = 'hitlist_owner_v1=' + line.split('\t')[-1].strip()

def call(method, path, body=None):
    req = urllib.request.Request(base + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={'Content-Type': 'application/json', 'Cookie': cookie})
    with urllib.request.urlopen(req) as r:
        raw = r.read()
        return json.loads(raw) if raw else None

books = call('POST', '/databases', {'name': 'Reading list', 'icon': '📚'})
call('POST', '/databases', {'name': 'Clients', 'icon': '🤝'})
call('POST', '/databases', {'name': 'Recipes', 'icon': '🍜'})
db = books['id']

def field(name, kind, options=None, show=False):
    return call('POST', '/fields', {'name': name, 'kind': kind, 'databaseId': db, 'showOnCard': show, **({'options': options} if options else {})})

status = field('Status', 'select', [{'label': 'To read', 'color': 'gray'}, {'label': 'Reading', 'color': 'blue'}, {'label': 'Finished', 'color': 'green'}, {'label': 'Abandoned', 'color': 'orange'}])
genre = field('Genre', 'multi', [{'label': 'Fiction', 'color': 'purple'}, {'label': 'Software', 'color': 'blue'}, {'label': 'Product', 'color': 'pink'}, {'label': 'Business', 'color': 'yellow'}], show=True)
rating = field('Rating', 'number')
finished = field('Finished', 'date')
read = field('Read', 'checkbox')
link = field('Link', 'text')
opt = lambda f, label: next(o['id'] for o in f['options'] if o['label'] == label)

rows = [
    ('Dune', 'Finished', ['Fiction'], 5, '2026-08-14', True, 'goodreads.com/dune'),
    ('The Pragmatic Programmer', 'Finished', ['Software'], 4, '2026-07-30', True, None),
    ('Shape Up', 'Reading', ['Software', 'Product'], None, None, False, 'basecamp.com/shapeup'),
    ('Thinking in Systems', 'To read', ['Business'], None, None, False, None),
    ('A Philosophy of Software Design', 'To read', ['Software'], None, None, False, None),
    ('Deep Work', 'Abandoned', ['Business'], 2, '2026-06-02', False, None),
]
for title, st, gs, rt, fin, rd, lk in rows:
    rec = call('POST', f'/databases/{db}/rows', {'title': title})
    put = lambda f, v: call('PUT', f'/databases/rows/{rec["id"]}/fields/{f["id"]}', {'value': v})
    put(status, opt(status, st))
    put(genre, [opt(genre, g) for g in gs])
    if rt is not None: put(rating, rt)
    if fin: put(finished, fin)
    put(read, rd)
    if lk: put(link, lk)
# Saved views the prototype's chip row shows: a board grouped by Status, and a filtered table.
base_filters = {'search': '', 'status': '', 'quadrant': '', 'category': '', 'due': '', 'dueAfter': '', 'dueBefore': '',
                'sortBy': 'order', 'sortDir': 'asc', 'fields': {}, 'groupBy': ''}
call('POST', '/views', {'name': 'By status board', 'layout': 'board', 'scopeListId': '', 'scopeDatabaseId': db,
                        'filters': {**base_filters, 'groupBy': status['id']}, 'showDone': False,
                        'display': {'hidden': [], 'order': [], 'widths': {}}})
call('POST', '/views', {'name': 'Needs revisit', 'layout': 'table', 'scopeListId': '', 'scopeDatabaseId': db,
                        'filters': {**base_filters, 'fields': {status['id']: [opt(status, 'To read'), opt(status, 'Abandoned')]}}, 'showDone': False,
                        'display': {'hidden': [], 'order': [], 'widths': {}}})
print(f'seeded database "Reading list" ({len(rows)} rows) plus Clients and Recipes')
