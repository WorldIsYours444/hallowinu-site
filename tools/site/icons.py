import json,math
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

# ---- canonical game icons (one per Arcade game; see tools/site/site.json) ----
ICONS['bag']=[  # TRICK OR TREAT: jack-o'-lantern candy bucket
"...llllllll...",
"..l........l..",
"..l.kPkykGk.l.",
".kkkkkkkkkkkkk"[:14],
".kOOOOOOOOOOk.",
".kooooooooook.",
".kokkoooookkok"[:14],
".kooooooooook.",
".kokooooooook."[:14],
".kookkkkkkook.",
".koooookooook.",
"..kdoooooodk..",
"...kkkkkkkk...",
]
ICONS['bag'][3]=".kkkkkkkkkkkk."
ICONS['bag'][6]=".kokkooookkok."
ICONS['bag'][8]=".kokooooookok."
def _hunt():
    base=ICONS['pumpkin']; W=18; g=[['.']*W for _ in range(W)]
    for y,r in enumerate(base):
        for x,c in enumerate(r.ljust(14,'.')):
            if c!='.': g[y+2][x+2]=c
    cx=cy=8.5
    for y in range(W):
        for x in range(W):
            d=math.hypot(x+.5-cx-.5,y+.5-cy-.5)
            if 7.6<=d<=8.6: g[y][x]='r'
    for i in list(range(0,4))+list(range(14,18)):
        g[i][8]='r'; g[i][9]='r'; g[8][i]='r'; g[9][i]='r'
    return [''.join(r) for r in g]
ICONS['hunt']=_hunt()
def _wheel():
    W=15; c=7; g=[['.']*W for _ in range(W)]
    cols=['o','p','O','q','o','p','y','q']
    for y in range(W):
        for x in range(W):
            dx=x-c; dy=y-c; d=math.hypot(dx,dy)
            if d<=5.9:
                a=(math.atan2(dy,dx)+math.pi)/(2*math.pi); seg=int(a*8)%8
                g[y][x]=cols[seg]
                if d<=1.6: g[y][x]='Y'
            elif d<=7.1: g[y][x]='k'
    g[0][c]='w'; g[1][c]='w'; g[0][c-1]='w'; g[0][c+1]='w'
    return [''.join(r) for r in g]
ICONS['wheel']=_wheel()
ICONS['quiz']=[
".kkkkkkkkkkkk.",
"kPPPPPPPPPPPPk",
"kPpppwwwwpppPk",
"kPppwwppwwppPk",
"kPppppppwwppPk",
"kPpppppwwpppPk",
"kPppppwwppppPk",
"kPppppwwppppPk",
"kPppppppppppPk",
"kPppppwwppppPk",
"kqqqqqqqqqqqqk",
".kkkkqqkkkkkk.",
"....kqk.......",
"....kk........",
]

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
