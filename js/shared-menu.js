(function () {
	"use strict";

	var script = document.currentScript;
	var root = script && script.getAttribute("data-root") ? script.getAttribute("data-root") : "";

	function buildHref(path) {
		if (!root || root === ".") {
			return path;
		}
		return root.replace(/\/$/, "") + "/" + path;
	}

	function renderMenuHtml() {
		return [
			'<li><a href="' + buildHref("aboutme/aboutme.html") + '">About Me</a></li>',
			'<li><a href="' + buildHref("works/works.html") + '">WORKS</a></li>',
			'<li class="has-submenu"><a href="#">Tools</a>',
			'<ul class="submenu">',
			'<li><a href="' + buildHref("tools/memo.html") + '">メモ</a></li>',
			'</ul>',
			'</li>'
		].join("");
	}

	var fixedMenu = document.querySelector("#fix-header-menus .menu");
	if (fixedMenu) {
		fixedMenu.innerHTML = renderMenuHtml();
	}

	var dropMenu = document.querySelector("#menu_st .dropmenu");
	if (dropMenu) {
		dropMenu.innerHTML = renderMenuHtml();
	}
})();
