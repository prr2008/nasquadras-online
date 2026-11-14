import re, sys, json, urllib.request, os
UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
def get(url, headers=None):
    req = urllib.request.Request(url, headers={'User-Agent': UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, r.read().decode('utf-8', 'replace')
def ctx(text, needle, before=300, after=300, n=3):
    out, i = [], 0
    while len(out) < n:
        j = text.find(needle, i)
        if j < 0: break
        out.append(text[max(0, j-before): j+len(needle)+after]); i = j + 1
    return out
_, html = get('https://www.fiba.basketball/en/events/liga-sudamericana-de-baloncesto-fiba-2026/games/131161-PAI-FLA')
print('=== gateway in html'); [print(c, '\n---') for c in ctx(html, 'getcustomgateway', 400, 400, 2)]
print('=== CurrentPeriod in html'); [print(c, '\n---') for c in ctx(html, 'CurrentPeriod', 2500, 800, 1)]
srcs = sorted(set(re.findall(r'src="(/assets/[^"]+\.js)"', html)))
chunks = {}
for s in srcs:
    try: chunks[s] = get('https://www.fiba.basketball' + s)[1]
    except Exception as e: print('fail', s, e)
allc = '\n'.join(chunks.values())
print('=== chunk urls')
from collections import Counter
for u, c in Counter(re.findall(r'https://[a-zA-Z0-9.-]*(?:api|cache|livestats|genius|sportresult)[a-zA-Z0-9./_-]*', allc)).most_common(40): print(c, u)
for needle in ['Ocp-Apim', 'getcustomgateway', 'livecache', 'GAMEACTIONS', 'refetchInterval', 'hapi/']:
    print('=== chunk ctx', needle)
    for c in ctx(allc, needle, 250, 250, 4): print(c, '\n---')
