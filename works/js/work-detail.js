(function () {
  const titleEl = document.getElementById("work-title");
  const techEl = document.getElementById("work-tech");
  const dateEl = document.getElementById("work-date");
  const backgroundEl = document.getElementById("work-background");
  const descriptionEl = document.getElementById("work-description");
  const mainImageEl = document.getElementById("work-main-image");
  const mainVideoEl = document.getElementById("work-main-video");
  const mediaNoteEl = document.getElementById("work-media-note");
  const thumbsEl = document.getElementById("work-thumbs");
  const prevBtn = document.getElementById("work-prev");
  const nextBtn = document.getElementById("work-next");
  const zoomModalEl = document.getElementById("work-zoom-modal");
  const zoomBackdropEl = document.getElementById("work-zoom-backdrop");
  const zoomCloseEl = document.getElementById("work-zoom-close");
  const zoomImageEl = document.getElementById("work-zoom-image");

  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  let currentMedia = [];
  let currentIndex = 0;

  function detectMediaType(src) {
    const value = (src || "").split("?")[0].toLowerCase();
    if (/\.(mp4|webm|ogv|ogg|avi|mov|m4v)$/.test(value)) {
      return "video";
    }
    return "image";
  }

  function isLimitedSupportVideo(src) {
    const value = (src || "").split("?")[0].toLowerCase();
    return /\.(avi|mov)$/.test(value);
  }

  function startVideoPlayback() {
    const playPromise = mainVideoEl.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(function () {
        // Some browsers still block autoplay under specific conditions.
      });
    }
  }

  function normalizeFit(value) {
    return value === "contain" ? "contain" : "cover";
  }

  function applyFitClass(el, fit) {
    if (!el) {
      return;
    }
    el.classList.toggle("is-fit-contain", fit === "contain");
  }

  function closeZoomModal() {
    if (!zoomModalEl || zoomModalEl.hidden) {
      return;
    }
    zoomModalEl.hidden = true;
    document.body.classList.remove("work-zoom-open");
  }

  function openZoomModal(src, alt) {
    if (!zoomModalEl || !zoomImageEl || !src) {
      return;
    }
    zoomImageEl.src = src;
    zoomImageEl.alt = alt || "拡大画像";
    zoomModalEl.hidden = false;
    document.body.classList.add("work-zoom-open");
  }

  function toMultilineText(value) {
    if (Array.isArray(value)) {
      return value.filter(Boolean).join("\n") || "-";
    }
    return value || "-";
  }

  function normalizeMediaList(work) {
    const list = Array.isArray(work.images) ? work.images : [];
    const containSet = new Set(
      (Array.isArray(work.fitIndices) ? work.fitIndices : [])
        .filter(function (n) { return Number.isInteger(n) && n >= 0; })
    );
    const normalized = list
      .filter(Boolean)
      .slice(0, 6)
      .map(function (item, index) {
        const fitFromIndex = containSet.has(index) ? "contain" : "cover";
        if (typeof item === "string") {
          return {
            src: item,
            type: detectMediaType(item),
            fit: fitFromIndex
          };
        }

        const src = item && typeof item.src === "string" ? item.src : "";
        return {
          src: src,
          type: detectMediaType(src),
          fit: normalizeFit((item && item.fit) || fitFromIndex)
        };
      });

    if (normalized.length) {
      return normalized;
    }

    return [{ src: "../images/digitalHeader.jpg", type: "image", fit: "cover" }];
  }

  function setNotFound() {
    titleEl.textContent = "作品が見つかりません";
    techEl.textContent = "一覧ページから選択してください。";
    dateEl.textContent = "公開日: -";
    backgroundEl.textContent = "-";
    descriptionEl.textContent = "URLまたはIDを確認してください。";
    currentMedia = [{ src: "../images/digitalHeader.jpg", type: "image", fit: "cover" }];
    currentIndex = 0;
    thumbsEl.innerHTML = "";
    updateView();
  }

  function updateView() {
    const hasMedia = currentMedia.length > 0;
    const safeIndex = hasMedia ? Math.max(0, Math.min(currentIndex, currentMedia.length - 1)) : 0;
    currentIndex = safeIndex;

    const current = hasMedia ? currentMedia[currentIndex] : { src: "../images/digitalHeader.jpg", type: "image", fit: "cover" };

    if (current.type === "video") {
      mainImageEl.hidden = true;
      mainVideoEl.hidden = false;
      mainImageEl.classList.remove("is-zoomable");
      mainImageEl.removeAttribute("tabindex");
      applyFitClass(mainVideoEl, current.fit);
      mainVideoEl.autoplay = true;
      mainVideoEl.loop = true;
      mainVideoEl.currentTime = 0;
      mainVideoEl.src = current.src;
      mediaNoteEl.hidden = !isLimitedSupportVideo(current.src);
      startVideoPlayback();
    } else {
      mainVideoEl.pause();
      mainVideoEl.removeAttribute("src");
      mainVideoEl.load();
      mainVideoEl.hidden = true;
      mainImageEl.hidden = false;
      mainImageEl.classList.add("is-zoomable");
      mainImageEl.setAttribute("tabindex", "0");
      applyFitClass(mainImageEl, current.fit);
      mainImageEl.src = current.src;
      mediaNoteEl.hidden = true;
    }

    Array.from(thumbsEl.children).forEach((thumbWrap, index) => {
      const mediaEl = thumbWrap.firstElementChild;
      if (mediaEl) {
        mediaEl.classList.toggle("active", index === currentIndex);
      }
    });

    const single = currentMedia.length <= 1;
    prevBtn.disabled = single;
    nextBtn.disabled = single;
  }

  function render(work) {
    titleEl.textContent = work.title || "無題";
    techEl.textContent = (work.tech || []).join(" / ") || "-";
    dateEl.textContent = "公開日: " + (work.publishedAt || "-");
    backgroundEl.textContent = toMultilineText(work.background);
    descriptionEl.textContent = toMultilineText(work.description);

    const mediaList = normalizeMediaList(work);
    currentMedia = mediaList;
    currentIndex = 0;
    mainImageEl.alt = work.title || "work image";

    thumbsEl.innerHTML = "";
    mediaList.forEach((media, index) => {
      const thumbWrap = document.createElement("button");
      thumbWrap.type = "button";
      thumbWrap.className = "work-thumb-btn";

      let thumb;
      if (media.type === "video") {
        thumb = document.createElement("video");
        thumb.src = media.src;
        thumb.muted = true;
        thumb.playsInline = true;
        thumb.preload = "metadata";
      } else {
        thumb = document.createElement("img");
        thumb.src = media.src;
        thumb.alt = (work.title || "work") + " " + (index + 1);
      }

      applyFitClass(thumb, media.fit);

      thumbWrap.addEventListener("click", function () {
        currentIndex = index;
        updateView();
      });

      thumbWrap.appendChild(thumb);
      thumbsEl.appendChild(thumbWrap);
    });

    updateView();
  }

  prevBtn.addEventListener("click", function () {
    if (!currentMedia.length) {
      return;
    }
    currentIndex = (currentIndex - 1 + currentMedia.length) % currentMedia.length;
    updateView();
  });

  nextBtn.addEventListener("click", function () {
    if (!currentMedia.length) {
      return;
    }
    currentIndex = (currentIndex + 1) % currentMedia.length;
    updateView();
  });

  mainImageEl.addEventListener("click", function () {
    if (mainImageEl.hidden) {
      return;
    }
    openZoomModal(mainImageEl.src, mainImageEl.alt);
  });

  mainImageEl.addEventListener("keydown", function (event) {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    if (mainImageEl.hidden) {
      return;
    }
    openZoomModal(mainImageEl.src, mainImageEl.alt);
  });

  if (zoomCloseEl) {
    zoomCloseEl.addEventListener("click", closeZoomModal);
  }

  if (zoomBackdropEl) {
    zoomBackdropEl.addEventListener("click", closeZoomModal);
  }

  window.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      closeZoomModal();
    }
  });

  if (!id) {
    setNotFound();
    return;
  }

  fetch("data/works.json")
    .then((res) => res.json())
    .then((data) => {
      const work = data.find((item) => item.id === id);
      if (!work) {
        setNotFound();
        return;
      }
      render(work);
    })
    .catch(() => {
      setNotFound();
    });
})();
