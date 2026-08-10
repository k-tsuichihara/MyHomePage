<<<作成時の注意点>>>

☆公開用ページはdist, ソースはsrcの中にある、もしくはindex.html
→絶対にdistの中身を触らないこと！

distとは、Reactで作られたソースをhtml,css,jsに置換しているもの。

☆機能を修正した後は必ず‼必ず！
cd C:\DevProjects\MyHomePage\tools\reading-log
npm run build

この呪文をターミナルに書き込んでからコミット・プッシュすること！
修正が反映されなくなるので要注意！