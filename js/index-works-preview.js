(function () {
  const imageEl = document.getElementById("works-preview-image");
  const linkEl = document.getElementById("works-preview-link");
  const titleEl = document.getElementById("works-preview-title");

  if (!imageEl || !linkEl || !titleEl) {
    return;
  }

  const ROTATE_MS = 7000;
  const FADE_OUT_MS = 520;
  const LOAD_TIMEOUT_MS = 1800;
  const VIDEO_EXT_RE = /\.(mp4|webm|ogv|ogg|avi|mov|m4v)$/i;
  const FALLBACK_IMAGE = "images/lukas-blazek-GnvurwJsKaY-unsplash.jpg";

  let timerId = null;
  let pool = [];
  let lastIndex = -1;
  let isTransitioning = false;

  function normalizeImageSrc(src) {
    if (!src || typeof src !== "string") {
      return "";
    }

    const trimmed = src.trim();
    if (!trimmed) {
      return "";
    }

    if (trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.startsWith("/")) {
      return trimmed;
    }

    if (trimmed.startsWith("../")) {
      return trimmed.replace(/^\.\.\//, "");
    }

    if (trimmed.startsWith("works/")) {
      return trimmed;
    }

    if (trimmed.startsWith("images/")) {
      return "works/" + trimmed;
    }

    return "works/images/" + trimmed;
  }

  function getSrcFromImageItem(item) {
    if (typeof item === "string") {
      return item;
    }
    if (item && typeof item.src === "string") {
      return item.src;
    }
    return "";
  }

  function createImagePool(works) {
    const items = [];

    works.forEach(function (work) {
      if (!work || work.published === false || !work.id) {
        return;
      }

      const imageList = Array.isArray(work.images) ? work.images : [];
      imageList.forEach(function (imageItem) {
        const rawSrc = getSrcFromImageItem(imageItem);
        if (!rawSrc || VIDEO_EXT_RE.test(rawSrc)) {
          return;
        }

        const src = normalizeImageSrc(rawSrc);
        if (!src) {
          return;
        }

        items.push({
          src: src,
          title: work.title || "WORKS",
          href: "works/work.html?id=" + encodeURIComponent(work.id)
        });
      });
    });

    return items;
  }

  function renderFallback() {
    imageEl.src = FALLBACK_IMAGE;
    imageEl.alt = "WORKS preview";
    linkEl.href = "works/works.html";
    titleEl.textContent = "表示できる画像が見つかりませんでした。";
  }

  function pickNextIndex() {
    if (pool.length <= 1) {
      return 0;
    }

    let next = Math.floor(Math.random() * pool.length);
    while (next === lastIndex) {
      next = Math.floor(Math.random() * pool.length);
    }
    return next;
  }

  function showPreview(withFade) {
    if (!pool.length) {
      renderFallback();
      return;
    }

    if (isTransitioning) {
      return;
    }

    const nextIndex = pickNextIndex();
    const item = pool[nextIndex];

    const update = function () {
      imageEl.src = item.src;
      imageEl.alt = item.title + " preview";
      linkEl.href = item.href;
      titleEl.textContent = item.title;
      lastIndex = nextIndex;
      imageEl.classList.remove("is-fading");
      titleEl.classList.remove("is-fading");
      isTransitioning = false;
    };

    if (!withFade) {
      update();
      return;
    }

    isTransitioning = true;
    imageEl.classList.add("is-fading");
    titleEl.classList.add("is-fading");

    window.setTimeout(function () {
      let settled = false;
      const preloaded = new Image();

      const settle = function () {
        if (settled) {
          return;
        }
        settled = true;
        update();
      };

      preloaded.onload = settle;
      preloaded.onerror = settle;
      preloaded.src = item.src;

      window.setTimeout(settle, LOAD_TIMEOUT_MS);
    }, FADE_OUT_MS);
  }

  function startRotate() {
    if (timerId || pool.length <= 1) {
      return;
    }

    timerId = window.setInterval(function () {
      showPreview(true);
    }, ROTATE_MS);
  }

  fetch("works/data/works.json")
    .then(function (res) { return res.json(); })
    .then(function (data) {
      const works = Array.isArray(data) ? data : [];
      pool = createImagePool(works);
      showPreview(false);
      startRotate();
    })
    .catch(function () {
      renderFallback();
    });
})();
