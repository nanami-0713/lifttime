#!/bin/bash
# 练时 LiftTime —— 一键验证并推送（在 lifttime 目录下执行：bash scripts/verify-and-push.sh）
# 做的事：跑全部单测 → 敏感信息扫描 → 语法检查 → 提交 → 推送 main → 等 Pages 构建 → 打印线上版本
set -e
cd "$(dirname "$0")/.."

echo "== [1/6] 单元测试 =="
node tests/analysis.test.mjs | tail -1
node tests/nutrition.test.mjs | tail -1
node tests/finance.test.mjs | tail -1
node tests/ai.test.mjs | tail -1

echo "== [2/6] JS 语法检查 =="
FAIL=0
for f in $(git ls-files '*.js' '*.mjs'); do
  node --check "$f" 2>/dev/null || { echo "语法错误: $f"; FAIL=1; }
done
[ "$FAIL" = "0" ] && echo "全部通过"

echo "== [3/6] 敏感信息扫描 =="
HITS=$(grep -RInE 'BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,}|/(Users|home)/[a-z]+/|192\.168\.|10\.[0-9]{1,3}\.' \
  . --exclude-dir=.git --exclude-dir=node_modules --exclude='*.png' || true)
if [ -n "$HITS" ]; then
  echo "发现疑似敏感内容，已中止推送："
  echo "$HITS"
  exit 1
fi
echo "干净 ✓"

echo "== [4/6] Service Worker 资产完整性 =="
node -e "
const fs=require('fs');
const m=fs.readFileSync('sw.js','utf8').match(/ASSETS = \[([\s\S]*?)\]/)[1];
const files=[...m.matchAll(/'\.\/([^']+)'/g)].map(x=>x[1]);
let miss=0;
for(const f of files){ if(!fs.existsSync(f)||!fs.statSync(f).size){ console.error('缺失: '+f); miss++; } }
if(miss){ process.exit(1); }
console.log('ASSETS '+files.length+' 项完整 ✓');
"

echo "== [5/6] 提交并推送 =="
git add -A
git status --porcelain
MSG="${1:-AI 简评：接入智谱 GLM（glm-5.3-flash，思考强度 max）}"
git commit -m "$MSG" || echo "（没有新的变更需要提交）"
git push origin main

echo "== [6/6] 等待 GitHub Pages 构建 =="
for i in $(seq 1 12); do
  sleep 15
  ST=$(gh api repos/nanami-0713/lifttime/pages/builds/latest --jq '{status, commit: .commit[0:7]}' 2>/dev/null || echo '{"status":"?"}')
  echo "  构建状态: $ST"
  echo "$ST" | grep -q '"built"' && break
done
curl -s "https://nanami-0713.github.io/lifttime/sw.js?x=$(date +%s)" | grep -o "lifttime-v[0-9.]*" | head -1
echo "完成。线上版本见上方（应为 lifttime-v1.3.0）"
