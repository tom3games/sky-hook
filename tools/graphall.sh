#!/bin/sh
# 出発と各旗からグラフを作る（並列）。結果は shots/edges_*.json と $1/G_*.txt
O=$1; cd "$(dirname "$0")/.."
node tools/graph.mjs > $O/G_s.txt 2>&1 &
for f in 0 1 2 3 4 5 6; do node tools/graph.mjs --flag $f > $O/G_$f.txt 2>&1 & done
wait
for f in s 0 1 2 3 4 5 6; do echo "== $f $(grep -h 'reached' $O/G_$f.txt | cut -c1-110) $(grep -h 'top-landing' $O/G_$f.txt)"; done
