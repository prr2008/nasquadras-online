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



for needle in ['joinGroup', 'negotiate', 'webpubsub', 'WebPubSubClient', 'getClientAccessUrl', 'clientAccessUrl', 'pubsub']:
    for c in ctx(allc, needle, 500, 700, 2): print('###', needle, c, '\n---')
KEY = '898cd5e7389140028ecb42943c47eb74'
H = {'Ocp-Apim-Subscription-Key': KEY, 'Accept': 'application/json'}
st, body = get('https://digital-api.fiba.basketball/hapi/getgdapgamesbycompetitionid?gdapCompetitionId=209059', H)
games = json.loads(body)
print('=== keys', sorted(games[0].keys()))
for g in games:
    if g['gameId'] >= 131152:
        print(g['gameId'], g['teamA']['code'], g['teamB']['code'], g['gameDateTimeUTC'], g['isLive'], g['teamAScore'], g['teamBScore'], g['currentPeriod'], g['chrono'], g['liveGameStatus'], g['currentPeriodStatus'])
