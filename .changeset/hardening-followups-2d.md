---
"@ignifx/2d": patch
---

A sprite clip's `from`/`to` is documented as the atlas **index** range it is

`from`/`to` resolves both endpoints to atlas indices and plays every index between them, so a range
whose endpoints are not adjacent in the sheet plays whatever the packer put in between — and `to`
before `from` plays the range backwards. The TSDoc, the `ignifx.spriteanimation` schema descriptions
(and therefore the generated format page), and the 2D skill now say so, and point at the explicit
`frames` list for a run that is not contiguous. The generated page also lists the per-clip and
per-frame fields, which it previously showed only as `array`. No behaviour changed; a unit test now
pins the resolution rules.
