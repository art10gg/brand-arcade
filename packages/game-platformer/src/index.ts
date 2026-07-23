import Phaser from "phaser";
import {
  BrandManifest,
  avatarKey,
  createAvatar,
  playAvatarAnim,
  preloadAvatar,
  preloadMusic,
  preloadSfx,
  playMusic,
  sfx,
} from "@platform/core";

/**
 * Jump'n'Run im SuperTux-Stil: präzise Physik (Coyote-Time, Jump-Buffer,
 * variable Sprunghöhe) + Leveldesign aus ASCII-Maps.
 * Optik: Kenney "Pixel Platformer" (CC0) — Tiles 18 px, 2× skaliert.
 */

const TILE = 36; // 18-px-Kenney-Tiles bei 2× Skalierung
const KENNEY_TILE = 18;
const KENNEY_CHAR = 24;

// Physik-Konstanten (Sprunghöhe ≈ 3,3 Tiles, max. Gap ≈ 5 Tiles)
const GRAVITY = 1500;
const RUN_SPEED = 290;
const ACCEL = 2400;
const DECEL = 3000;
const AIR_CONTROL = 0.75;
const JUMP_VELOCITY = -620;
const JUMP_CUT_VELOCITY = -180;
const COYOTE_MS = 90;
const JUMP_BUFFER_MS = 130;
const BOUNCE_PAD_VELOCITY = -900;
const STOMP_BOUNCE = -370;
const ENEMY_SPEED = 65;

// Kenney-Tile-Indizes (tilemap_packed.png, 20 Spalten)
const T = {
  grassL: 1, grassM: 2, grassR: 3, grassSingle: 0,
  dirt: 122, dirtAlt: 123,
  hedgeL: 17, hedgeM: 18, hedgeR: 19, hedgeSingle: 16,
  coin: 151,
  cactus: 127,
  mushroom: 107,
  heartFull: 44, heartEmpty: 46,
  decor: [124, 125, 126, 96, 105, 84], // Pflanzen, Baum, Busch, Zaun, Schild
} as const;
// Gegner (tilemap-characters_packed.png, 9 Spalten): blauer Walker, 2 Frames
const ENEMY_FRAMES = [18, 19];

/**
 * Level-Legende:
 * X Boden (Gras/Erde)   H Hecken-Plattform   C Münze   E Gegner
 * S Kaktus (Hazard)     B Sprung-Pilz        G Ziel-Flagge   P Start
 */
const LEVELS: string[][] = [
  [
    "................................................................................................................",
    ".....................C.C.........................................C.C.C.........................................",
    "....................HHHHH.......................................HHHHH..........................................",
    "..............................................C.C.............................................C.C.C............",
    "..............C..............................HHHH............................................HHHHH.............",
    ".............HHH.....................................................E.........................................",
    "......C.C................C.C..................................HHHHHHHHHH.............C.C.................C.C...",
    ".....HHHH...............HHHH........................................................HHHH.....................G.",
    "..P.............E.................E.....S.S.........E...........................E.........S.S.S.........XXXXXXX",
    "XXXXXXXXXXXXXXXXXXXXXXXXXXXX...XXXXXXXXXXXXXXXXXXXXXXXXXXX...XXXXXXXXXXXXXXX..XXXXXXXXXXXXXXXXXXXXX..XXXXXXXXX",
  ],
  [
    "................................................................................................................",
    "...........C.C.C....................................C.C........................................................",
    "..........HHHHHH...................................HHHHH.......................................................",
    ".......................C.C..................C..........................C.C.C..........................C.C......",
    "......C...............HHHH................HHH.........................HHHHHH.........................HHHH......",
    ".....HHH......................E.....................................................E.......................G..",
    "..P.........E.........B..........HHHHHHH.......S.S.....B.....E...........B.....HHHHHHH....S.S.S.........XXXXXXX",
    "XXXXXX...XXXXXXXXXXXXXX..XXXXX..XXXXXXXXXXXXXXXXXXXXXXXX..XXXXXXXXXXXXXXX..XXXXXXXXXXXXXXXXXXXXXXXXX..XXXXXXXX",
  ],
  [
    "................................................................................................................",
    "..............C....................C.C.C.....................................C.C...............................",
    ".............HHH..................HHHHHH....................................HHHHH..............................",
    "........................C.C..............................C.C.C........................C.C.........C.C.C........",
    ".......C.C.............HHHH..............................HHHHH.......................HHHH........HHHHHH........",
    "......HHHH.......E..............E..............E..........................E.................................G..",
    "..P............HHHH....S.S....HHHH....S.S....HHHH.....B.........S.S.S..HHHHHHH....B......S.S.S..........XXXXXXX",
    "XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX...XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX...XXXXXXXX",
  ],
];

