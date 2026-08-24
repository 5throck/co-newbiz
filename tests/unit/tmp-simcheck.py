import json, subprocess, sys, tempfile, os
base = {"seed": 42, "iterations": 2000}
def run(payload):
    payload = {**base, **payload}
    fd, path = tempfile.mkstemp(suffix=".json"); os.write(fd, json.dumps(payload).encode()); os.close(fd)
    r = subprocess.run([sys.executable, "python/structure_sim.py", path], capture_output=True, text=True, encoding="utf-8")
    os.unlink(path)
    return r

# 1) degenerate zero band -> constant quantiles
r = run({"drivers": {"rate_bp": {"mode": 0, "low": 0, "high": 0}}, "nodes": [{"industry_id": "A"}], "links": []})
d = json.loads(r.stdout)["results"][0]["demand_delta_pct"]
print("zero-band constant:", d["p05"] == d["p50"] == d["p95"] == 0.0)

# 2) cycle -> error mentioning cycle
cyc = {"drivers": {}, "nodes": [{"industry_id": i} for i in "ABC"],
       "links": [{"from":"A","to":"B","elasticity":1},{"from":"B","to":"C","elasticity":1},{"from":"C","to":"A","elasticity":1}]}
r = run(cyc); print("cycle error:", "cycle detected" in r.stderr)

# 3) duplicate pair -> error
dup = {"drivers": {}, "nodes": [{"industry_id": i} for i in "AB"],
       "links": [{"from":"A","to":"B","elasticity":1},{"from":"A","to":"B","elasticity":1}]}
r = run(dup); print("duplicate error:", "duplicate value_chain_link" in r.stderr)

# 4) transitive taint: B inflow coeff-less; C fed by B WITH elasticity
tt = {"drivers": {"fx_pct": {"mode": 5, "low": 5, "high": 5}},
      "nodes": [{"industry_id": i} for i in "BCD"],
      "links": [{"from":"X","to":"B","elasticity":None},{"from":"B","to":"D","elasticity":0.9}]}
r = run(tt); data = json.loads(r.stdout)
flags = {x["industry_id"]: x["unassessed"] for x in data["results"]}
print("taint B:", flags.get("B"), "| taint D (transitive):", flags.get("D"), "| nodes:", sorted(data["unassessed_nodes"]))
