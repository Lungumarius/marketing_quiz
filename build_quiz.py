#!/usr/bin/env python3
"""Build unified quiz app with upload feature, encryption, and JSONBin cloud storage."""
import json, hashlib, os, base64

# Load course data
with open('/Users/mariuslungu/Downloads/cursuri/grile/all_courses.json', 'r', encoding='utf-8') as f:
    marketing = json.load(f)
with open('/Users/mariuslungu/Downloads/cursuri/grile_campanii/all_courses.json', 'r', encoding='utf-8') as f:
    campanii = json.load(f)

# Normalize marketing correct to arrays
for c in marketing.values():
    for q in c['questions']:
        if isinstance(q['correct'], str):
            q['correct'] = [q['correct']]

mkt_json = json.dumps(marketing, ensure_ascii=False)
camp_json = json.dumps(campanii, ensure_ascii=False)

# Encrypted credentials (pre-computed)
PWD_HASH = "8e955fe8fb522ee81e7eee024339148d7bf602ea62c2db9e582c51d90da62bfc"
ENC_GEMINI = "1quth0GKmFkNNPYYD/7G+JETONpYNOyz6zFJ7SIKCWHXwOiw0S8eQdPo70sN5f5IgQgnqmVU5r6zDyPoLn4yWdbu3L3y"
ENC_JSONBIN = "Hl9Slfly9gyv0hBm4AaaPcbEyhjDLDLeZ2eSf7rSsTv+pkzDQoNud0Pu+tCkAR62gKzoE8pxW6wvbeJT2enoZMmvM7lWmGlTb8Xa/Q=="
BIN_ID = "6a38ef0bda38895dfeea24cc"

with open('/Users/mariuslungu/Downloads/cursuri/template.html', 'r', encoding='utf-8') as f:
    template = f.read()

html = template.replace('__MKT_JSON__', mkt_json)
html = html.replace('__CAMP_JSON__', camp_json)
html = html.replace('__PWD_HASH__', PWD_HASH)
html = html.replace('__ENC_GEMINI__', ENC_GEMINI)
html = html.replace('__ENC_JSONBIN__', ENC_JSONBIN)
html = html.replace('__BIN_ID__', BIN_ID)

with open('/Users/mariuslungu/Downloads/cursuri/index.html', 'w', encoding='utf-8') as f:
    f.write(html)

print(f'index.html built! Size: {len(html)} bytes')
