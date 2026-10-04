import json,re,random
d=json.load(open('tools/site/icons.json'))
V='42'
symbols=''
for k,v in d.items():
    inner=re.sub(r'^<svg[^>]*>|</svg>$','',v)
    vb=re.search(r'viewBox="([^"]+)"',v).group(1)
    symbols+=f'<symbol id="i-{k}" viewBox="{vb}">{inner}</symbol>'
def icon(name): return f'<svg class="px-icon" shape-rendering="crispEdges" aria-hidden="true" focusable="false"><use href="#i-{name}"/></svg>'
TG='<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M21.9 4.3 18.7 19.4c-.2 1.1-.9 1.3-1.8.8l-4.9-3.6-2.4 2.3c-.3.3-.5.5-1 .5l.3-5 9.2-8.3c.4-.4-.1-.6-.6-.2L6.1 13 1.2 11.5c-1.1-.3-1.1-1.1.2-1.6L20.6 2.5c.9-.3 1.7.2 1.3 1.8Z"/></svg>'
X='<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M17.8 2.5h3.3l-7.2 8.2 8.5 10.8h-6.6l-5.2-6.8-6 6.8H1.3l7.7-8.8L.9 2.5h6.8l4.7 6.2 5.4-6.2Zm-1.2 17.1h1.8L6.6 4.3H4.6l12 15.3Z"/></svg>'
def spark(seed,trend):
    r=random.Random(seed); pts=[]; y=36; cand=''
    for i in range(20):
        x=4+i*10
        o=y; y=max(4,min(40,y+r.uniform(-5,4)-trend))
        hi=min(o,y)-r.uniform(1,4); lo=max(o,y)+r.uniform(1,4)
        cls='candle' if y<=o else 'candle r'
        cand+=f'<rect class="{cls}" x="{x-2}" y="{min(o,y):.1f}" width="4" height="{max(1.5,abs(o-y)):.1f}"/><rect class="{cls}" x="{x-.5}" y="{hi:.1f}" width="1" height="{lo-hi:.1f}"/>'
        pts.append(f'{x},{y:.1f}')
    return f'<svg class="dc-chart" viewBox="0 0 200 44" preserveAspectRatio="none" aria-hidden="true"><g opacity=".55">{cand}</g><polyline class="line" style="--len:260" points="{" ".join(pts)}"/></svg>'
t=open('tools/site/index.template.html').read()
t=t.replace('{{symbols}}',symbols).replace('{{tg}}',TG).replace('{{x}}',X).replace('{{v}}',V)
t=t.replace('{{spark1}}',spark(3,1.1)).replace('{{spark2}}',spark(7,1.4)).replace('{{spark3}}',spark(11,1.7))
t=re.sub(r'\{\{icon:(\w+)\}\}',lambda m:icon(m.group(1)),t)
assert '{{' not in t, re.findall(r'\{\{[^}]+\}\}',t)
open('dist/index.html','w').write(t)
print(len(t))