/**
 * Levels auf mind. 17 Reihen (= 612 px > Canvas 600 px) auffüllen:
 * Himmel oben, 2 Reihen Erdreich unten — so ragt nie „Nichts" ins Bild.
 */
const MIN_ROWS = 17;
function normalizeLevel(level: string[]): string[] {
  // Erdreich nur unter vorhandenem Boden — Lücken bleiben tödliche Abgründe
  const mask = [...level[level.length - 1]].map((c) => (c === "X" ? "X" : ".")).join("");
  const bottom = [mask, mask];
  const skyRows = Math.max(0, MIN_ROWS - level.length - bottom.length);
  const sky = Array.from({ length: skyRows }, () => "");
  return [...sky, ...level, ...bottom];
}

interface InputState {
  left: boolean;
  right: boolean;
  jumpDown: boolean;
  jumpJustDown: boolean;
}

export class PlatformerScene extends Phaser.Scene {
  private brand!: BrandManifest;
  private level!: string[];
  private player!: Phaser.Physics.Arcade.Sprite;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private enemies!: Phaser.Physics.Arcade.Group;
  private hills!: Phaser.GameObjects.TileSprite;
  private hillsFar!: Phaser.GameObjects.TileSprite;
  private clouds!: Phaser.GameObjects.TileSprite;
  private hearts: Phaser.GameObjects.Image[] = [];
  private spawnPoint = new Phaser.Math.Vector2(64, 64);
  private score = 0;
  private lives = 3;
  private levelIndex = 0;
  private lastGroundedAt = -1e9;
  private jumpBufferedAt = -1e9;
  private jumpHeld = false;
  private invulnerableUntil = 0;
  private levelDone = false;
  private hud!: Phaser.GameObjects.Text;

  constructor() {
    super("platformer");
  }

  init(data: { brand?: BrandManifest; levelIndex?: number; score?: number; lives?: number }) {
    if (data.brand) this.brand = data.brand;
    this.levelIndex = data.levelIndex ?? 0;
    this.score = data.score ?? 0;
    this.lives = data.lives ?? 3;
    this.levelDone = false;
    this.jumpHeld = false;
    this.lastGroundedAt = -1e9;
    this.jumpBufferedAt = -1e9;
    this.invulnerableUntil = 0;
    this.hearts = [];
  }

  preload() {
    preloadAvatar(this, this.brand, "platformer");
    preloadSfx(this, ["jump", "coin", "stomp", "hit", "bounce", "win", "gameover"]);
    preloadMusic(this, "platformer");
    this.load.spritesheet("k-tiles", "assets/platformer/tilemap_packed.png", {
      frameWidth: KENNEY_TILE, frameHeight: KENNEY_TILE,
    });
    this.load.spritesheet("k-chars", "assets/platformer/tilemap-characters_packed.png", {
      frameWidth: KENNEY_CHAR, frameHeight: KENNEY_CHAR,
    });
    this.load.image("k-hills", "assets/platformer/bg-hills.png");
  }

  create() {
    this.physics.world.gravity.y = GRAVITY;
    createAvatar(this, this.brand, "platformer");
    this.makeCloudTexture();

    // Pixel-Look nur hier: knackige Tiles (NEAREST) + Kamera auf ganze Pixel
    // (verhindert Haarlinien zwischen Tiles bei Subpixel-Scroll)
    for (const key of ["k-tiles", "k-chars", "k-hills"]) {
      this.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST);
    }
    this.cameras.main.setRoundPixels(true);

