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

	function setupTouchToggle(container) {
		if (!container) {
			return;
		}

		var touchLike = window.matchMedia("(hover: none), (pointer: coarse), (max-width: 900px)").matches;
		if (!touchLike) {
			return;
		}

		container.addEventListener("click", function (event) {
			var target = event.target;
			if (!(target instanceof HTMLElement)) {
				return;
			}

			var trigger = target.closest(".has-submenu > a");
			if (!trigger || !container.contains(trigger)) {
				return;
			}

			event.preventDefault();
			var parent = trigger.parentElement;
			if (!parent) {
				return;
			}

			var isOpen = parent.classList.contains("is-open");
			container.querySelectorAll(".has-submenu.is-open").forEach(function (node) {
				node.classList.remove("is-open");
			});

			if (!isOpen) {
				parent.classList.add("is-open");
			}
		});
	}

	setupTouchToggle(fixedMenu);
	setupTouchToggle(dropMenu);

	document.addEventListener("click", function (event) {
		var target = event.target;
		if (!(target instanceof HTMLElement)) {
			return;
		}

		if (!target.closest("#fix-header-menus") && fixedMenu) {
			fixedMenu.querySelectorAll(".has-submenu.is-open").forEach(function (node) {
				node.classList.remove("is-open");
			});
		}

		if (!target.closest("#menu_st") && dropMenu) {
			dropMenu.querySelectorAll(".has-submenu.is-open").forEach(function (node) {
				node.classList.remove("is-open");
			});
		}
	});
})();
