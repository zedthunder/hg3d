// HG 3D | Carrega automaticamente as imagens da pasta /gallery no GitHub.
const GALLERY_API = "https://api.github.com/repos/zedthunder/hg3d/contents/gallery?ref=main";
const grid = document.querySelector("#gallery-grid");
const status = document.querySelector("#gallery-status");
const imageExtensions = /\.(avif|gif|jpe?g|png|svg|webp)$/i;

function toggleImage(card) {
  const expanded = card.classList.toggle("is-expanded");
  card.setAttribute("aria-expanded", String(expanded));
}

async function loadGallery() {
  try {
    const response = await fetch(GALLERY_API);
    if (!response.ok) throw new Error("Não foi possível consultar a pasta gallery.");
    const files = await response.json();
    const images = files
      .filter(file => file.type === "file" && imageExtensions.test(file.name))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { numeric: true }));

    if (!images.length) {
      status.textContent = "Ainda não há fotos no catálogo. Adicione imagens à pasta gallery no GitHub e atualize esta página.";
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const file of images) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "gallery-item";
      card.setAttribute("aria-expanded", "false");
      card.setAttribute("aria-label", "Ampliar " + file.name);

      const image = document.createElement("img");
      image.src = file.download_url;
      image.alt = file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
      image.loading = "lazy";
      image.decoding = "async";

      const caption = document.createElement("span");
      caption.className = "gallery-caption";
      caption.textContent = image.alt;

      const hint = document.createElement("span");
      hint.className = "gallery-zoom-hint";
      hint.innerHTML = '<i class="bi bi-arrows-angle-expand" aria-hidden="true"></i>';

      card.append(image, caption, hint);
      card.addEventListener("click", () => toggleImage(card));
      fragment.append(card);
    }

    grid.append(fragment);
    status.textContent = images.length + (images.length === 1 ? " imagem no catálogo" : " imagens no catálogo");
  } catch (error) {
    console.error(error);
    status.textContent = "Não foi possível carregar as fotos agora. Confira sua conexão e tente atualizar a página.";
  }
}

loadGallery();