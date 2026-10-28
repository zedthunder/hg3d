// ==================================================
// HG 3D | Configuração dos links da página
// Altere os endereços abaixo para personalizar o site.
// ==================================================

const HG3D_PHONE = "5594992083131";

// Mensagem para empresas interessadas em uma página própria.
const SITE_MESSAGE =
  "Olá! Vi a página da HG 3D e gostaria de conversar sobre a criação de uma página ou site para o meu negócio.";

// Links usados pelos botões do index.html.
const HG3D_LINKS = {
  whatsapp: `https://wa.me/${HG3D_PHONE}?text=${encodeURIComponent(
    "Olá! Gostaria de solicitar um orçamento para uma peça ou produto personalizado em impressão 3D."
  )}`,

  "site-whatsapp": `https://wa.me/${HG3D_PHONE}?text=${encodeURIComponent(SITE_MESSAGE)}`,

  // Troque SEUUSUARIO pelo nome real do perfil do Instagram.
  instagram: "https://www.instagram.com/impressao3dhg/",

  // Substitua # pelos endereços reais quando tiver catálogo ou página informativa.
  catalog: "catalogo.html",
  how: "https://www.instagram.com/p/DewKzxLkfx1/?img_index=1",

  contact: `https://wa.me/${HG3D_PHONE}?text=${encodeURIComponent(
    "Olá! Gostaria de conhecer melhor o trabalho da HG 3D."
  )}`
};

// Associa cada botão ao endereço configurado acima.
// Links ainda não configurados exibem um aviso em vez de abrir uma página vazia.
for (const [name, url] of Object.entries(HG3D_LINKS)) {
  const link = document.querySelector(`[data-link="${name}"]`);

  if (!link) continue;

  if (url === "#" || url.includes("SEUUSUARIO")) {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const label = link.querySelector("strong")?.textContent || "Este link";
      alert(`${label}: configure o endereço no arquivo script.js antes de publicar.`);
    });
  } else {
    link.href = url;
  }
}