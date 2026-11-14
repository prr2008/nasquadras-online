import re, json, urllib.request
UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
def get(url, headers=None):
    req = urllib.request.Request(url, headers={'User-Agent': UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode('utf-8', 'replace')
def ctx(text, needle, before=300, after=300, n=3):
    out, i = [], 0
    while len(out) < n:
        j = text.find(needle, i)
        if j < 0: break
        out.append(text[max(0, j-before): j+len(needle)+after]); i = j + 1
    return out
html = get('https://www.fiba.basketball/en/events/liga-sudamericana-de-baloncesto-fiba-2026/games/131159-FLA-BRA')
srcs = sorted(set(re.findall(r'src="(/assets/[^"]+\.js)"', html)))
base = srcs[0].split('/_next/')[0]
allc = ''
for s in srcs: allc += '\n' + get('https://www.fiba.basketball' + s)
# webpack runtime: mapa de chunks dinâmicos
wp = [s for s in srcs if 'webpack-' in s][0]
wpc = get('https://www.fiba.basketball' + wp)
m = re.search(r'"static/chunks/"\+\(?\(?\{([^}]*)\}\[e\]\|\|e\)\+"\."\+\{([^}]*)\}', wpc)
dyn = []
if m:
    names = dict(re.findall(r'(\d+):"([^"]+)"', m.group(1)))
    hashes = re.findall(r'(\d+):"([0-9a-f]+)"', m.group(2))
    for cid, h in hashes:
        dyn.append(f"{base}/_next/static/chunks/{names.get(cid, cid)}.{h}.js")
print('dynamic chunks', len(dyn))
for u in dyn:
    try: allc += '\n' + get('https://www.fiba.basketball' + u)
    except Exception as e: pass
print('total size', len(allc))

i = allc.find('65435:(e,t,a)=>{a.r(t),a.d(t,{WsClientProvider')
print('=== module 65435'); print(allc[i:i+9000])
j = allc.find('"/en/events/api/')
print('=== other api routes', sorted(set(re.findall(r'"(/(?:en/)?(?:events/)?api/[a-zA-Z0-9/_-]+)', allc))))
