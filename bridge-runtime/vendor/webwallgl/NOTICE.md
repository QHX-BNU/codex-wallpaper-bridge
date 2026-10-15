# Third-party renderer notices

WebWallGL 2.1.0, MIT, Copyright (c) 2026 oneincase.
Source: https://github.com/oneincase/webwallgl/tree/4ba71c406fbc78f24c99b1bb1edd9d9cef9793c8
License: `LICENSE`. Included we-scene code: MIT, Copyright (c) 2026 aurora-wallpaper contributors, `we-scene-LICENSE`.

Renderer artifacts are unmodified bytes from https://github.com/elysia395/dsh-wallpaper-engine/tree/111816a4fc7ae29acf4fce4ed134b84557424515/lib/webwallgl
Their declared upstream is the WebWallGL commit above. Artifact reproduction was not performed in this wave. `vendor-lock.json` pins the exact bytes, source repositories and versions. Only the standalone engine artifacts are included, not the DSH plugin/host code.

The renderer bundles **Mediabunny 1.56.0**, Copyright (c) 2026-present Vanilagy and contributors, under **MPL-2.0**, not MIT.
License: `mediabunny-LICENSE`. The unmodified published source is included as `sources/mediabunny-1.56.0.tgz` (the package contains `src/` and its original license headers); its original npm SHA-512 integrity and SHA-256 are recorded in the lock.
Source repository: https://github.com/Vanilagy/mediabunny
Versioned source package: https://registry.npmjs.org/mediabunny/-/mediabunny-1.56.0.tgz
The archive is shipped with the renderer so recipients have the corresponding MPL-covered source without fetching from the network. No MPL-covered source was modified for this integration.

Wallpaper Engine project files, textures, packages, and official assets are **not** distributed here. They are consumed read-only from the user's registered local scene project.
