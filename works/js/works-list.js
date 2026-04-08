(function () {
  const grid = document.getElementById("works-grid");
  const moreButton = document.getElementById("works-more");

  if (!grid || !moreButton) {
    return;
  }

  const INITIAL_COUNT = 6;
  let visibleCount = INITIAL_COUNT;
  let works = [];

  function isVideoSource(src) {
    const value = (src || "").split("?")[0].toLowerCase();
    return /\.(mp4|webm|ogv|ogg|avi|mov|m4v)$/.test(value);
  }

  function toSource(item) {
    if (typeof item === "string") {
      return item;
    }
    if (item && typeof item.src === "string") {
      return item.src;
    }
    return "";
  }

  function getWorkCardImage(work) {
    const list = Array.isArray(work.images) ? work.images : [];
    const sources = list.map(toSource).filter(Boolean);

    if (!sources.length) {
      return "../images/digitalHeader.jpg";
    }

    const firstImage = sources.find(function (src) {
      return !isVideoSource(src);
    });

    return firstImage || "../images/digitalHeader.jpg";
  }

  function createWorkCard(work) {
    const link = document.createElement("a");
    link.className = "work-card";
    link.href = "work.html?id=" + encodeURIComponent(work.id);

    const image = document.createElement("img");
    image.className = "work-card-image";
    image.src = getWorkCardImage(work);
    image.alt = work.title;

    const body = document.createElement("div");
    body.className = "work-card-body";

    const title = document.createElement("p");
    title.className = "work-card-title";
    title.textContent = work.title;

    const tech = document.createElement("p");
    tech.className = "work-card-tech";
    tech.textContent = (work.tech || []).join(" / ");

    body.appendChild(title);
    body.appendChild(tech);
    link.appendChild(image);
    link.appendChild(body);
    return link;
  }

  function render() {
    grid.innerHTML = "";

    works.slice(0, visibleCount).forEach((work) => {
      grid.appendChild(createWorkCard(work));
    });

    moreButton.hidden = visibleCount >= works.length;
  }

  moreButton.addEventListener("click", function () {
    visibleCount += INITIAL_COUNT;
    render();
  });

  fetch("data/works.json")
    .then((res) => res.json())
    .then((data) => {
      works = data.filter((item) => item.published !== false);
      render();
    })
    .catch(() => {
      works = [];
      render();
    });
})();
