(function () {
	"use strict";  // 即時実行関数（IIFE）

	var STORAGE_KEY = "myhomepage.memo.items.v1";                        // localStorageに保存する際のキー

	var form = document.getElementById("memo-form");                     // フォーム全体
    var textTitle = document.getElementById("title");                    // タイトル
	var textArea = document.getElementById("memo-text");                 // メモ本体
	var submitBtn = document.getElementById("memo-submit-btn");          // 追加・更新ボタン
	var cancelBtn = document.getElementById("memo-cancel-btn");          // 編集キャンセルボタン
	var clearAllBtn = document.getElementById("memo-clear-all-btn");     // 全削除ボタン
	var list = document.getElementById("memo-list");                     // メモの一覧を表示する要素
	var emptyMessage = document.getElementById("memo-empty");            // メモがないときのメッセージ要素

	var editingId = null;              // 現在編集中のメモのID（新規追加の場合はnull）
	var items = loadItems();           // localStorageからメモのリストを読み込む

	render();                          // メモ描画

	form.addEventListener("submit", function (event) {
		event.preventDefault();  // フォームのデフォルトの送信動作をキャンセル
        
        // 表題チェック
		var title = textTitle.value.trim();
		if (!title) {
			title = "無題";  // タイトルがない場合は「無題」固定。（重複可）
		}
        // 本文チェック
		var text = textArea.value.trim();
		if (!text) {
			textArea.focus();
			return;
		}
        
        // すでに保存済みの場合
		if (editingId) {
			items = items.map(function (item) {
                // 中身を上書きするだけでIDと作成日時は変えない。更新日時は新しくする。
				if (item.id === editingId) {
					return {
						id: item.id,
                        title: title,
						text: text,
						createdAt: item.createdAt,
						updatedAt: new Date().toISOString()
					};
				}
				return item;
			});
		} else {
            // 新規作成
			var now = new Date().toISOString();
			items.unshift({
				id: createId(),
                title: title,
				text: text,
				createdAt: now,
				updatedAt: now
			});
		}

		saveItems(items);     // 保存
		resetEditor();        // フォームをリセットして新規追加状態に戻す
		render();             // メモの一覧を再描画
	});
    // 編集キャンセルボタンのクリックイベント
	cancelBtn.addEventListener("click", function () {
		resetEditor();
	});
    // 全削除ボタンのクリックイベント
	clearAllBtn.addEventListener("click", function () {
		if (!items.length) {
			return;
		}

		if (!window.confirm("保存済みメモをすべて削除します。よろしいですか？")) {
			return;
		}

		items = [];
		saveItems(items);     // 空のリストを保存して全削除
		resetEditor();        // フォームをリセットして新規追加状態に戻す
		render();             // メモの一覧を再描画（空になる）
	});
    // メモの編集・削除ボタンのクリックイベント（イベントデリゲーション）
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
    // localStorageからメモのリストを読み込む関数
	function loadItems() {
		try {
			var raw = localStorage.getItem(STORAGE_KEY);
			if (!raw) {
				return [];
			}
			var parsed = JSON.parse(raw);   // 解析して配列かどうかを確認。配列でなければ空のリストを返す。
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
    // メモのリストをlocalStorageに保存する関数
	function saveItems(nextItems) {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(nextItems));
	}
    // 一意のIDを生成する関数
	function createId() {
		return "memo-" + Date.now() + "-" + Math.random().toString(16).slice(2, 8);
	}
    // 日付をフォーマットする関数
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

	function buildPreviewText(text, maxLength) {
		if (!text) {
			return "";
		}

		var firstLine = text.split(/\r?\n/)[0].trim();
		if (firstLine.length <= maxLength) {
			return firstLine;
		}

		return firstLine.slice(0, maxLength) + "...";
	}
    // メモの編集を開始する関数
	function startEdit(id) {
		var item = items.find(function (candidate) {
			return candidate.id === id;
		});

		if (!item) {
			return;
		}

		editingId = id;
        textTitle.value = item.title || "";
		textArea.value = item.text;
		submitBtn.textContent = "更新";
		cancelBtn.hidden = false;
		textArea.focus();
	}
    // メモを削除する関数
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
    // フォームをリセットして新規追加状態に戻す関数
	function resetEditor() {
		editingId = null;
		form.reset();
		submitBtn.textContent = "追加";
		cancelBtn.hidden = true;
	}
    // メモの一覧を描画する関数
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

			var title = document.createElement("p");
			title.className = "memo-item-title";
			title.textContent = item.title || "無題";

			var preview = document.createElement("p");
			preview.className = "memo-item-text";
			preview.textContent = buildPreviewText(item.text, 30);

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

			li.appendChild(title);
			li.appendChild(preview);
			li.appendChild(meta);
			list.appendChild(li);
		});
	}
})();