    if (!this.anims.exists("enemy-walk")) {
      this.anims.create({
        key: "enemy-walk",
        frames: ENEMY_FRAMES.map((f) => ({ key: "k-chars", frame: f })),
        frameRate: 6,
        repeat: -1,
      });
    }

    this.level = normalizeLevel(LEVELS[this.levelIndex]);
    const rows = this.level.length;
    const cols = Math.max(...this.level.map((r) => r.length));
    const worldW = cols * TILE;
    const worldH = rows * TILE;
    this.physics.world.setBounds(0, -TILE * 4, worldW, worldH + TILE * 4);
    this.cameras.main.setBounds(0, 0, worldW, worldH);

    this.buildBackground();

    const solids = this.physics.add.staticGroup();
    const coins = this.physics.add.staticGroup();
    const hazards = this.physics.add.staticGroup();
    const pads = this.physics.add.staticGroup();
    this.enemies = this.physics.add.group();
    let goal: Phaser.GameObjects.Rectangle | null = null;

    const tileImg = (cx: number, cy: number, frame: number, depth = 1) =>
      this.add.image(cx, cy, "k-tiles", frame).setScale(TILE / KENNEY_TILE).setDepth(depth);

    const at = (tx: number, ty: number) => this.level[ty]?.[tx] ?? ".";
    const rng = new Phaser.Math.RandomDataGenerator([`level-${this.levelIndex}`]);

    this.level.forEach((row, ty) => {
      for (let tx = 0; tx < row.length; tx++) {
        const ch = row[tx];
        const cx = tx * TILE + TILE / 2;
        const cy = ty * TILE + TILE / 2;
        switch (ch) {
          case "X": {
            const above = at(tx, ty - 1);
            let frame: number;
            if (above === "X") {
              frame = rng.frac() < 0.15 ? T.dirtAlt : T.dirt;
            } else {
              const l = at(tx - 1, ty) === "X";
              const r = at(tx + 1, ty) === "X";
              frame = l && r ? T.grassM : !l && r ? T.grassL : l && !r ? T.grassR : T.grassSingle;
              // Deko auf freien Grasflächen
              if (rng.frac() < 0.22 && at(tx, ty - 1) === "." && at(tx, ty - 2) === ".") {
                tileImg(cx, cy - TILE, T.decor[rng.between(0, T.decor.length - 1)], 0);
              }
            }
            solids.add(tileImg(cx, cy, frame));
            break;
          }
          case "H": {
            const l = at(tx - 1, ty) === "H";
            const r = at(tx + 1, ty) === "H";
            const frame = l && r ? T.hedgeM : !l && r ? T.hedgeL : l && !r ? T.hedgeR : T.hedgeSingle;
            solids.add(tileImg(cx, cy, frame));
            break;
          }
          case "C": {
            const c = tileImg(cx, cy, T.coin, 1);
            coins.add(c);
            this.tweens.add({ targets: c, y: cy - 4, duration: 700, yoyo: true, repeat: -1, ease: "sine.inOut" });
            break;
          }
          case "S": {
            const s = tileImg(cx, cy, T.cactus, 1);
            hazards.add(s);
            (s.body as Phaser.Physics.Arcade.StaticBody).setSize(TILE - 14, TILE - 8).setOffset(7, 8);
            break;
          }
          case "B": {
            const b = tileImg(cx, cy, T.mushroom, 1);
            pads.add(b);
            (b.body as Phaser.Physics.Arcade.StaticBody).setSize(TILE - 8, TILE / 2).setOffset(4, 2);
            break;
          }
          case "E": {
            const e = this.enemies.create(cx, cy, "k-chars", ENEMY_FRAMES[0]) as Phaser.Physics.Arcade.Sprite;
            e.setScale(1.5).play("enemy-walk");
            e.setCollideWorldBounds(true).setVelocityX(ENEMY_SPEED).setBounceX(1);
            (e.body as Phaser.Physics.Arcade.Body).setSize(KENNEY_CHAR - 6, KENNEY_CHAR - 4).setOffset(3, 4);
            break;
          }
          case "G": {
            goal = this.add.rectangle(cx, cy - TILE, 8, TILE * 2.5, 0xf0f0f0).setDepth(1);
            this.add
              .triangle(cx + 4, cy - TILE * 2, 0, 0, 40, 10, 0, 20,
                Phaser.Display.Color.HexStringToColor(this.brand.colors.primary).color)
              .setOrigin(0, 0.5).setDepth(1);
            this.physics.add.existing(goal, true);
            break;
          }
          case "P":
            this.spawnPoint.set(cx, cy);
            break;
        }
      }
    });

