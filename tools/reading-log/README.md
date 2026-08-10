<<<作成時の注意点>>>

☆公開用ページはdist, ソースはsrcの中にある、もしくはindex.html
→絶対にdistの中身を触らないこと！

distとは、Reactで作られたソースをhtml,css,jsに置換しているもの。

☆機能を修正した後は必ず‼必ず！
# ① Reactプロジェクトへ移動
cd C:\DevProjects\MyHomePage\tools\reading-log

# ② 公開用distを作り直す
npm run build

# ③ Gitリポジトリのルートへ移動
cd C:\DevProjects\MyHomePage

# ④ 変更をステージング
git add -A

# ⑤ 状態確認
git status

# ⑥ コミット
git commit -m "読書管理アプリを更新"

# ⑦ GitHubへpush
git push origin main

この呪文をターミナルに書き込むこと！
修正が反映されなくなるので要注意！