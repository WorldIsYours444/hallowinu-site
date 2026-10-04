import json
P={'k':'#1b0b12','o':'#ff7a1a','O':'#ffb23e','d':'#c4470a','g':'#5fbf3a','y':'#ffd75e','Y':'#fff1a8','D':'#c98a12',
   'w':'#f6efff','l':'#c7b3ff','e':'#1a0a24','b':'#7a3d1c','B':'#b0642c','p':'#a43bff','P':'#dca0ff','q':'#6a1fb5','r':'#ff4d6d','G':'#47ff8f','m':'#2a8f52'}
ICONS={
'pumpkin':["......gg......",".....gg.......","...kkkgkkkk...","..kooOooOook..",".kooOooooOook.",".koyyooooyyok.","kooyyooooyyook","koooooooooooook"[:14],"koyooyyyyooyok","kooyyyyyyyyook",".kooyyooyyook.",".kdoooooooodk.","..kddooooddk..","...kkkkkkkk..."],
'ghost':["....kkkkkk....","...kwwwwwwk...","..kwwwwwwwwk..",".kwwwwwwwwwwk.",".kwweewweewwk.",".kwweewweewwk.",".kwwwwwwwwwwk.",".kwwwwkkwwwwk.",".kwwwwkkwwwlk.",".kwwwwwwwwwlk.",".kwwwwwwwwwlk.",".kwwlwwwlwwlk.",".kwkwwkwwkwwk.",".kk.kk.kk.kkk."],
'chest':["..............","..kkkkkkkkkk..",".kBBBBBBBBBBk.","kBbbbbbbbbbbBk","kbbbbbbbbbbbbk","kyyyyyyyyyyyyk","kbbbbbkkbbbbbk","kBbbbkyykbbbBk","kbbbbkyYkbbbbk","kbbbbbkkbbbbbk","kbbbbbbbbbbbbk","kyyyyyyyyyyyyk","kkkkkkkkkkkkkk",".............."],
'trophy':["..kkkkkkkkkk..","kkkYYyyyyyykkk","kykYyyyyyyykyk","kykYyyyyyyykyk",".kkyyyyyyyykk.","..kyyyyyyyDk..","...kyyyyyDk...","....kkyykk....",".....kyyk.....",".....kyDk.....","....kkyykk....","...kyyyyDDk...","...kkkkkkkk...",".............."],
'crown':["..............","..k....kk....k"[:14],".kyk..kyyk..kyk"[:14],".kyyk.kyyk.kyyk"[:14],".kyyykyyyykyyk"[:14],".kyyyyyyyyyyk.",".kyyyypPyyyyk.",".kyyyyqpyyyyk.",".kyYyyyyyyyyk.",".kDDDDDDDDDDk.",".kkkkkkkkkkkk."],
'candy':["..............","k...........k.","kk..kkkkk..kk.","kpk.kPPpPk.kpk","kppkPpwpPpkppk","kpppPwpPpPpppk","kppkpPpwpPkppk","kpk.kpPpPk.kpk","kk..kkkkk..kk.","k...........k."],
'skull':["...kkkkkkk....","..kwwwwwwwk...",".kwwwwwwwwwk..",".kweekwkeewk..",".kweekwkeewk..",".kwwwwkwwwwk..","..kwwkkkwwk...","...kwkwkwk....","...kkkkkkk...."],
'moon':["....kkkk....","..kkOOookk..",".kOOoooodok.",".kOoodooook.","kOoooooodook","koodoooooook","kooooooodoook"[:12],"kodoooooooook"[:12],".koooooodok.",".koodooooook"[:12],"..kkookkk...","....kkkk...."],
'rocket':[".....kk.....","....kwwk....","...kwPPwk...","...kwPPwk...","...kwwwwk...","..kkwwwwkk..",".kpkwwwwkpk.",".kpkkwwkkpk.","..k.kOOk.k..","....kooy....",".....ky.....",".....k......"],
'bars':["..........GG","..........GG","......GG..GG","......GG..GG","..GG..GG..GG","..GG..GG..GG","GGGG..GG..GG","GGGGGGGGGGGG"],
}
def svg(rows,size=None):
    w=max(len(r) for r in rows); h=len(rows)
    out=[]
    for y,r in enumerate(rows):
        r=r.ljust(w,'.')
        x=0
        while x<w:
            c=r[x]
            if c=='.': x+=1; continue
            x2=x
            while x2<w and r[x2]==c: x2+=1
            out.append(f'<rect x="{x}" y="{y}" width="{x2-x}" height="1" fill="{P[c]}"/>')
            x=x2
    return f'<svg class="px-icon" viewBox="0 0 {w} {h}" shape-rendering="crispEdges" aria-hidden="true" focusable="false">'+''.join(out)+'</svg>'
res={k:svg(v) for k,v in ICONS.items()}
json.dump(res,open('tools/site/icons.json','w'))
for k,v in res.items(): print(k,len(v))
