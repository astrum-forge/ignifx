---
"@ignifx/vite-plugin": patch
---

Never serve the editor's private `.ignifx/` directory: `vite dev` and `vite preview` answer 404 to every form of a request into it, and `server.fs.deny` lists it.
