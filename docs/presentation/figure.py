"""Render the two recorded native cases; no estimated rates, timing axis or identity guarantee."""
import json,hashlib,html
from pathlib import Path
P=Path(__file__).parent
e=json.loads((P/'execution.json').read_text())
def render(mobile):
 w,h=(375,850) if mobile else (1100,560)
 s=[f'<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 {w} {h}" role="img" aria-labelledby="title desc"><title id="title">A passed receipt can still precede a withheld action</title><desc id="desc">In the changed-evidence fixture, Pause runs once and the Done receipt passes, but Next is withheld. The matched control runs both actions. These two synthetic cases do not establish target identity at dispatch.</desc><rect width="{w}" height="{h}" fill="#f5f4ef"/>']
 def text(x,y,t,size=16,color='#292d27',font='Arial, Helvetica, sans-serif'):
  s.append(f'<text x="{x}" y="{y}" fill="{color}" font-family="{font}" font-size="{size}">{html.escape(str(t))}</text>')
 def box(x,y,bw,bh,fill='#fff',stroke='#d9ddd0'):
  s.append(f'<rect x="{x}" y="{y}" width="{bw}" height="{bh}" rx="7" fill="{fill}" stroke="{stroke}"/>')
 pad=22 if mobile else 34
 text(pad,32,'REPLAYSMITH / CONTINUATION WITNESS',11,'#69725e')
 if mobile:
  text(pad,71,'A receipt passes.',28,font='Georgia, serif');text(pad,104,'The next action waits.',28,font='Georgia, serif')
 else:
  text(pad,84,'A receipt passes. The next action waits.',42,font='Georgia, serif')
 text(pad,137 if mobile else 119,'Two owned fixtures. Native results, not a success rate.',12 if mobile else 16)
 for i,kind in enumerate(['changed','matched']):
  n=e['cases'][kind]['native'];assert n['receipt']=='passed';assert n['effects']==({'first':1,'later':0} if i==0 else {'first':1,'later':1})
  y=(168+i*272) if mobile else (160+i*139)
  bw=w-pad*2;box(pad,y,bw,250 if mobile else 120)
  text(pad+16,y+27,'01 / CHANGED TARGET EVIDENCE' if i==0 else '02 / MATCHED CONTROL',11,'#aa431e' if i==0 else '#536347')
  if mobile:
   for j,(label,value) in enumerate([('Pause dispatched','first effect: 1'),('Done receipt','passed'),('Next action','withheld / effect: 0' if i==0 else 'dispatched / effect: 1')]):
    yy=y+61+j*49;text(pad+16,yy,label,16);text(pad+16,yy+20,value,13,'#aa431e' if i==0 and j==2 else '#5c6556','Courier New, Courier, monospace')
   text(pad+16,y+226,'ABSTAINED / verified: false' if i==0 else 'PASSED / verified: true',12)
  else:
   for j,(label,value) in enumerate([('Pause dispatched','first effect: 1'),('Done receipt','passed'),('Next action','withheld / effect: 0' if i==0 else 'dispatched / effect: 1')]):
    x=pad+16+j*290;text(x,y+61,label,18);text(x,y+86,value,14,'#aa431e' if i==0 and j==2 else '#5c6556','Courier New, Courier, monospace')
   text(w-pad-245,y+27,'ABSTAINED / false' if i==0 else 'PASSED / true',12)
 y=752 if mobile else 477
 for j,line in enumerate((['A later action is withheld, not rolled back.','The first effect already happened.','Outcome checks do not prove target identity.'] if mobile else ['A later action is withheld, not rolled back. The first effect already happened.','Outcome checks do not prove which target received an action.'])):text(pad,y+j*22,line,12 if mobile else 16)
 s.append('</svg>');return ''.join(s)
for name,m in [('continuation.svg',False),('continuation-mobile.svg',True)]:(P/name).write_text(render(m))
(P/'figure-manifest.json').write_text(json.dumps({'source':'execution.json','sourceSHA256':hashlib.sha256((P/'execution.json').read_bytes()).hexdigest(),'meaning':'Exact one-run native counters. Export cumulative counters remain separate. No spatial or time measurement axis.','figures':{name:hashlib.sha256((P/name).read_bytes()).hexdigest() for name in ['continuation.svg','continuation-mobile.svg']}},indent=2)+'\n')
