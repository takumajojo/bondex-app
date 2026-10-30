# usage: python3 crawl.py pairs.jsonl out.jsonl  (pairs: {"from":..,"to":..} per line). Resumable.
import sys,json,time,os
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from q import q
pairs=[json.loads(l) for l in open(sys.argv[1])]
out=sys.argv[2]; done=set()
if os.path.exists(out):
    for l in open(out):
        r=json.loads(l)
        if r.get("err")!="exception": done.add((r["from"],r["to"]))
SLEEP=float(os.environ.get("SLEEP","1.0"))
with open(out,"a") as f:
    for i,p in enumerate(pairs):
        k=(p["from"],p["to"])
        if k in done: continue
        for attempt in range(3):
            try:
                r=q(*k); break
            except Exception as e:
                r={"from":k[0],"to":k[1],"err":"exception","detail":str(e)[:200]}; time.sleep(10*(attempt+1))
        f.write(json.dumps(r,ensure_ascii=False)+"\n"); f.flush(); done.add(k)
        time.sleep(SLEEP)
print("finished",len(done))
