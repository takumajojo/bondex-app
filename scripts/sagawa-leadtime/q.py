import re,html,sys,time,urllib.request,urllib.parse,http.cookiejar,json
URL="https://www2.sagawa-exp.co.jp/send/days/result/"
op=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
def q(a,b):
    d=urllib.parse.urlencode({"type":"ZipCodeSearch","zip_from":a,"zip_to":b}).encode()
    r=op.open(urllib.request.Request(URL,d,{"User-Agent":"Mozilla/5.0 BondEx-leadtime-check (support@bondex.express)"}),timeout=30)
    t=r.read().decode("utf-8","ignore")
    t=re.sub(r'<!--.*?-->','',t,flags=re.S)
    eig=re.findall(r'担当営業所：\s*(?:<[^>]+>\s*)*([^<\s]+営業所|[^<\s]+店|[^<\s]+センター)',t)
    days=re.search(r'発送日\+\s*(?:<[^>]+>\s*)*([0-9０-９]+)\s*(?:<[^>]+>\s*)*日',t)
    s=re.sub(r'<[^>]+>',' ',t); s=html.unescape(s)
    err=None
    if not days:
        m=re.search(r'(該当[^。]*。|見つかりません[^。]*。|エラー[^。]*。)',s); err=m.group(1) if m else 'parse_fail'
    return {"from":a,"to":b,"from_office":eig[0] if len(eig)>0 else None,"to_office":eig[1] if len(eig)>1 else None,"days":int(days.group(1)) if days else None,"err":err}
if __name__=="__main__":
    for pair in sys.argv[1:]:
        a,b=pair.split(":"); print(json.dumps(q(a,b),ensure_ascii=False)); time.sleep(2)
