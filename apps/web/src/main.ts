import Phaser from "phaser";
import { applyBrandTheme, loadBrand, type BrandManifest } from "@platform/core";
import { PlatformerScene } from "@platform/game-platformer";
import { KartScene } from "@platform/game-kart";

/**
 * PWA-Shell: lädt das Brand-Manifest (?brand=<id>, Default: demo-brand),
 * themed das Menü in Markenfarben und startet das gewählte Spiel.
 */
async function boot() {
  const params = new URLSearchParams(location.search);
  const brandId = params.get("brand") ?? "demo-brand";

  let brand: BrandManifest;
  try {
    brand = await loadBrand(brandId);
  } catch (e) {
    document.getElementById("brand-sub")!.textContent = `Fehler: ${(e as Error).message}`;
    return;
  }

  applyBrandTheme(brand);
  document.title = `${brand.name} Arcade`;
  document.getElementById("brand-title")!.textContent = `${brand.name} Arcade`;

  document.querySelectorAll<HTMLButtonElement>("#menu button").forEach((btn) => {
    btn.addEventListener("click", () => startGame(brand, btn.dataset.game as "platformer" | "kart"));
  });
}

function startGame(brand: BrandManifest, game: "platformer" | "kart") {
  document.getElementById("menu")!.style.display = "none";
  const container = document.getElementById("game")!;
  container.style.display = "block";

  const SceneClass = game === "platformer" ? PlatformerScene : KartScene;
  const phaser = new Phaser.Game({
    type: Phaser.AUTO,
    parent: container,
    width: 960,
    height: 600,
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    pixelArt: true,
    physics: { default: "arcade", arcade: { gravity: { x: 0, y: 900 } } },
    backgroundColor: "#1b1b24",
  });
  phaser.scene.add(game, SceneClass, true, { brand });
}

boot();

// Offline-Fähigkeit (PWA): Service Worker nur im Build/HTTPS-Kontext
if ("serviceWorker" in navigator && !location.hostname.includes("localhost")) {
  navigator.serviceWorker.register("sw.js").catch(() => {/* optional */});
}
