"""public/assets/icons/*.svg (+ public/assets/decor/*.svg) を @react-pdf/renderer の Svg/Path 部品で
描くためのデータ (lib/voucher-icons.generated.ts) に変換する。ベクターのまま PDF に埋め込むための変換で、
ラスター化はしない。SVG 側が単一の管理元。実行: python3 scripts/build-voucher-icon-data.py
対応要素: path / rect / circle / ellipse / line / g(transform)。title / defs は捨てる。<style> の .class { fill } は fill 属性に展開する
(WhatsApp 公式グリフが class 指定のため)。
g の transform (translate / scale / rotate) は座標に畳み込んで出力する: react-pdf は G の transform 文字列を
レイアウト経路によっては配列に変換せず "operations.forEach is not a function" で落ちるため (2026-09-24 実測)。
"""
import math
import json, re, sys
from pathlib import Path
import xml.etree.ElementTree as ET
ROOT=Path(__file__).resolve().parents[1]
SRC=[ROOT/'public/assets/icons', ROOT/'public/assets/decor', ROOT/'public/assets/brand']
OUT=ROOT/'lib/voucher-icons.generated.ts'
NS='{http://www.w3.org/2000/svg}'
ATTRS={'fill':'fill','stroke':'stroke','stroke-width':'strokeWidth','stroke-linecap':'strokeLinecap','stroke-linejoin':'strokeLinejoin','stroke-dasharray':'strokeDasharray','fill-rule':'fillRule','transform':'transform','opacity':'opacity'}

# ---- transform の畳み込み ----
def parse_transform(t):
    """'translate(4 23) scale(.72) rotate(-9 30 28)' → 3x3 行列 (適用順は左から)"""
    M=[[1,0,0],[0,1,0],[0,0,1]]
    def mul(A,B): return [[sum(A[i][k]*B[k][j] for k in range(3)) for j in range(3)] for i in range(3)]
    for name,args in re.findall(r'(\w+)\(([^)]*)\)',t):
        v=[float(x) for x in re.split(r'[ ,]+',args.strip()) if x]
        if name=='translate': T=[[1,0,v[0]],[0,1,v[1] if len(v)>1 else 0],[0,0,1]]
        elif name=='scale': sx=v[0]; sy=v[1] if len(v)>1 else sx; T=[[sx,0,0],[0,sy,0],[0,0,1]]
        elif name=='rotate':
            a=math.radians(v[0]); c,si=math.cos(a),math.sin(a); R=[[c,-si,0],[si,c,0],[0,0,1]]
            if len(v)==3:
                cx,cy=v[1],v[2]; T=mul(mul([[1,0,cx],[0,1,cy],[0,0,1]],R),[[1,0,-cx],[0,1,-cy],[0,0,1]])
            else: T=R
        else: raise SystemExit('unsupported transform '+name)
        M=mul(M,T)
    return M
IDENT=[[1,0,0],[0,1,0],[0,0,1]]
def is_ident(M): return all(abs(M[i][j]-IDENT[i][j])<1e-12 for i in range(3) for j in range(3))
def apply_pt(M,x,y): return (M[0][0]*x+M[0][1]*y+M[0][2], M[1][0]*x+M[1][1]*y+M[1][2])
def uniform_scale(M): return math.hypot(M[0][0],M[1][0])
def fmt(v): return f'{v:.3f}'.rstrip('0').rstrip('.')
def transform_path(d,M):
    """絶対/相対コマンドを絶対座標に直しつつ変換。H/V は L に、A は半径をスケールし回転角を加える。"""
    toks=re.findall(r'[MmLlHhVvCcSsQqTtAaZz]|-?\d*\.?\d+(?:e-?\d+)?',d)
    out=[]; i=0; cx=cy=0.0; sx=sy=0.0; cmd=None
    ang=math.degrees(math.atan2(M[1][0],M[0][0])); sc=uniform_scale(M)
    def emit(c,pts):
        out.append(c+' '.join(fmt(p) for p in pts))
    while i<len(toks):
        t=toks[i]
        if re.match(r'[A-Za-z]',t): cmd=t; i+=1
        rel=cmd.islower(); C=cmd.upper()
        if C=='Z': emit('Z',[]); cx,cy=sx,sy; continue
        def nums(n):
            nonlocal i
            v=[float(x) for x in toks[i:i+n]]; i+=n; return v
        if C in ('M','L','T'):
            x,y=nums(2)
            if rel: x+=cx; y+=cy
            X,Y=apply_pt(M,x,y); emit(C,[X,Y]); cx,cy=x,y
            if C=='M': sx,sy=x,y; cmd='l' if rel else 'L'
        elif C=='H':
            (x,)=nums(1); x=x+cx if rel else x
            X,Y=apply_pt(M,x,cy); emit('L',[X,Y]); cx=x
        elif C=='V':
            (y,)=nums(1); y=y+cy if rel else y
            X,Y=apply_pt(M,cx,y); emit('L',[X,Y]); cy=y
        elif C in ('C','S','Q'):
            n={'C':6,'S':4,'Q':4}[C]; v=nums(n)
            pts=[]
            for k in range(0,n,2):
                x,y=v[k],v[k+1]
                if rel: x+=cx; y+=cy
                pts.append((x,y))
            emit(C,[c for pt in pts for c in apply_pt(M,*pt)]); cx,cy=pts[-1]
        elif C=='A':
            rx,ry,rot,laf,sf,x,y=nums(7)
            if rel: x+=cx; y+=cy
            X,Y=apply_pt(M,x,y)
            # 鏡映は想定外 (行列式 > 0 前提)
            emit('A',[rx*sc,ry*sc,rot+ang,laf,sf,X,Y]); cx,cy=x,y
        else: raise SystemExit('bad path cmd '+cmd)
    return ' '.join(out)
