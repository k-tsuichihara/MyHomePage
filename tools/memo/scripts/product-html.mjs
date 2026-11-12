/** 公開ページの外枠を保持し、既存UIと同じDOM契約で製品候補を生成する。 */
export function productHtml(shell, ui) {
  const main = ui.match(/<main>([\s\S]*?)<\/main>/g);
  if (main?.length !== 1 || (shell.match(/<main>/g) ?? []).length !== 1
    || (shell.match(/<script src="js\/memo\.js"><\/script>/g) ?? []).length !== 1) {
    throw new Error('Product HTML structure changed');
  }
  const content = main[0].slice(6, -7);
  return shell.replace(/<main>[\s\S]*?<\/main>/, `<main><section class="memo-page"><div class="memo-shell memo-product"><p id="product-status" role="status">起動前です。</p>${content}</div></section></main>`)
    .replace('</head>', '<link rel="stylesheet" href="css/memo-product.css">\n</head>')
    .replace('<script src="js/memo.js"></script>', '<script type="module" src="js/memo-app.js"></script>');
}
