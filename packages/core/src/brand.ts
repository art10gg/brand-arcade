/**
 * Brand-Manifest: der Vertrag zwischen Plattform und Firmenkunde.
 * Ein neuer Kunde = ein neuer Ordner unter brands/<kunde>/ mit brand.json
 * und Avatar-Spritesheets im Standard-Rig. Null Code-Änderung.
 */

/** Animationen, die jeder Avatar liefern muss (Standard-Rig). */
export const PLATFORMER_ANIMS = ["idle", "run", "jump", "fall", "hit", "win"] as const;
export const KART_ANIMS = ["drive", "drift-left", "drift-right", "boost", "hit"] as const;

export type PlatformerAnim = (typeof PLATFORMER_ANIMS)[number];
export type KartAnim = (typeof KART_ANIMS)[number];

export interface SpriteSheetDef {
  /** Pfad relativ zum Brand-Ordner, z. B. "avatar/platformer.png" */
  file: string;
  frameWidth: number;
  frameHeight: number;
  /** Frame-Bereiche pro Animation: [startFrame, endFrame, frameRate] */
  anims: Record<string, [number, number, number]>;
}

export interface BrandManifest {
  id: string;
  name: string;
  /** Marken-Farbtokens – auch fürs UI-Theming (Light + Dark). */
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    /** Fallback-Farbe für generierte Platzhalter-Avatare */
    avatar: string;
  };
  logo?: string;
  avatar: {
    /** Fehlt ein Sheet, generiert die Engine einen Platzhalter aus colors.avatar */
    platformer?: SpriteSheetDef;
    kart?: SpriteSheetDef;
  };
  audio?: {
    jingle?: string;
  };
}

const BRANDS_BASE = "brands";

/** Lädt das Brand-Manifest eines Kunden (z. B. aus ?brand=demo-brand). */
export async function loadBrand(brandId: string): Promise<BrandManifest> {
  const res = await fetch(`${BRANDS_BASE}/${brandId}/brand.json`);
  if (!res.ok) throw new Error(`Brand "${brandId}" nicht gefunden (${res.status})`);
  const manifest = (await res.json()) as BrandManifest;
  manifest.id = brandId;
  return manifest;
}

/** URL eines Brand-Assets relativ zum Brand-Ordner. */
export function brandAsset(brand: BrandManifest, file: string): string {
  return `${BRANDS_BASE}/${brand.id}/${file}`;
}

/** Setzt Markenfarben als CSS-Custom-Properties fürs Shell-UI. */
export function applyBrandTheme(brand: BrandManifest): void {
  const root = document.documentElement;
  root.style.setProperty("--brand-primary", brand.colors.primary);
  root.style.setProperty("--brand-secondary", brand.colors.secondary);
  root.style.setProperty("--brand-accent", brand.colors.accent);
}
