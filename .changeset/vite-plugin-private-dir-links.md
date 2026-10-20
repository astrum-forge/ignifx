---
"@ignifx/vite-plugin": patch
---

Keep the editor-private `.ignifx/` directory out of `vite build` output and off `vite dev` and `vite preview` when reached through a symbolic link or a copy in `publicDir`; such a build now fails with `IGX-0556`.
