import re, json, time, urllib.request
UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
def get(url, headers=None):
    req = urllib.request.Request(url, headers={'User-Agent': UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, dict(r.headers), r.read().decode('utf-8', 'replace')
def rsc(html):
    parts = re.findall(r'self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)', html)
    return ''.join(json.loads('"' + p + '"') for p in parts)
dec = json.JSONDecoder()
def obj_after(text, key):
    i = text.find('"' + key + '":')
    if i < 0: return None
    j = text.index(':', i) + 1
    try: return dec.raw_decode(text[j:])[0]
    except Exception as e: return 'ERR ' + str(e)
def shape(o, depth=0, maxd=3):
    if depth > maxd: return '…'
    if isinstance(o, dict): return {k: shape(v, depth+1, maxd) for k, v in list(o.items())[:60]}
    if isinstance(o, list): return [shape(o[0], depth+1, maxd), f'len={len(o)}'] if o else []
    return o if not isinstance(o, str) or len(o) < 60 else o[:60]
url = 'https://www.fiba.basketball/en/events/liga-sudamericana-de-baloncesto-fiba-2026/games/131159-FLA-BRA'
for round_ in range(2):
    st, hd, html = get(url + ('?t=%d' % time.time()))
    print('=== round', round_, st, {k: v for k, v in hd.items() if k.lower() in ('cache-control', 'age', 'x-cache', 'cf-cache-status', 'x-nextjs-cache', 'date')})
    data = rsc(html)
    gd = obj_after(data, 'gameDetails')
    if isinstance(gd, dict):
        print('CurrentPeriod', gd.get('CurrentPeriod'), 'RC', gd.get('RC'), 'status', gd.get('status'), 'CPS', gd.get('CurrentPeriodStatus'))
        if round_ == 0:
            print('KEYS', list(gd.keys()))
            print(json.dumps(shape(gd, 0, 3), ensure_ascii=False)[:6000])
    else:
        print('gameDetails:', str(gd)[:300])
    for k in ['playByPlay', 'game', 'playersTeamA', 'quartersScores', 'uiStatus']:
        o = obj_after(data, k)
        print('###', k, json.dumps(shape(o, 0, 2), ensure_ascii=False)[:2500] if not isinstance(o, str) else o[:200])
    time.sleep(25)
