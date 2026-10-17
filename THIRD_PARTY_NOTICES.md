# Third-Party Notices

JADEVEIL is an independent, non-commercial fan project. This file lists every third-party
work the repository depends on, references or is inspired by, and states what is — and is
not — included.

## Bundled software

| Component | Version | License | Location |
|---|---|---|---|
| three.js (core + used addons) | r186 (0.186.1) | MIT | `vendor/three/` — license text in `vendor/three/LICENSE` |

## Bundled audio

| Asset | Author | License | Location |
|---|---|---|---|
| Impact Sounds (break, place, footsteps, jump, land) | Kenney.nl | CC0 1.0 | `audio/sfx/` |
| Interface Sounds (UI) | Kenney.nl | CC0 1.0 | `audio/sfx/ui_*` |
| Water Step Splashes (*Yo Frankie!*) | Blender Foundation | CC-BY 3.0 | `audio/sfx/splash_*` |

Full credits: [`audio/CREDITS.md`](audio/CREDITS.md). No background music is distributed;
earlier music experiments were removed from the working tree and from the git history.

## Characters, designs and trademarks (not bundled as assets)

- **JJ** — a character from Maizen's animated Minecraft series. The in-game skin is a fan
  recreation painted procedurally in code (`src/player/skin.js`); no original skin files or
  artwork are included.
- **Minecraft** and the **Ender Dragon** — © Mojang Studios / Microsoft. The dragon's
  geometry follows the publicly known layout of the original model and its texture is generated
  procedurally (`src/mount/dragonModel.js`); no Mojang assets are included. "Minecraft" is a
  trademark of Mojang Synergies AB.
- **World of Warcraft: Mists of Pandaria** — © Blizzard Entertainment. Public concept art was
  used only as an art-direction reference (see `docs/ART_DIRECTION.md`). No Blizzard assets,
  textures, models or audio are included in the repository or its history.

## Original work

All other source code, procedurally generated textures, documentation and screenshots were
created for this project. No license is granted for the original work at this time; all rights
are reserved by the author.

JADEVEIL is not affiliated with, sponsored by or endorsed by Mojang Studios, Microsoft, Maizen
or Blizzard Entertainment.
