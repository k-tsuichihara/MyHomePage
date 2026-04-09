(function () {
  const previewListEl = document.getElementById("update-info-list");
  const moreBtnEl = document.getElementById("update-more-btn");
  const modalEl = document.getElementById("update-modal");
  const modalBackdropEl = document.getElementById("update-modal-backdrop");
  const modalCloseEl = document.getElementById("update-modal-close");
  const modalListEl = document.getElementById("update-modal-list");
  const prevBtnEl = document.getElementById("update-prev-btn");
  const nextBtnEl = document.getElementById("update-next-btn");
  const pageInfoEl = document.getElementById("update-page-info");

  if (
    !previewListEl || !moreBtnEl || !modalEl || !modalBackdropEl || !modalCloseEl ||
    !modalListEl || !prevBtnEl || !nextBtnEl || !pageInfoEl
  ) {
    return;
  }

  const PREVIEW_COUNT = 3;
  const PAGE_SIZE = 10;
  let items = [];
  let currentPage = 1;

  function parseDateValue(value) {
    if (!value || typeof value !== "string") {
      return 0;
    }
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  function categoryToClassName(category) {
    const value = String(category || "").trim().toLowerCase();
    if (value === "works") {
      return "cat-works";
    }
    if (value === "tools") {
      return "cat-tools";
    }
    if (value === "site") {
      return "cat-site";
    }
    return "cat-info";
  }

  function createNewsRow(item) {
    const row = document.createElement("div");
    row.className = "newsbox";

    const cat = document.createElement("div");
    cat.className = "newscate " + categoryToClassName(item.category);
    cat.textContent = String(item.category || "Info").toUpperCase();

    const day = document.createElement("div");
    day.className = "newsday";
    day.textContent = item.date || "-";

    const text = document.createElement("div");
    text.className = "newssen";
    text.textContent = item.text || "-";

    row.appendChild(cat);
    row.appendChild(day);
    row.appendChild(text);
    return row;
  }

  function renderPreview() {
    previewListEl.innerHTML = "";

    if (!items.length) {
      const empty = createNewsRow({
        category: "Info",
        date: "-",
        text: "更新履歴はまだありません。"
      });
      previewListEl.appendChild(empty);
      moreBtnEl.hidden = true;
      return;
    }

    items.slice(0, PREVIEW_COUNT).forEach(function (item) {
      previewListEl.appendChild(createNewsRow(item));
    });

    moreBtnEl.hidden = items.length <= PREVIEW_COUNT;
  }

  function getTotalPages() {
    return Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  }

  function renderModalPage() {
    const totalPages = getTotalPages();
    if (currentPage > totalPages) {
      currentPage = totalPages;
    }

    const start = (currentPage - 1) * PAGE_SIZE;
    const end = start + PAGE_SIZE;

    modalListEl.innerHTML = "";
    items.slice(start, end).forEach(function (item) {
      modalListEl.appendChild(createNewsRow(item));
    });

    pageInfoEl.textContent = String(currentPage) + " / " + String(totalPages);
    prevBtnEl.disabled = currentPage <= 1;
    nextBtnEl.disabled = currentPage >= totalPages;
  }

  function openModal() {
    currentPage = 1;
    renderModalPage();
    modalEl.hidden = false;
    document.body.classList.add("update-modal-open");
  }

  function closeModal() {
    if (modalEl.hidden) {
      return;
    }
    modalEl.hidden = true;
    document.body.classList.remove("update-modal-open");
  }

  moreBtnEl.addEventListener("click", openModal);
  modalCloseEl.addEventListener("click", closeModal);
  modalBackdropEl.addEventListener("click", closeModal);

  prevBtnEl.addEventListener("click", function () {
    if (currentPage <= 1) {
      return;
    }
    currentPage -= 1;
    renderModalPage();
  });

  nextBtnEl.addEventListener("click", function () {
    if (currentPage >= getTotalPages()) {
      return;
    }
    currentPage += 1;
    renderModalPage();
  });

  window.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      closeModal();
    }
  });

  fetch("data/update-info.json")
    .then(function (res) { return res.json(); })
    .then(function (data) {
      const list = Array.isArray(data) ? data : [];
      items = list
        .filter(function (item) {
          return item && item.hidden !== true;
        })
        .sort(function (a, b) {
          return parseDateValue(b.date) - parseDateValue(a.date);
        });
      renderPreview();
    })
    .catch(function () {
      items = [];
      renderPreview();
    });
})();
