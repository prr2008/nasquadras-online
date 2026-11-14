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

srcs = sorted(set(re.findall(r'src="(/assets/[^"]+\.js)"', html)))
allc = ''
for s in srcs:
    try: allc += '\n' + get('https://www.fiba.basketball' + s)[1]
    except Exception as e: print('fail', s, e)

# Também os chunks carregados sob demanda (webpack): baixa a página de jogos e pega nomes de funções da API
names = sorted(set(re.findall(r'"(get[a-z]{4,60})(?:\?|")', allc)))
print('=== api names', names)
for needle in ['fibaCustomFetch(', 'gameDetails', 'unstableDetail', 'swr', 'getgdapgamebyid', 'Live']:
    for c in ctx(allc, needle, 200, 300, 2): print('###', needle, c, '\n---')
KEY = '898cd5e7389140028ecb42943c47eb74'
H = {'Ocp-Apim-Subscription-Key': KEY, 'Accept': 'application/json'}
def api(path):
    try:
        st, body = get('https://digital-api.fiba.basketball/hapi/' + path, H)
    except Exception as e:
        st, body = getattr(e, 'code', '?'), (e.read().decode('utf-8','replace') if hasattr(e,'read') else str(e))
    print('=== API', path, st, len(body)); print(body[:1500]); print('---')
    return body
b = api('getgdapgamesbycompetitionid?gdapCompetitionId=209059')
for n in ['getgdapgamebyid?gameId=131161', 'getgdapgamesbyid?gameId=131161', 'getgdapgamedetails?gameId=131161', 'getgdapgameboxscore?gameId=131161', 'getgdapgameplaybyplay?gameId=131161']:
    api(n)