    this.player = this.physics.add.sprite(this.spawnPoint.x, this.spawnPoint.y, avatarKey("platformer"));
    this.player.setCollideWorldBounds(true).setDepth(2);
    const pw = this.player.width;
    (this.player.body as Phaser.Physics.Arcade.Body)
      .setMaxVelocityY(950)
      .setSize(pw * 0.7, this.player.height * 0.9);
    this.cameras.main.startFollow(this.player, true, 0.12, 0.12);

    this.physics.add.collider(this.player, solids);
    this.physics.add.collider(this.enemies, solids);
    this.physics.add.overlap(this.player, coins, (_p, coin) => {
      (coin as Phaser.GameObjects.Image).destroy();
      sfx(this, "coin", 0.35);
      this.score += 10;
      this.updateHud();
    });
    this.physics.add.overlap(this.player, hazards, () => this.hitPlayer());
    this.physics.add.overlap(this.player, pads, () => {
      if ((this.player.body as Phaser.Physics.Arcade.Body).velocity.y > -200) sfx(this, "bounce", 0.4);
      this.player.setVelocityY(BOUNCE_PAD_VELOCITY);
      playAvatarAnim(this.player, "platformer", "jump");
    });
    this.physics.add.overlap(this.player, this.enemies, (_p, e) => this.touchEnemy(e as Phaser.Physics.Arcade.Sprite));
    if (goal) this.physics.add.overlap(this.player, goal, () => this.completeLevel());

