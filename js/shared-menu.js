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

	function closeOpenSubmenus(container) {
		if (!container) {
			return;
		}
		container.querySelectorAll(".has-submenu.is-open").forEach(function (node) {
			node.classList.remove("is-open");
		});
	}

	function setupSubmenuToggle(container) {
		if (!container) {
			return;
		}

		var lastTouchToggleAt = 0;

		function handleToggle(event) {
			var target = event.target;
			if (!(target instanceof HTMLElement)) {
				return;
			}

			if (event.type === "click" && Date.now() - lastTouchToggleAt < 500) {
				return;
			}

			var trigger = target.closest(".has-submenu > a");
			if (!trigger || !container.contains(trigger)) {
				return;
			}

			event.preventDefault();
			event.stopPropagation();

			if (event.type === "touchstart") {
				lastTouchToggleAt = Date.now();
			}

			var parent = trigger.parentElement;
			if (!parent) {
				return;
			}

			var isOpen = parent.classList.contains("is-open");
			closeOpenSubmenus(container);
			if (!isOpen) {
				parent.classList.add("is-open");
			}
		}

		container.addEventListener("touchstart", handleToggle, { passive: false });
		container.addEventListener("click", function (event) {
			var target = event.target;
			if (!(target instanceof HTMLElement)) {
				return;
			}

			handleToggle(event);

			if (event.defaultPrevented) {
				return;
			}

			var submenuLink = target.closest(".submenu a");
			if (submenuLink && container.contains(submenuLink)) {
				closeOpenSubmenus(container);
			}
		});
 	}

	setupSubmenuToggle(fixedMenu);
	setupSubmenuToggle(dropMenu);

	document.addEventListener("click", function (event) {
		var target = event.target;
		if (!(target instanceof HTMLElement)) {
			return;
		}

		if (!target.closest("#fix-header-menus") && fixedMenu) {
			closeOpenSubmenus(fixedMenu);
		}

		if (!target.closest("#menu_st") && dropMenu) {
			closeOpenSubmenus(dropMenu);
		}
	});

	window.addEventListener("resize", function () {
		closeOpenSubmenus(fixedMenu);
		closeOpenSubmenus(dropMenu);
	});
})();
