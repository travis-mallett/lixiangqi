# Theme packs

The appearance system has one canonical server-owned registry:
`modules/pref/src/main/Appearance.scala`. It defines the available UI themes,
backgrounds, boards, piece sets, sound-effect packs, music packs, and the theme
packs that compose them.

## Persistence model

`Pref.appearance` is the only persisted appearance preference. Named packs store
only their pack key; their component values are resolved from the registry when
the preference is read. This keeps a selected pack authoritative when its
definition evolves. A custom combination stores its selected component keys,
custom background URL, and board display settings.

The database reader intentionally does not translate the retired `bg`, `theme`,
`pieceSet`, `soundSet`, or 3D appearance fields. Documents without the canonical
`appearance` object start with the Dark pack. Once a preference is saved, the
replacement document contains only the canonical appearance representation.

## Asset layout

Reusable assets stay grouped by asset type rather than duplicated inside packs:

- `public/images/background/<asset>`
- `public/images/board/<format>/<asset>`
- `public/piece/<piece-set>/<piece>`
- `public/sound/<sound-or-music-set>/<asset>`

A theme pack references catalog keys. It does not copy assets. This lets several
packs share a board or sound set and keeps filenames, display metadata, and
selection validation centralized.

## Adding a component

1. Place its files in the matching asset directory.
2. Add one catalog entry in `Appearance.scala`.
3. If it is a UI theme, add `_theme.<key>.scss` and import it from the theme CSS
   bundles. Scope its variables under `html.<key>`.
4. Add the component key to any theme packs that should select it.

The Dasher JSON is generated from the catalogs, so registered components appear
in Custom Combination without a second client-side list. Board image and
coordinate metadata, plus every piece-to-CSS-variable mapping, are also supplied
by the registry; UI theme preview colors come from the same source. No board,
piece, or preview catalog is duplicated in SCSS or TypeScript.

## Runtime ownership

The server renders the selected appearance into HTML classes, data attributes,
CSS variables, preload tags, and piece URLs. The Dasher applies the same state
live and persists each custom change through the canonical preference fields.
The main Sound pane remains a shortcut for shared volume and for enabling or
disabling the selected sound-effect/music packs; `none` is the disabled value,
so both surfaces always remain synchronized.