    // HUD: Text + Kenney-Herzen
    this.hud = this.add
      .text(16, 12, "", { fontFamily: "system-ui, sans-serif", fontSize: "18px", color: "#ffffff" })
      .setShadow(1, 1, "#00000088", 2)
      .setScrollFactor(0)
      .setDepth(10);
    for (let i = 0; i < 3; i++) {
      this.hearts.push(
        this.add.image(this.scale.width - 30 - i * 34, 26, "k-tiles", T.heartFull)
          .setScale(1.6).setScrollFactor(0).setDepth(10)
      );
    }
    this.updateHud();

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.addTouchControls();
    playMusic(this, "platformer", 0.2);
  }

  update(time: number) {
    const sx = this.cameras.main.scrollX;
    this.clouds.tilePositionX = sx * 0.15;
    this.hillsFar.tilePositionX = sx * 0.3;
    this.hills.tilePositionX = sx * 0.5;

    if (this.levelDone) return;
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    const input = this.readInput();

    if (this.player.y > this.physics.world.bounds.bottom - TILE) this.hitPlayer();

    const dt = this.game.loop.delta / 1000;
    const grounded = body.blocked.down;
    const target = (input.left ? -1 : 0) + (input.right ? 1 : 0);
    const control = grounded ? 1 : AIR_CONTROL;
    if (target !== 0) {
      body.velocity.x = Phaser.Math.Linear(
        body.velocity.x,
        target * RUN_SPEED,
        Math.min(1, (ACCEL * control * dt) / RUN_SPEED)
      );
      this.player.setFlipX(target < 0);
      playAvatarAnim(this.player, "platformer", grounded ? "run" : "jump");
    } else {
      body.velocity.x = Phaser.Math.Linear(body.velocity.x, 0, Math.min(1, (DECEL * control * dt) / RUN_SPEED));
      if (grounded) playAvatarAnim(this.player, "platformer", "idle");
    }

    if (grounded) this.lastGroundedAt = time;
    if (input.jumpJustDown) this.jumpBufferedAt = time;
    if (time - this.jumpBufferedAt < JUMP_BUFFER_MS && time - this.lastGroundedAt < COYOTE_MS) {
      body.velocity.y = JUMP_VELOCITY;
      this.jumpBufferedAt = -1e9;
      this.lastGroundedAt = -1e9;
      sfx(this, "jump", 0.3);
      playAvatarAnim(this.player, "platformer", "jump");
    }
    if (!input.jumpDown && body.velocity.y < JUMP_CUT_VELOCITY) body.velocity.y = JUMP_CUT_VELOCITY;
    if (!grounded && body.velocity.y > 100) playAvatarAnim(this.player, "platformer", "fall");

    // Gegner: an Wänden UND Plattformkanten umdrehen
    this.enemies.children.each((obj) => {
      const e = obj as Phaser.Physics.Arcade.Sprite;
      const eb = e.body as Phaser.Physics.Arcade.Body;
      let dir = eb.velocity.x >= 0 ? 1 : -1;
      if (eb.blocked.left) dir = 1;
      else if (eb.blocked.right) dir = -1;
      if (eb.blocked.down && !this.isSolidAt(e.x + dir * 22, e.y + TILE * 0.8)) dir = -dir;
      e.setVelocityX(dir * ENEMY_SPEED);
      e.setFlipX(dir < 0);
      return true;
    });

    this.player.setAlpha(time < this.invulnerableUntil ? 0.4 + 0.3 * Math.sin(time / 40) : 1);
  }

  private isSolidAt(px: number, py: number): boolean {
    const tx = Math.floor(px / TILE);
    const ty = Math.floor(py / TILE);
    const ch = this.level[ty]?.[tx];
    return ch === "X" || ch === "H";
  }

  private touchEnemy(enemy: Phaser.Physics.Arcade.Sprite) {
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    if (body.velocity.y > 60 && this.player.y < enemy.y - 8) {
      this.tweens.add({
        targets: enemy, scaleY: 0.2, alpha: 0, duration: 150,
        onComplete: () => enemy.destroy(),
      });
      (enemy.body as Phaser.Physics.Arcade.Body).enable = false;
      this.player.setVelocityY(STOMP_BOUNCE);
      sfx(this, "stomp", 0.45);
      this.score += 50;
      this.updateHud();
    } else {
      this.hitPlayer();
    }
  }

  private hitPlayer() {
    if (this.time.now < this.invulnerableUntil || this.levelDone) return;
    this.lives -= 1;
    playAvatarAnim(this.player, "platformer", "hit");
    this.cameras.main.shake(150, 0.01);
    this.updateHud();
    if (this.lives <= 0) {
      sfx(this, "gameover", 0.5);
      this.endOverlay("Game Over", () =>
        this.scene.restart({ brand: this.brand, levelIndex: 0, score: 0, lives: 3 })
      );
      return;
    }
    sfx(this, "hit", 0.45);
    this.player.setPosition(this.spawnPoint.x, this.spawnPoint.y).setVelocity(0, 0);
    this.invulnerableUntil = this.time.now + 1500;
  }

  private completeLevel() {
    if (this.levelDone) return;
    this.levelDone = true;
    sfx(this, "win", 0.5);
    playAvatarAnim(this.player, "platformer", "win");
    this.player.setVelocityX(0);
    const next = this.levelIndex + 1;
    if (next < LEVELS.length) {
      this.endOverlay(`Level ${this.levelIndex + 1} geschafft!`, () =>
        this.scene.restart({ brand: this.brand, levelIndex: next, score: this.score, lives: this.lives })
      );
    } else {
      this.endOverlay(`Gewonnen! ${this.score} Punkte`, () =>
        this.scene.restart({ brand: this.brand, levelIndex: 0, score: 0, lives: 3 })
      );
    }
  }

  private endOverlay(text: string, onContinue: () => void) {
    this.levelDone = true;
    const { width, height } = this.scale;
    this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.6).setScrollFactor(0).setDepth(10);
    this.add
      .text(width / 2, height / 2 - 20, text, { fontFamily: "system-ui, sans-serif", fontSize: "36px", color: "#ffffff" })
      .setOrigin(0.5).setScrollFactor(0).setDepth(11);
    this.add
      .text(width / 2, height / 2 + 30, "Tippen / Taste zum Fortfahren", { fontFamily: "system-ui, sans-serif", fontSize: "18px", color: "#cccccc" })
      .setOrigin(0.5).setScrollFactor(0).setDepth(11);
    this.time.delayedCall(600, () => {
      this.input.once("pointerdown", onContinue);
      this.input.keyboard!.once("keydown", onContinue);
    });
  }

  private updateHud() {
    this.hud.setText(`${this.brand.name}  |  Level ${this.levelIndex + 1}/${LEVELS.length}  |  Punkte: ${this.score}`);
    this.hearts.forEach((h, i) => h.setFrame(i < this.lives ? T.heartFull : T.heartEmpty));
  }

  private buildBackground() {
    const { width, height } = this.scale;
    const g = this.add.graphics().setScrollFactor(0).setDepth(-10);
    g.fillGradientStyle(0x77b5e8, 0x77b5e8, 0xd9f0fb, 0xd9f0fb, 1);
    g.fillRect(0, 0, width, height);
    this.add.circle(width * 0.82, height * 0.15, 34, 0xfff3c4).setScrollFactor(0).setDepth(-9);
    this.clouds = this.add
      .tileSprite(width / 2, height * 0.2, width, 120, "cloud-strip")
      .setScrollFactor(0).setDepth(-8).setAlpha(0.9);
    this.hillsFar = this.add
      .tileSprite(width / 2, height - 72, width, 144, "k-hills")
      .setScrollFactor(0).setDepth(-7).setTileScale(2).setAlpha(0.55);
    this.hills = this.add
      .tileSprite(width / 2, height - 90, width, 180, "k-hills")
      .setScrollFactor(0).setDepth(-6).setTileScale(2.5);
  }

  private makeCloudTexture() {
    if (this.textures.exists("cloud-strip")) return;
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0xffffff, 0.9);
    for (const [x, y, r] of [[60, 60, 22], [95, 55, 30], [130, 62, 20], [300, 40, 18], [330, 36, 26], [362, 44, 17], [460, 75, 20], [488, 70, 26]]) {
      g.fillCircle(x, y, r);
    }
    g.generateTexture("cloud-strip", 512, 120);
    g.destroy();
  }

  private readInput(): InputState {
    const jumpKey = this.cursors.up.isDown || this.cursors.space.isDown;
    const touchJump = !!this.registry.get("touch-jump");
    const jumpDown = jumpKey || touchJump;
    const jumpJustDown = jumpDown && !this.jumpHeld;
    this.jumpHeld = jumpDown;
    return {
      left: this.cursors.left.isDown || !!this.registry.get("touch-left"),
      right: this.cursors.right.isDown || !!this.registry.get("touch-right"),
      jumpDown,
      jumpJustDown,
    };
  }

  private addTouchControls() {
    this.input.addPointer(2);
    const apply = () => {
      let left = false, right = false, jump = false;
      const third = this.scale.width / 3;
      for (const p of [this.input.pointer1, this.input.pointer2, this.input.activePointer]) {
        if (!p || !p.isDown) continue;
        if (p.x < third) left = true;
        else if (p.x > third * 2) right = true;
        else jump = true;
      }
      this.registry.set("touch-left", left);
      this.registry.set("touch-right", right);
      this.registry.set("touch-jump", jump);
    };
    this.input.on("pointerdown", apply);
    this.input.on("pointermove", apply);
    this.input.on("pointerup", apply);
  }
}
