import Phaser from "phaser";
import type { BrandManifest, SpriteSheetDef } from "./brand";
import { brandAsset } from "./brand";

export type GameKind = "platformer" | "kart";

/** Textur-/Anim-Schlüssel, unter dem der Avatar im Spiel registriert wird. */
export function avatarKey(kind: GameKind): string {
  return `avatar-${kind}`;
}

/**
 * In preload() aufrufen: lädt das Kunden-Spritesheet, falls im Manifest
 * definiert. Fehlt es, wird später ein Platzhalter generiert.
 */
export function preloadAvatar(scene: Phaser.Scene, brand: BrandManifest, kind: GameKind): void {
  const def = brand.avatar[kind];
  if (!def) return;
  scene.load.spritesheet(avatarKey(kind), brandAsset(brand, def.file), {
    frameWidth: def.frameWidth,
    frameHeight: def.frameHeight,
  });
}

/**
 * In create() aufrufen: registriert Animationen aus dem Manifest oder
 * erzeugt einen Platzhalter-Avatar aus der Markenfarbe.
 * Danach existiert immer die Textur avatarKey(kind) und die Anims des Rigs.
 */
export function createAvatar(scene: Phaser.Scene, brand: BrandManifest, kind: GameKind): void {
  const key = avatarKey(kind);
  const def = brand.avatar[kind];

  if (def && scene.textures.exists(key)) {
    registerAnims(scene, key, def);
    return;
  }

  // Platzhalter: abgerundetes Quadrat in Markenfarbe mit "Gesicht"
  const size = kind === "kart" ? 48 : 40;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  const color = Phaser.Display.Color.HexStringToColor(brand.colors.avatar).color;
  g.fillStyle(color, 1);
  g.fillRoundedRect(0, 0, size, size, 10);
  g.fillStyle(0xffffff, 1);
  g.fillCircle(size * 0.32, size * 0.38, 5);
  g.fillCircle(size * 0.68, size * 0.38, 5);
  g.fillStyle(0x222222, 1);
  g.fillCircle(size * 0.32, size * 0.38, 2.5);
  g.fillCircle(size * 0.68, size * 0.38, 2.5);
  g.generateTexture(key, size, size);
  g.destroy();
}

function registerAnims(scene: Phaser.Scene, key: string, def: SpriteSheetDef): void {
  for (const [name, [start, end, frameRate]] of Object.entries(def.anims)) {
    const animKey = `${key}-${name}`;
    if (scene.anims.exists(animKey)) continue;
    scene.anims.create({
      key: animKey,
      frames: scene.anims.generateFrameNumbers(key, { start, end }),
      frameRate,
      repeat: name === "idle" || name === "run" || name === "drive" ? -1 : 0,
    });
  }
}

/** Spielt eine Rig-Animation ab, sofern das Brand-Sheet sie definiert. */
export function playAvatarAnim(sprite: Phaser.GameObjects.Sprite, kind: GameKind, anim: string): void {
  const animKey = `${avatarKey(kind)}-${anim}`;
  if (sprite.scene.anims.exists(animKey)) sprite.play(animKey, true);
}
