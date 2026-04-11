(function () {
	"use strict";

	var STORAGE_KEY = "myhomepage.memo.items.v1";

	var form = document.getElementById("memo-form");
	var textArea = document.getElementById("memo-text");
	var submitBtn = document.getElementById("memo-submit-btn");
	var cancelBtn = document.getElementById("memo-cancel-btn");
	var clearAllBtn = document.getElementById("memo-clear-all-btn");
	var list = document.getElementById("memo-list");
	var emptyMessage = document.getElementById("memo-empty");

	var editingId = null;
	var items = loadItems();

	render();

	form.addEventListener("submit", function (event) {
		event.preventDefault();

		var text = textArea.value.trim();
		if (!text) {
			textArea.focus();
			return;
		}

		if (editingId) {
			items = items.map(function (item) {
				if (item.id === editingId) {
					return {
						id: item.id,
						text: text,
						createdAt: item.createdAt,
						updatedAt: new Date().toISOString()
					};
				}
				return item;
			});
		} else {
			var now = new Date().toISOString();
			items.unshift({
				id: createId(),
				text: text,
				createdAt: now,
				updatedAt: now
			});
		}

		saveItems(items);
		resetEditor();
		render();
	});

	cancelBtn.addEventListener("click", function () {
		resetEditor();
	});

	clearAllBtn.addEventListener("click", function () {
		if (!items.length) {
			return;
		}

		if (!window.confirm("保存済みメモをすべて削除します。よろしいですか？")) {
			return;
		}

		items = [];
		saveItems(items);
		resetEditor();
		render();
	});

	list.addEventListener("click", function (event) {
		var target = event.target;
		if (!(target instanceof HTMLElement)) {
			return;
		}

		var action = target.getAttribute("data-action");
		if (!action) {
			return;
		}

		var id = target.getAttribute("data-id");
		if (!id) {
			return;
		}

		if (action === "edit") {
			startEdit(id);
			return;
		}

		if (action === "delete") {
			deleteItem(id);
		}
	});

	function loadItems() {
		try {
			var raw = localStorage.getItem(STORAGE_KEY);
			if (!raw) {
				return [];
			}
			var parsed = JSON.parse(raw);
			if (!Array.isArray(parsed)) {
				return [];
			}
			return parsed.filter(function (item) {
				return item && typeof item.id === "string" && typeof item.text === "string";
			});
		} catch (error) {
			return [];
		}
	}

	function saveItems(nextItems) {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(nextItems));
	}

	function createId() {
		return "memo-" + Date.now() + "-" + Math.random().toString(16).slice(2, 8);
	}

	function formatDate(isoString) {
		var date = new Date(isoString);
		if (Number.isNaN(date.getTime())) {
			return "日時不明";
		}

		return date.toLocaleString("ja-JP", {
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit"
		});
	}

	function startEdit(id) {
		var item = items.find(function (candidate) {
			return candidate.id === id;
		});

		if (!item) {
			return;
		}

		editingId = id;
		textArea.value = item.text;
		submitBtn.textContent = "更新";
		cancelBtn.hidden = false;
		textArea.focus();
	}

	function deleteItem(id) {
		var item = items.find(function (candidate) {
			return candidate.id === id;
		});

		if (!item) {
			return;
		}

		if (!window.confirm("このメモを削除しますか？")) {
			return;
		}

		items = items.filter(function (candidate) {
			return candidate.id !== id;
		});

		saveItems(items);

		if (editingId === id) {
			resetEditor();
		}

		render();
	}

	function resetEditor() {
		editingId = null;
		form.reset();
		submitBtn.textContent = "追加";
		cancelBtn.hidden = true;
	}

	function render() {
		list.innerHTML = "";

		if (!items.length) {
			emptyMessage.hidden = false;
			return;
		}

		emptyMessage.hidden = true;

		items.forEach(function (item) {
			var li = document.createElement("li");
			li.className = "memo-item";

			var text = document.createElement("p");
			text.className = "memo-item-text";
			text.textContent = item.text;

			var meta = document.createElement("div");
			meta.className = "memo-item-meta";

			var date = document.createElement("span");
			date.textContent = "更新: " + formatDate(item.updatedAt || item.createdAt);

			var actions = document.createElement("div");
			actions.className = "memo-item-actions";

			var editButton = document.createElement("button");
			editButton.type = "button";
			editButton.textContent = "編集";
			editButton.setAttribute("data-action", "edit");
			editButton.setAttribute("data-id", item.id);

			var deleteButton = document.createElement("button");
			deleteButton.type = "button";
			deleteButton.className = "danger";
			deleteButton.textContent = "削除";
			deleteButton.setAttribute("data-action", "delete");
			deleteButton.setAttribute("data-id", item.id);

			actions.appendChild(editButton);
			actions.appendChild(deleteButton);
			meta.appendChild(date);
			meta.appendChild(actions);

			li.appendChild(text);
			li.appendChild(meta);
			list.appendChild(li);
		});
	}
})();
