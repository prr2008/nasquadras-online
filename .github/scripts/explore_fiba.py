import json, time, urllib.request, os
UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
os.makedirs('out', exist_ok=True)
def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/json'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, dict(r.headers), r.read()
for gid, tag in [(131159, 'live'), (131161, 'final'), (131158, 'scheduled')]:
    for kind in ['detail', 'light']:
        try:
            st, hd, body = get(f'https://www.fiba.basketball/en/events/api/game-live-info/{gid}/{kind}')
            open(f'out/{tag}_{kind}.json', 'wb').write(body)
            print(gid, kind, st, len(body), hd.get('Cache-Control'), hd.get('Content-Type'))
            d = json.loads(body)
            print('  keys', list(d.keys()) if isinstance(d, dict) else type(d))
            for k, v in (d.items() if isinstance(d, dict) else []):
                print('   ', k, type(v).__name__, (list(v.keys())[:10] if isinstance(v, dict) else str(v)[:100]))
                if isinstance(v, dict) and 'content' in v:
                    c = v['content']; print('      content', type(c).__name__, (list(c.keys())[:40] if isinstance(c, dict) else str(c)[:120]))
        except Exception as e:
            print(gid, kind, 'ERR', e)
time.sleep(20)
st, hd, body = get('https://www.fiba.basketball/en/events/api/game-live-info/131159/detail')
open('out/live_detail_2.json', 'wb').write(body)
d = json.loads(body); g = d.get('game', {}).get('content', {})
print('second', g.get('CurrentPeriod'), g.get('RC'), g.get('status'))
import gzip, base64
for name in ['live_detail_2.json', 'final_detail.json', 'live_light.json']:
    b64 = base64.b64encode(gzip.compress(open('out/' + name, 'rb').read())).decode()
    print('BEGIN', name)
    for i in range(0, len(b64), 3000): print('B64', b64[i:i+3000])
    print('END', name)
