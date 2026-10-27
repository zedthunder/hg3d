// Personalize os links abaixo quando quiser. O WhatsApp já está configurado.
const HG3D_PHONE = "5594992083131";
const SITE_MESSAGE = "Olá! Vi a página da HG 3D e gostaria de conversar sobre a criação de uma página ou site para o meu negócio.";
const HG3D_LINKS = {
  whatsapp: `https://wa.me/${HG3D_PHONE}?text=${encodeURIComponent("Olá! Gostaria de solicitar um orçamento para uma peça ou produto personalizado em impressão 3D.")}`,
  "site-whatsapp": `https://wa.me/${HG3D_PHONE}?text=${encodeURIComponent(SITE_MESSAGE)}`,
  instagram: "https://instagram.com/SEUUSUARIO",
  catalog: "#",
  how: "#"
};
for (const [name, url] of Object.entries(HG3D_LINKS)) {
  const link = document.querySelector(`[data-link="${name}"]`);
  if (!link) continue;
  if (url === "#" || url.includes("SEUUSUARIO")) {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      alert(`${link.querySelector("strong")?.textContent || "Este link"}: configure o endereço no arquivo script.js antes de publicar a página.`);
    });
  } else link.href = url;
}