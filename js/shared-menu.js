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
			'<li><a href="' + buildHref("tools/memo/memo.html") + '">メモ</a></li>',
			'<li><a href="' + buildHref("tools/reading-log/") + '">読書管理アプリ</a></li>',
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

	function isMobileMenuMode() {
		return window.matchMedia("(max-width: 900px)").matches;
	}

	function closeOpenSubmenus(container) {
		if (!container) {
			return;
		}
		container.querySelectorAll(".has-submenu.is-open").forEach(function (node) {
			node.classList.remove("is-open");
		});
	}

	if (dropMenu) {
		dropMenu.addEventListener("click", function (event) {
			var target = event.target;
			if (!(target instanceof HTMLElement)) {
				return;
			}

			var trigger = target.closest(".has-submenu > a");
			if (trigger && dropMenu.contains(trigger)) {
				event.preventDefault();
				event.stopPropagation();

				var parent = trigger.parentElement;
				if (!parent) {
					return;
				}

				var isOpen = parent.classList.contains("is-open");
				closeOpenSubmenus(dropMenu);
				if (!isOpen) {
					parent.classList.add("is-open");
				}
				return;
			}

			var submenuLink = target.closest(".submenu a");
			if (submenuLink && dropMenu.contains(submenuLink)) {
				closeOpenSubmenus(dropMenu);
			}
		});
	}

	document.addEventListener("click", function (event) {
		var target = event.target;
		if (!(target instanceof HTMLElement)) {
			return;
		}

		if (!target.closest("#menu_st") && dropMenu) {
			closeOpenSubmenus(dropMenu);
		}
	});

	window.addEventListener("resize", function () {
		if (!isMobileMenuMode()) {
			closeOpenSubmenus(dropMenu);
		}
	});
})();