def rect_to_path(x,y,w,h,rx):
    if rx<=0: return f'M{x} {y}H{x+w}V{y+h}H{x}Z'
    r=min(rx,w/2,h/2)
    return (f'M{x+r} {y}H{x+w-r}A{r} {r} 0 0 1 {x+w} {y+r}V{y+h-r}A{r} {r} 0 0 1 {x+w-r} {y+h}'
            f'H{x+r}A{r} {r} 0 0 1 {x} {y+h-r}V{y+r}A{r} {r} 0 0 1 {x+r} {y}Z')

def conv(el,inherited,M=IDENT):
    tag=el.tag.replace(NS,'')
    if tag in ('title','defs','style'): return None
    style=dict(inherited)
    for cls in el.attrib.get('class','').split():
        style.update(CLASS_STYLES.get(cls,{}))
    for k,v in el.attrib.items():
        if k in ATTRS: style[ATTRS[k]]=v
    node={'t':tag}
    g=lambda k,d=0.0: float(el.attrib.get(k,d))
    if tag=='path': node['d']=el.attrib['d'] if is_ident(M) else transform_path(el.attrib['d'],M)
    elif tag=='rect':
        if is_ident(M):
            for k in ['x','y','width','height','rx','ry']:
                if k in el.attrib: node[k]=float(el.attrib[k])
        else:  # 変換下の rect はパスに変換 (回転に対応)
            node={'t':'path','d':transform_path(rect_to_path(g('x'),g('y'),g('width'),g('height'),g('rx')),M)}
    elif tag=='circle':
        cx,cy=apply_pt(M,g('cx'),g('cy')); node['cx'],node['cy'],node['r']=cx,cy,g('r')*uniform_scale(M)
    elif tag=='ellipse':
        cx,cy=apply_pt(M,g('cx'),g('cy')); sc=uniform_scale(M); node.update({'cx':cx,'cy':cy,'rx':g('rx')*sc,'ry':g('ry')*sc})
    elif tag=='line':
        x1,y1=apply_pt(M,g('x1'),g('y1')); x2,y2=apply_pt(M,g('x2'),g('y2')); node.update({'x1':x1,'y1':y1,'x2':x2,'y2':y2})
    elif tag=='g':
        M2=M
        if 'transform' in el.attrib:
            T=parse_transform(el.attrib['transform'])
            M2=[[sum(M[i][k]*T[k][j] for k in range(3)) for j in range(3)] for i in range(3)]
        style.pop('transform',None)
        node['c']=[c for c in (conv(ch,style,M2) for ch in el) if c]
    else:
        raise SystemExit(f'unsupported element <{tag}> in {el}')
    # stroke-width も一様スケールに追従させる
    if not is_ident(M) and 'strokeWidth' in style:
        style['strokeWidth']=fmt(float(style['strokeWidth'])*uniform_scale(M))
    # 継承した描画属性を各要素に明示 (react-pdf は Svg ルートからの継承が不完全なため)
    for k in ['fill','stroke','strokeWidth','strokeLinecap','strokeLinejoin','strokeDasharray','fillRule','opacity']:
        if k in style: node[k]=style[k]
    return node
CLASS_STYLES={}
icons={}
for d in SRC:
    for f in sorted(d.glob('*.svg')):
        root=ET.parse(f).getroot()
        CLASS_STYLES.clear()
        for st in root.iter(NS+'style'):
            for cls,body in re.findall(r'\.([\w-]+)\s*\{([^}]*)\}',st.text or ''):
                CLASS_STYLES[cls]={ATTRS[k.strip()]:v.strip() for k,v in (d.split(':',1) for d in body.split(';') if ':' in d) if k.strip() in ATTRS}
        vb=[float(v) for v in root.attrib['viewBox'].split()]
        inherited={ATTRS[k]:v for k,v in root.attrib.items() if k in ATTRS}
        kids=[c for c in (conv(ch,inherited) for ch in root) if c]
        icons[f.stem]={'viewBox':vb,'nodes':kids}
ts='// 自動生成: scripts/build-voucher-icon-data.py が public/assets/icons/*.svg と public/assets/decor/*.svg から生成。手編集しない。\n'
ts+='export type IconNode = { t: "path" | "rect" | "circle" | "ellipse" | "line" | "g"; d?: string; x?: number; y?: number; width?: number; height?: number; rx?: number; ry?: number; cx?: number; cy?: number; r?: number; x1?: number; y1?: number; x2?: number; y2?: number; c?: IconNode[]; fill?: string; stroke?: string; strokeWidth?: string; strokeLinecap?: string; strokeLinejoin?: string; strokeDasharray?: string; fillRule?: string; opacity?: string; transform?: string }\n'
ts+='export type IconDef = { viewBox: number[]; nodes: IconNode[] }\n'
ts+='export const VOUCHER_ICONS = '+json.dumps(icons,ensure_ascii=False,separators=(',',':'))+' as const satisfies Record<string, IconDef>\n'
ts+='export type VoucherIconName = keyof typeof VOUCHER_ICONS\n'
OUT.write_text(ts); print('icons:',len(icons),'->',OUT.relative_to(ROOT), f'{OUT.stat().st_size//1024} KB')
