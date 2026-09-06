# @ignifx/ui

`@ignifx/ui` public barrel: the DOM overlay host and its layers, the three scaling modes, input
focus routing, `WorldAnchor`, the three text components on Babylon Lite's text renderer, the
touch, menu and dialog helpers, and `app.i18n` (`docs/architecture/13-ui.md`). Explicit named
re-exports only — no `export *` (coding standards §4).

## Classes

### Dialog

A modal panel with a title, a message, and buttons.

#### Constructors

##### Constructor

> **new Dialog**(`host`, `options?`): [`Dialog`](#dialog)

Builds the dialog and mounts it hidden.

###### Parameters

###### host

[`UiHost`](#uihost)

The overlay host, normally `app.ui`.

###### options?

[`DialogOptions`](#dialogoptions) = `{}`

The title, the message, the buttons, and the layer.

###### Returns

[`Dialog`](#dialog)

#### Accessors

##### element

###### Get Signature

> **get** **element**(): `HTMLDivElement` \| `null`

The dialog's outermost element, so a template can restyle it or mount more into it.

###### Returns

`HTMLDivElement` \| `null`

The element, or `null` when the app has no DOM overlay.

##### isVisible

###### Get Signature

> **get** **isVisible**(): `boolean`

Whether the dialog is shown.

###### Returns

`boolean`

`true` while it is on screen.

##### onChosen

###### Get Signature

> **get** **onChosen**(): `SignalLike`\<`string`\>

Emitted with a button's `id` when it is pressed. The dialog does not hide itself; the game
decides, because "Cancel" and "Delete everything" want different follow-ups.

###### Returns

`SignalLike`\<`string`\>

The signal.

##### onDismissed

###### Get Signature

> **get** **onDismissed**(): `SignalLike`

Emitted after [Dialog.hide](#hide), whatever caused it.

###### Returns

`SignalLike`

The signal.

#### Methods

##### dispose()

> **dispose**(): `void`

Removes the dialog and unsubscribes.

###### Returns

`void`

##### hide()

> **hide**(): `void`

Hides the dialog and emits [Dialog.onDismissed](#ondismissed).

###### Returns

`void`

##### setButtons()

> **setButtons**(`buttons`): `void`

Replaces the buttons.

###### Parameters

###### buttons

readonly [`DialogButton`](#dialogbutton)[]

The buttons, left to right. An empty list leaves the row empty.

###### Returns

`void`

###### Remarks

One dialog re-used for every question is cheaper than one dialog per question and keeps the
stacking predictable, so the buttons have to be able to change: a confirmation asks
"Yes"/"No", a save error offers "Retry"/"Cancel", and a locale change relabels both.

###### Example

```ts ignore-check
dialog.setMessage("Delete this save?");
dialog.setButtons([{ id: "no", label: "No" }, { id: "yes", label: "Yes" }]);
```

##### setMessage()

> **setMessage**(`text`): `void`

Replaces the body text, if the dialog was built with one.

###### Parameters

###### text

`string`

The new message.

###### Returns

`void`

##### setTitle()

> **setTitle**(`text`): `void`

Replaces the heading, if the dialog was built with one.

###### Parameters

###### text

`string`

The new heading.

###### Returns

`void`

##### show()

> **show**(): `void`

Shows the dialog.

###### Returns

`void`

***

### HudText

Pixel-space HUD text.

#### Example

```ts
const label = app.world.createEntity("score").addComponent(HudText);
label.font = app.assets.load<FontAsset>("ui/Inter-Regular.ttf");
label.anchor = "topLeft";
label.position = { x: 16, y: 16 };
label.i18nKey = "hud.score";
```

#### Extends

- [`TextComponent`](#abstract-textcomponent)

#### Implements

- `ComponentHooks`

#### Constructors

##### Constructor

> **new HudText**(): [`HudText`](#hudtext)

Builds a HUD label with the schema's defaults.

###### Returns

[`HudText`](#hudtext)

###### Overrides

[`TextComponent`](#abstract-textcomponent).[`constructor`](#constructor-5)

#### Properties

##### align

> **align**: `"left"` \| `"center"` \| `"right"`

Which edge the lines align to.

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`align`](#align-1)

##### allowMultiple

> `static` **allowMultiple**: `boolean` = `false`

One HUD label per entity; a second belongs on a second entity.

##### anchor

> **anchor**: `"top"` \| `"left"` \| `"center"` \| `"right"` \| `"topLeft"` \| `"topRight"` \| `"bottomLeft"` \| `"bottom"` \| `"bottomRight"`

Which point of the render target [HudText.position](#position) is measured from.

##### color

> **color**: `ColorLike`

The colour every glyph starts with.

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`color`](#color-1)

##### font

> **font**: `AssetHandle`\<`FontAsset`\> \| `null`

The TTF or OTF the glyphs come from.

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`font`](#font-1)

##### fontSize

> **fontSize**: `number`

The em size, in render-target pixels.

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`fontSize`](#fontsize-2)

##### i18nKey

> **i18nKey**: `string`

A translation key looked up in `app.i18n`; wins over [TextComponent.text](#text-2).

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`i18nKey`](#i18nkey-1)

##### lineHeight

> **lineHeight**: `number`

The line-height multiplier.

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`lineHeight`](#lineheight-1)

##### maxWidth

> **maxWidth**: `number`

The wrap width, in render-target pixels; `0` does not wrap.

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`maxWidth`](#maxwidth-1)

##### opacity

> **opacity**: `number`

The whole-block alpha multiplier.

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`opacity`](#opacity-1)

##### order

> **order**: `number`

The sort order within the text renderer; lower draws first.

##### position

> **position**: `Vec2Like`

The offset from the anchor, in render-target pixels; x grows right, y grows down.

##### schema

> `static` **schema**: `Schema`

The declarative fields (ADR-0004).

##### text

> **text**: `string`

The literal string to draw; ignored when [TextComponent.i18nKey](#i18nkey-1) is set.

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`text`](#text-2)

##### typeId

> `static` **typeId**: `string` = `"ignifx/HudText"`

The registration id the serializer writes into scene files.

#### Accessors

##### app

###### Get Signature

> **get** **app**(): `App`

The app that owns the world.

###### Returns

`App`

The app.

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`app`](#app-1)

##### enabled

###### Get Signature

> **get** **enabled**(): `boolean`

The component's own enabled flag; `true` by default. Setting it runs the enable or disable
transition (`docs/architecture/01-lifecycle-and-time.md` §6): `onDisable` runs immediately,
`awake`/`onEnable` run in the next lifecycle flush — or immediately and nested when the change
happens inside a callback.

###### Returns

`boolean`

`true` when the component's own flag is set.

###### Set Signature

> **set** **enabled**(`value`): `void`

###### Parameters

###### value

`boolean`

###### Returns

`void`

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`enabled`](#enabled-7)

##### entity

###### Get Signature

> **get** **entity**(): `Entity`

The entity this component is attached to.

###### Returns

`Entity`

The owning entity.

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`entity`](#entity-1)

##### handle

###### Get Signature

> **get** **handle**(): `ComponentHandle`

The dense runtime handle; invalid after destruction.

###### Returns

`ComponentHandle`

The handle.

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`handle`](#handle-1)

##### isDestroyed

###### Get Signature

> **get** **isDestroyed**(): `boolean`

`true` from the moment `destroy()` is called, long before the destroy flush runs.

###### Returns

`boolean`

`true` once the component has been queued for destruction.

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`isDestroyed`](#isdestroyed-1)

##### isEnabledInHierarchy

###### Get Signature

> **get** **isEnabledInHierarchy**(): `boolean`

`true` when the component's own flag is set **and** its entity is active in the hierarchy.

###### Returns

`boolean`

`true` when the component is effectively enabled.

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`isEnabledInHierarchy`](#isenabledinhierarchy-1)

##### lite

###### Get Signature

> **get** **lite**(): `object`

The Babylon Lite objects the component owns. Unstable escape hatch
(`docs/architecture/00-overview.md` §3).

###### Returns

`object`

The text layer, or `null` before the first frame that had a font and a string.

###### layer

> `readonly` **layer**: `TextLayer` \| `null`

##### metrics

###### Get Signature

> **get** **metrics**(): [`TextMetrics`](#textmetrics)

The block's laid-out size, in render-target pixels.

###### Remarks

`{ width: 0, height: 0 }` until the block exists. This is Lite's only text measurement, and
it is what a caller centring a block on the screen needs — Lite's `align` aligns lines against
each other, not against the screen.

###### Example

```ts
const label = entity.addComponent(HudText);
label.metrics.width; // 0 until a font and a string are set
```

###### Returns

[`TextMetrics`](#textmetrics)

The size.

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`metrics`](#metrics-1)

##### onDestroyed

###### Get Signature

> **get** **onDestroyed**(): `Signal`\<`Component`\>

Emitted once when the component is destroyed, in the destroy flush. Connecting with
`{ owner: this }` elsewhere uses it to detach handlers automatically
(`docs/architecture/02-scene-graph.md` §8).

###### Returns

`Signal`\<`Component`\>

The signal. It is created on first access, so a component nobody listens to allocates
nothing.

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`onDestroyed`](#ondestroyed-1)

##### transform

###### Get Signature

> **get** **transform**(): `Transform`

The entity's transform — sugar for `this.entity.transform`, the most-used lookup there is.

###### Returns

`Transform`

The entity's transform.

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`transform`](#transform-1)

##### uid

###### Get Signature

> **get** **uid**(): `string`

The stable ULID; the key files use to reference this component.

###### Returns

`string`

The identifier.

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`uid`](#uid-1)

##### world

###### Get Signature

> **get** **world**(): `World`

The world the entity belongs to.

###### Returns

`World`

The world.

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`world`](#world-1)

#### Methods

##### define()

> `static` **define**\<`S`\>(`schema`): `ComponentDefinition`\<`S`\>

Declares a component's serialized fields and returns the base class to extend (ADR-0004,
`docs/architecture/03-scripting-and-components.md` §3). The returned class exposes every field
as a typed instance property, applies the defaults in its constructor, and carries the schema
for the serializer, the inspector, and the docs harness.

###### Type Parameters

###### S

`S` *extends* `Readonly`\<`Record`\<`string`, `FieldDefinition`\<`unknown`\>\>\>

The schema being declared.

###### Parameters

###### schema

`S`

The field definitions, keyed by the property name they become.

###### Returns

`ComponentDefinition`\<`S`\>

An abstract class to extend.

###### Throws

IgnifxError with code `IGX-0607` when a field name is not identifier-like or collides
with a `Component`/`Script` member.

###### Example

```ts
class Spinner extends Component.define({
  degreesPerSecond: f32(90, { min: -360, max: 360 }),
  axis: vec3({ x: 0, y: 1, z: 0 }),
}) {
  static typeId = "mygame/Spinner";
}
```

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`define`](#define-1)

##### destroy()

> **destroy**(): `void`

Queues this component for destruction. It stays usable until the destroy flush of the current
frame, but reports `isDestroyed === true` immediately
(`docs/architecture/01-lifecycle-and-time.md` §6). Calling it twice is a no-op.

###### Returns

`void`

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`destroy`](#destroy-1)

##### getComponent()

> **getComponent**\<`T`\>(`type`): `T` \| `null`

Finds another component on the same entity — sugar for `this.entity.getComponent`.

###### Type Parameters

###### T

`T` *extends* `Component`

The component type to look for.

###### Parameters

###### type

`ComponentType`\<`T`\>

The component class; matching is by class identity **and** inheritance.

###### Returns

`T` \| `null`

The first match in attach order, or `null`.

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`getComponent`](#getcomponent-1)

##### onDetach()

> **onDetach**(): `void`

Drops the layer and the block when the component goes away.

###### Returns

`void`

###### Implementation of

`ComponentHooks.onDetach`

##### requireComponent()

> **requireComponent**\<`T`\>(`type`): `T`

Finds another component on the same entity, requiring it to be there — the supported way to
link components (`docs/architecture/03-scripting-and-components.md` §8).

###### Type Parameters

###### T

`T` *extends* `Component`

The component type to look for.

###### Parameters

###### type

`ComponentType`\<`T`\>

The component class.

###### Returns

`T`

The first match in attach order.

###### Throws

IgnifxError with code `IGX-0201` when the entity has no such component.

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`requireComponent`](#requirecomponent-1)

##### resolveText()

> **resolveText**(`i18n`): `string`

The string that will actually be drawn: the translated `i18nKey`, or `text`.

###### Parameters

###### i18n

[`I18nService`](#i18nservice) \| `null`

The localization service, or `null` when the app has none.

###### Returns

`string`

The resolved string.

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`resolveText`](#resolvetext-1)

***

### I18nService

The localization service, reached as `app.i18n`.

#### Example

```ts
await app.i18n.load(app.assets.load<LocaleAsset>("ui/strings.i18n.json"));
app.i18n.locale = "fr";
app.i18n.t("hud.lives", { count: 3 });
```

#### Accessors

##### availableLocales

###### Get Signature

> **get** **availableLocales**(): readonly `string`[]

Every locale any loaded document declares, sorted.

###### Returns

readonly `string`[]

The BCP 47 tags.

##### fallbackLocale

###### Get Signature

> **get** **fallbackLocale**(): `string`

The locale a key falls back to when the active locale has no entry for it. Set from the first
document's `defaultLocale`.

###### Returns

`string`

The BCP 47 tag.

###### Set Signature

> **set** **fallbackLocale**(`value`): `void`

###### Parameters

###### value

`string`

###### Returns

`void`

##### locale

###### Get Signature

> **get** **locale**(): `string`

The active locale. Writing a locale no loaded document declares throws `IGX-1303`, because a
silent no-op there is a bug that only shows up as untranslated text much later.

###### Throws

IgnifxError with code `IGX-1303` when no loaded document declares the tag.

###### Returns

`string`

The BCP 47 tag.

###### Set Signature

> **set** **locale**(`value`): `void`

###### Parameters

###### value

`string`

###### Returns

`void`

##### onLocaleChanged

###### Get Signature

> **get** **onLocaleChanged**(): `SignalLike`\<`string`\>

Emitted after [I18nService.locale](#locale) changed. UI that caches rendered strings — `HudText`
does — redraws from here.

###### Returns

`SignalLike`\<`string`\>

The signal.

#### Methods

##### has()

> **has**(`key`): `boolean`

Whether the active locale, or the fallback, has an entry for a key.

###### Parameters

###### key

`string`

The message key.

###### Returns

`boolean`

`true` when [I18nService.t](#t) will find a message.

##### load()

> **load**(`source`): `Promise`\<`void`\>

Merges a translation document into the service.

###### Parameters

###### source

[`LocaleAsset`](#localeasset) \| `AssetHandle`\<[`LocaleAsset`](#localeasset)\>

A loaded document, or its handle.

###### Returns

`Promise`\<`void`\>

A promise that settles once the document has been merged.

###### Remarks

Accepts a loaded [LocaleAsset](#localeasset) or the handle of one, in which case the merge happens when
the handle settles. Later loads win on a repeated key, which is what makes a per-locale
download or a downloadable language pack work. The first document loaded also sets
[I18nService.fallbackLocale](#fallbacklocale) and, when the app is still on its starting locale and the
document does not declare it, moves the active locale to the document's `defaultLocale`.

###### Example

```ts
using strings = app.assets.load<LocaleAsset>("ui/strings.i18n.json");
await app.i18n.load(strings);
```

##### t()

> **t**(`key`, `params?`): `string`

Renders a message.

###### Parameters

###### key

`string`

The message key.

###### params?

[`MessageParams`](#messageparams) = `NO_PARAMS`

The values `{name}` placeholders and plural selectors read.

###### Returns

`string`

The rendered message, or the key itself when no document declares it.

###### Example

```ts
app.i18n.t("hud.lives", { count: 1 }); // "1 life"
app.i18n.t("hud.lives", { count: 4 }); // "4 lives"
```

***

### LoadingScreen

A full-overlay loading panel.

#### Example

```ts
const screen = new LoadingScreen(app.ui, { label: "Loading…" });
screen.bindTo(app.assets);
await app.assets.preloadGroup("boot").promise;
screen.hide();
```

#### Constructors

##### Constructor

> **new LoadingScreen**(`host`, `options?`): [`LoadingScreen`](#loadingscreen)

Builds the screen and mounts it.

###### Parameters

###### host

[`UiHost`](#uihost)

The overlay host, normally `app.ui`.

###### options?

[`LoadingScreenOptions`](#loadingscreenoptions) = `{}`

The layer, the label, and the initial visibility.

###### Returns

[`LoadingScreen`](#loadingscreen)

#### Accessors

##### element

###### Get Signature

> **get** **element**(): `HTMLDivElement` \| `null`

The screen's outermost element, so a template can restyle it or add a logo.

###### Returns

`HTMLDivElement` \| `null`

The element, or `null` when the app has no DOM overlay.

##### isVisible

###### Get Signature

> **get** **isVisible**(): `boolean`

Whether the screen is shown.

###### Returns

`boolean`

`true` while it is on screen.

##### onDismissed

###### Get Signature

> **get** **onDismissed**(): `SignalLike`

Emitted after [LoadingScreen.hide](#hide-1), whatever caused it.

###### Returns

`SignalLike`

The signal.

##### progress

###### Get Signature

> **get** **progress**(): `number`

How far along the bar is, in `[0, 1]`. Writing it moves the bar; values outside the range are
clamped.

###### Returns

`number`

The fraction.

###### Set Signature

> **set** **progress**(`value`): `void`

###### Parameters

###### value

`number`

###### Returns

`void`

#### Methods

##### bindTo()

> **bindTo**(`assets`): `Disconnect`

Follows an asset service's aggregate progress until [LoadingScreen.dispose](#dispose-1) or a second
call to this method.

###### Parameters

###### assets

`Assets`

The asset service, normally `app.assets`.

###### Returns

`Disconnect`

A function that stops following.

##### dispose()

> **dispose**(): `void`

Removes the screen and stops following the asset service.

###### Returns

`void`

##### hide()

> **hide**(): `void`

Hides the screen and emits [LoadingScreen.onDismissed](#ondismissed-1).

###### Returns

`void`

##### setLabel()

> **setLabel**(`text`): `void`

Replaces the label.

###### Parameters

###### text

`string`

The new label.

###### Returns

`void`

##### show()

> **show**(): `void`

Shows the screen.

###### Returns

`void`

***

### LocaleAsset

A loaded translation document (`docs/architecture/05-assets-and-loading.md` §5).

#### Remarks

Pure data: it loads identically under Node and in a browser and has nothing to release.

#### Example

```ts
const strings = await app.assets.loadAsync<LocaleAsset>("ui/strings.i18n.json");
strings.value.availableLocales; // ["en", "fr"]
```

#### Properties

##### address

> `readonly` **address**: `string`

The address the document was loaded from.

##### assetType

> `static` **assetType**: `string` = `I18N_ASSET_TYPE`

The type name the asset service registers translation documents under.

##### document

> `readonly` **document**: [`LocaleDocument`](#localedocument)

The parsed document.

#### Accessors

##### availableLocales

###### Get Signature

> **get** **availableLocales**(): readonly `string`[]

Every locale the document declares, sorted.

###### Returns

readonly `string`[]

The BCP 47 tags.

***

### Menu

A panel of selectable rows in an overlay layer.

#### Example

```ts ignore-check
const pause = new Menu(app.ui, { id: "pause", title: "Paused" });
pause.setRows([
  { kind: "action", id: "resume", label: "Resume", activate: () => pause.hide() },
  { kind: "slider", id: "music", label: "Music", min: 0, max: 1, step: 0.05,
    get: () => music.volume, set: (v) => { music.volume = v; },
    format: (v) => `${String(Math.round(v * 100))}%` },
]);
pause.show();
```

#### Constructors

##### Constructor

> **new Menu**(`host`, `options`): [`Menu`](#menu)

Builds the panel and mounts it, hidden unless `options.visible` says otherwise.

###### Parameters

###### host

[`UiHost`](#uihost)

The overlay host, normally `app.ui`.

###### options

[`MenuOptions`](#menuoptions)

The id, the heading, the layer, and the starting rows.

###### Returns

[`Menu`](#menu)

#### Properties

##### id

> `readonly` **id**: `string`

The id the menu was built with.

#### Accessors

##### cancelable

###### Get Signature

> **get** **cancelable**(): `boolean`

Whether Escape and [Menu.cancel](#cancel) back out of this menu. A title screen sets it `false`.

###### Returns

`boolean`

`true` when the menu can be dismissed.

###### Set Signature

> **set** **cancelable**(`value`): `void`

###### Parameters

###### value

`boolean`

###### Returns

`void`

##### element

###### Get Signature

> **get** **element**(): `HTMLDivElement` \| `null`

The panel element, so a game can restyle it or a test can read it.

###### Returns

`HTMLDivElement` \| `null`

The element, or `null` under an app with no DOM overlay.

##### isVisible

###### Get Signature

> **get** **isVisible**(): `boolean`

Whether the panel is on screen.

###### Returns

`boolean`

`true` between [Menu.show](#show-2) and [Menu.hide](#hide-2).

##### keyboardEnabled

###### Get Signature

> **get** **keyboardEnabled**(): `boolean`

Whether the widget reads the keyboard itself.

###### Returns

`boolean`

`true` while its own `keydown` handler acts.

###### Set Signature

> **set** **keyboardEnabled**(`value`): `void`

###### Parameters

###### value

`boolean`

###### Returns

`void`

##### onActivated

###### Get Signature

> **get** **onActivated**(): `SignalLike`\<[`MenuRow`](#menurow)\>

Emitted with the row that was activated, after its own handler ran.

###### Returns

`SignalLike`\<[`MenuRow`](#menurow)\>

The signal.

##### onBack

###### Get Signature

> **get** **onBack**(): `SignalLike`

Emitted by [Menu.cancel](#cancel) — Escape, the pad's east button, or a call — when the menu is
[Menu.cancelable](#cancelable). A [MenuStack](#menustack) connects `pop` to it.

###### Returns

`SignalLike`

The signal.

##### onSelectionChanged

###### Get Signature

> **get** **onSelectionChanged**(): `SignalLike`\<[`MenuRow`](#menurow)\>

Emitted with the newly selected row whenever the selection moves, from any device. A game
connects a click sound to it.

###### Returns

`SignalLike`\<[`MenuRow`](#menurow)\>

The signal.

##### rows

###### Get Signature

> **get** **rows**(): readonly [`MenuRow`](#menurow)[]

The rows the menu is drawing.

###### Returns

readonly [`MenuRow`](#menurow)[]

The rows, in draw order.

##### selected

###### Get Signature

> **get** **selected**(): [`MenuRow`](#menurow) \| `null`

The selected row.

###### Returns

[`MenuRow`](#menurow) \| `null`

The row under the selection, or `null` when nothing can be selected.

##### selectedIndex

###### Get Signature

> **get** **selectedIndex**(): `number`

Where the selection sits.

###### Returns

`number`

The index into [Menu.rows](#rows).

#### Methods

##### activateSelection()

> **activateSelection**(): `void`

Runs the selected row's activate behaviour.

###### Returns

`void`

##### adjustSelection()

> **adjustSelection**(`direction`): `void`

Runs the selected row's Left or Right behaviour: a slider moves by one step, a toggle flips,
and a choice advances.

###### Parameters

###### direction

`-1` \| `1`

`-1` for left, `1` for right.

###### Returns

`void`

##### cancel()

> **cancel**(): `boolean`

Backs out of the menu, if it is [Menu.cancelable](#cancelable).

###### Returns

`boolean`

`true` when [Menu.onBack](#onback) was emitted, so the caller knows the press was used.

##### dispose()

> **dispose**(): `void`

Removes the panel from the overlay and unsubscribes everything.

###### Returns

`void`

##### hide()

> **hide**(): `void`

Hides the panel.

###### Returns

`void`

##### moveSelection()

> **moveSelection**(`delta`): `void`

Moves the selection, skipping headings, separators and disabled rows.

###### Parameters

###### delta

`-1` \| `1`

`-1` for up, `1` for down.

###### Returns

`void`

##### refresh()

> **refresh**(): `void`

Re-reads every label and value and redraws the selection.

###### Returns

`void`

##### select()

> **select**(`id`): `boolean`

Puts the selection on a row by id.

###### Parameters

###### id

`string`

The row's [MenuRowBase.id](#id-7).

###### Returns

`boolean`

`true` when a selectable row with that id was found.

##### setRows()

> **setRows**(`rows`): `void`

Replaces the rows and rebuilds the panel.

###### Parameters

###### rows

readonly [`MenuRow`](#menurow)[]

The rows, in draw order.

###### Returns

`void`

###### Remarks

Rebuilding rather than diffing is deliberate: the row list changes when a save appears, when a
control scheme changes and when the locale changes, and a menu of at most a few dozen rows is
not worth a reconciler. The selection stays on the same row id when that id is still present.

##### show()

> **show**(): `void`

Shows the panel, puts the selection on the first row that can take it, and focuses the list.

###### Returns

`void`

***

### MenuStack

A stack of [Menu](#menu) screens, innermost last.

#### Example

```ts ignore-check
const stack = new MenuStack({ navigation });
stack.push(title);
// in a script that runs while paused:
stack.update(app.time.unscaledDeltaTime);
```

#### Constructors

##### Constructor

> **new MenuStack**(`options?`): [`MenuStack`](#menustack)

Builds an empty stack.

###### Parameters

###### options?

[`MenuStackOptions`](#menustackoptions) = `{}`

The controls to read, and the repeat timings.

###### Returns

[`MenuStack`](#menustack)

#### Accessors

##### bottom

###### Get Signature

> **get** **bottom**(): [`Menu`](#menu) \| `null`

The menu at the bottom, which is the one the stack was opened with.

###### Returns

[`Menu`](#menu) \| `null`

The first menu pushed, or `null` when the stack is empty.

##### depth

###### Get Signature

> **get** **depth**(): `number`

How deep the stack is.

###### Returns

`number`

The number of menus on it.

##### isOpen

###### Get Signature

> **get** **isOpen**(): `boolean`

Whether any menu is open.

###### Returns

`boolean`

`true` while the stack is not empty.

##### menus

###### Get Signature

> **get** **menus**(): readonly [`Menu`](#menu)[]

The menus on the stack, outermost first.

###### Returns

readonly [`Menu`](#menu)[]

The menus, in push order.

##### onActivated

###### Get Signature

> **get** **onActivated**(): `SignalLike`\<[`MenuRow`](#menurow)\>

Emitted with the row that was activated on the top menu.

###### Returns

`SignalLike`\<[`MenuRow`](#menurow)\>

The signal.

##### onChanged

###### Get Signature

> **get** **onChanged**(): `SignalLike`\<[`Menu`](#menu) \| `null`\>

Emitted with the new top menu — `null` when the stack empties — whenever the stack changes. A
game connects its audio ducking and its pause state to it.

###### Returns

`SignalLike`\<[`Menu`](#menu) \| `null`\>

The signal.

##### onSelectionChanged

###### Get Signature

> **get** **onSelectionChanged**(): `SignalLike`\<[`MenuRow`](#menurow)\>

Emitted with the newly selected row whenever the selection moves on the top menu.

###### Returns

`SignalLike`\<[`MenuRow`](#menurow)\>

The signal.

##### suspended

###### Get Signature

> **get** **suspended**(): `boolean`

Whether [MenuStack.update](#update) is reading its controls.

###### Remarks

Set it while something modal is on top of the menu — a confirmation `Dialog`, or a rebind that
is listening for the next key — so that the same press does not reach both.

###### Returns

`boolean`

`true` while navigation is suspended.

###### Set Signature

> **set** **suspended**(`value`): `void`

###### Parameters

###### value

`boolean`

###### Returns

`void`

##### top

###### Get Signature

> **get** **top**(): [`Menu`](#menu) \| `null`

The menu on top, which is the visible one.

###### Returns

[`Menu`](#menu) \| `null`

The top menu, or `null` when the stack is empty.

#### Methods

##### closeAll()

> **closeAll**(): `void`

Closes every menu on the stack.

###### Returns

`void`

##### dispose()

> **dispose**(): `void`

Drops every subscription. The menus themselves belong to the game and are not disposed.

###### Returns

`void`

##### pop()

> **pop**(): [`Menu`](#menu) \| `null`

Closes the top menu and shows the one underneath.

###### Returns

[`Menu`](#menu) \| `null`

The menu that was closed, or `null` when the stack was already empty.

##### push()

> **push**(`menu`): `void`

Hides whatever is on top and shows `menu` over it.

###### Parameters

###### menu

[`Menu`](#menu)

The menu to open.

###### Returns

`void`

##### refresh()

> **refresh**(): `void`

Re-reads every label on every menu on the stack, for a locale change.

###### Returns

`void`

##### update()

> **update**(`unscaledDelta`): `void`

Reads the navigation controls and applies them to the top menu.

###### Parameters

###### unscaledDelta

`number`

Seconds since the last call, on the unscaled clock.

###### Returns

`void`

###### Remarks

Call it from a script that declares `static updateWhenPaused = true`, with
`app.time.unscaledDeltaTime`: a menu that repeats a held direction has to keep time while the
game is stopped, and scaled time is pinned at zero while it is.

***

### `abstract` TextComponent

The base of `HudText`, `WorldText2D`, and `WorldText`: the schema fields and the shaped block.

#### Remarks

Abstract, and never registered as a component itself; the three concrete classes are.

#### Extends

- `Component`

#### Extended by

- [`HudText`](#hudtext)
- [`WorldText`](#worldtext)
- [`WorldText2D`](#worldtext2d)

#### Constructors

##### Constructor

> **new TextComponent**(): [`TextComponent`](#abstract-textcomponent)

Creates a component. The engine constructs components; game code never calls `new`.

###### Returns

[`TextComponent`](#abstract-textcomponent)

###### Inherited from

`Component.constructor`

#### Properties

##### align

> **align**: `"left"` \| `"center"` \| `"right"`

Which edge the lines align to.

##### color

> **color**: `ColorLike`

The colour every glyph starts with.

##### font

> **font**: `AssetHandle`\<`FontAsset`\> \| `null`

The TTF or OTF the glyphs come from.

##### fontSize

> **fontSize**: `number`

The em size, in render-target pixels.

##### i18nKey

> **i18nKey**: `string`

A translation key looked up in `app.i18n`; wins over [TextComponent.text](#text-2).

##### lineHeight

> **lineHeight**: `number`

The line-height multiplier.

##### maxWidth

> **maxWidth**: `number`

The wrap width, in render-target pixels; `0` does not wrap.

##### opacity

> **opacity**: `number`

The whole-block alpha multiplier.

##### text

> **text**: `string`

The literal string to draw; ignored when [TextComponent.i18nKey](#i18nkey-1) is set.

#### Accessors

##### app

###### Get Signature

> **get** **app**(): `App`

The app that owns the world.

###### Returns

`App`

The app.

###### Inherited from

`Component.app`

##### enabled

###### Get Signature

> **get** **enabled**(): `boolean`

The component's own enabled flag; `true` by default. Setting it runs the enable or disable
transition (`docs/architecture/01-lifecycle-and-time.md` §6): `onDisable` runs immediately,
`awake`/`onEnable` run in the next lifecycle flush — or immediately and nested when the change
happens inside a callback.

###### Returns

`boolean`

`true` when the component's own flag is set.

###### Set Signature

> **set** **enabled**(`value`): `void`

###### Parameters

###### value

`boolean`

###### Returns

`void`

###### Inherited from

`Component.enabled`

##### entity

###### Get Signature

> **get** **entity**(): `Entity`

The entity this component is attached to.

###### Returns

`Entity`

The owning entity.

###### Inherited from

`Component.entity`

##### handle

###### Get Signature

> **get** **handle**(): `ComponentHandle`

The dense runtime handle; invalid after destruction.

###### Returns

`ComponentHandle`

The handle.

###### Inherited from

`Component.handle`

##### isDestroyed

###### Get Signature

> **get** **isDestroyed**(): `boolean`

`true` from the moment `destroy()` is called, long before the destroy flush runs.

###### Returns

`boolean`

`true` once the component has been queued for destruction.

###### Inherited from

`Component.isDestroyed`

##### isEnabledInHierarchy

###### Get Signature

> **get** **isEnabledInHierarchy**(): `boolean`

`true` when the component's own flag is set **and** its entity is active in the hierarchy.

###### Returns

`boolean`

`true` when the component is effectively enabled.

###### Inherited from

`Component.isEnabledInHierarchy`

##### metrics

###### Get Signature

> **get** **metrics**(): [`TextMetrics`](#textmetrics)

The block's laid-out size, in render-target pixels.

###### Remarks

`{ width: 0, height: 0 }` until the block exists. This is Lite's only text measurement, and
it is what a caller centring a block on the screen needs — Lite's `align` aligns lines against
each other, not against the screen.

###### Example

```ts
const label = entity.addComponent(HudText);
label.metrics.width; // 0 until a font and a string are set
```

###### Returns

[`TextMetrics`](#textmetrics)

The size.

##### onDestroyed

###### Get Signature

> **get** **onDestroyed**(): `Signal`\<`Component`\>

Emitted once when the component is destroyed, in the destroy flush. Connecting with
`{ owner: this }` elsewhere uses it to detach handlers automatically
(`docs/architecture/02-scene-graph.md` §8).

###### Returns

`Signal`\<`Component`\>

The signal. It is created on first access, so a component nobody listens to allocates
nothing.

###### Inherited from

`Component.onDestroyed`

##### transform

###### Get Signature

> **get** **transform**(): `Transform`

The entity's transform — sugar for `this.entity.transform`, the most-used lookup there is.

###### Returns

`Transform`

The entity's transform.

###### Inherited from

`Component.transform`

##### uid

###### Get Signature

> **get** **uid**(): `string`

The stable ULID; the key files use to reference this component.

###### Returns

`string`

The identifier.

###### Inherited from

`Component.uid`

##### world

###### Get Signature

> **get** **world**(): `World`

The world the entity belongs to.

###### Returns

`World`

The world.

###### Inherited from

`Component.world`

#### Methods

##### define()

> `static` **define**\<`S`\>(`schema`): `ComponentDefinition`\<`S`\>

Declares a component's serialized fields and returns the base class to extend (ADR-0004,
`docs/architecture/03-scripting-and-components.md` §3). The returned class exposes every field
as a typed instance property, applies the defaults in its constructor, and carries the schema
for the serializer, the inspector, and the docs harness.

###### Type Parameters

###### S

`S` *extends* `Readonly`\<`Record`\<`string`, `FieldDefinition`\<`unknown`\>\>\>

The schema being declared.

###### Parameters

###### schema

`S`

The field definitions, keyed by the property name they become.

###### Returns

`ComponentDefinition`\<`S`\>

An abstract class to extend.

###### Throws

IgnifxError with code `IGX-0607` when a field name is not identifier-like or collides
with a `Component`/`Script` member.

###### Example

```ts
class Spinner extends Component.define({
  degreesPerSecond: f32(90, { min: -360, max: 360 }),
  axis: vec3({ x: 0, y: 1, z: 0 }),
}) {
  static typeId = "mygame/Spinner";
}
```

###### Inherited from

`Component.define`

##### destroy()

> **destroy**(): `void`

Queues this component for destruction. It stays usable until the destroy flush of the current
frame, but reports `isDestroyed === true` immediately
(`docs/architecture/01-lifecycle-and-time.md` §6). Calling it twice is a no-op.

###### Returns

`void`

###### Inherited from

`Component.destroy`

##### getComponent()

> **getComponent**\<`T`\>(`type`): `T` \| `null`

Finds another component on the same entity — sugar for `this.entity.getComponent`.

###### Type Parameters

###### T

`T` *extends* `Component`

The component type to look for.

###### Parameters

###### type

`ComponentType`\<`T`\>

The component class; matching is by class identity **and** inheritance.

###### Returns

`T` \| `null`

The first match in attach order, or `null`.

###### Inherited from

`Component.getComponent`

##### requireComponent()

> **requireComponent**\<`T`\>(`type`): `T`

Finds another component on the same entity, requiring it to be there — the supported way to
link components (`docs/architecture/03-scripting-and-components.md` §8).

###### Type Parameters

###### T

`T` *extends* `Component`

The component type to look for.

###### Parameters

###### type

`ComponentType`\<`T`\>

The component class.

###### Returns

`T`

The first match in attach order.

###### Throws

IgnifxError with code `IGX-0201` when the entity has no such component.

###### Inherited from

`Component.requireComponent`

##### resolveText()

> **resolveText**(`i18n`): `string`

The string that will actually be drawn: the translated `i18nKey`, or `text`.

###### Parameters

###### i18n

[`I18nService`](#i18nservice) \| `null`

The localization service, or `null` when the app has none.

###### Returns

`string`

The resolved string.

***

### Toast

A stack of transient messages.

#### Example

```ts
const toasts = new Toast(app.ui);
toasts.show("Checkpoint reached");
// in the update of a script that declares `static updateWhenPaused = true`:
toasts.advance(app.time.unscaledDeltaTime);
```

#### Constructors

##### Constructor

> **new Toast**(`host`, `options?`): [`Toast`](#toast)

Builds the stack and mounts it.

###### Parameters

###### host

[`UiHost`](#uihost)

The overlay host, normally `app.ui`.

###### options?

[`ToastOptions`](#toastoptions) = `{}`

The layer, the default duration, and the stack depth.

###### Returns

[`Toast`](#toast)

#### Accessors

##### element

###### Get Signature

> **get** **element**(): `HTMLDivElement` \| `null`

The stack element, so a template can reposition it.

###### Returns

`HTMLDivElement` \| `null`

The element, or `null` when the app has no DOM overlay.

##### messages

###### Get Signature

> **get** **messages**(): readonly `string`[]

The messages currently on screen, oldest first.

###### Returns

readonly `string`[]

The texts.

##### onDismissed

###### Get Signature

> **get** **onDismissed**(): `SignalLike`\<`string`\>

Emitted with a message's text when it times out or is pushed off the stack.

###### Returns

`SignalLike`\<`string`\>

The signal.

#### Methods

##### advance()

> **advance**(`deltaSeconds`): `void`

Advances every message's timer.

###### Parameters

###### deltaSeconds

`number`

Seconds elapsed since the previous call; `dt` from a script's `update`, or
`app.time.unscaledDeltaTime` when the toast has to expire while the game is paused.

###### Returns

`void`

###### Remarks

Nothing calls this for you. The script that does must declare `static updateWhenPaused = true`
if toasts are to expire while the game is paused — a menu's "Saved" message is shown from a
paused game, and an ordinary script gets no `update` there.

##### clear()

> **clear**(): `void`

Removes every message at once.

###### Returns

`void`

##### dispose()

> **dispose**(): `void`

Removes the stack and unsubscribes.

###### Returns

`void`

##### show()

> **show**(`text`, `duration?`): `void`

Shows a message.

###### Parameters

###### text

`string`

The message.

###### duration?

`number`

How long it stays up, in seconds; defaults to the stack's own duration.

###### Returns

`void`

***

### UiHost

The DOM overlay host, reached as `app.ui`.

#### Example

```ts
const hud = app.ui.layer("hud");
app.ui.scaling = "fit";
app.ui.referenceResolution = [640, 360];
```

#### Accessors

##### isActive

###### Get Signature

> **get** **isActive**(): `boolean`

Whether there is a DOM overlay at all. `false` under a headless app, an `OffscreenCanvas`, or a
detached canvas — the three cases in which every other member is a no-op.

###### Returns

`boolean`

`true` when [UiHost.root](#root-1) is an element.

##### keyboardHasFocus

###### Get Signature

> **get** **keyboardHasFocus**(): `boolean`

Whether a text field currently owns the keyboard — the same value the host writes into
`app.input.uiHasFocus`.

###### Returns

`boolean`

`true` while typing must not fire keyboard actions.

##### layers

###### Get Signature

> **get** **layers**(): readonly [`UiLayer`](#uilayer)[]

Every layer, back to front.

###### Returns

readonly [`UiLayer`](#uilayer)[]

The layers, ordered by `zIndex`.

##### layout

###### Get Signature

> **get** **layout**(): [`UiLayout`](#uilayout)

The root's current size, scale, and offset, in the units the scaling mode chose.

###### Returns

[`UiLayout`](#uilayout)

The layout last computed.

##### onLayoutChanged

###### Get Signature

> **get** **onLayoutChanged**(): `SignalLike`\<[`UiLayout`](#uilayout)\>

Emitted after every recomputation that changed the layout: a canvas resize, a device-pixel-ratio
change, or a write to [UiHost.scaling](#scaling) or [UiHost.referenceResolution](#referenceresolution).

###### Returns

`SignalLike`\<[`UiLayout`](#uilayout)\>

The signal.

##### pixelMapping

###### Get Signature

> **get** **pixelMapping**(): [`UiPixelMapping`](#uipixelmapping)

The conversion from render-target pixels — the space `Camera.worldToScreen`, `HudText`, and
`app.renderer.captureScreenshot()` work in — to UI units.

###### Returns

[`UiPixelMapping`](#uipixelmapping)

The mapping last computed.

##### pointerOverUi

###### Get Signature

> **get** **pointerOverUi**(): `boolean`

Whether a pointer is currently pressed on an interactive element of the overlay.

###### Remarks

A click on a UI element never reaches gameplay in the first place: `@ignifx/input` reads
`pointerdown` and `wheel` from the **canvas** (`packages/input/src/dom/pointer-source.ts`), and
the overlay root is the canvas's sibling rather than its child, so a press that lands on a
`pointer-events: auto` element is not on the canvas and is never queued. This flag covers the
remaining case: `pointermove` and `pointerup` are read from the **window**, so a drag that
started on a slider still moves `<Pointer>/delta`. A camera script that must ignore that reads
this flag.

###### Returns

`boolean`

`true` while at least one pointer is down on the overlay.

##### referenceResolution

###### Get Signature

> **get** **referenceResolution**(): readonly `number`[]

The `[width, height]` the `"fit"` mode scales to. Writing it recomputes the layout.

###### Returns

readonly `number`[]

A copy of the current reference resolution.

###### Set Signature

> **set** **referenceResolution**(`value`): `void`

###### Parameters

###### value

readonly `number`[]

###### Returns

`void`

##### root

###### Get Signature

> **get** **root**(): `HTMLDivElement` \| `null`

The overlay root: an absolutely positioned `<div>` covering the canvas, `pointer-events: none`.

###### Returns

`HTMLDivElement` \| `null`

The root, or `null` when the app has no DOM overlay.

##### scaling

###### Get Signature

> **get** **scaling**(): `"css"` \| `"fit"` \| `"dpi"`

How the overlay's coordinate system relates to the canvas. Writing it recomputes the layout
immediately.

###### Returns

`"css"` \| `"fit"` \| `"dpi"`

The current mode.

###### Set Signature

> **set** **scaling**(`value`): `void`

###### Parameters

###### value

`"css"` \| `"fit"` \| `"dpi"`

###### Returns

`void`

##### visible

###### Get Signature

> **get** **visible**(): `boolean`

Whether the whole overlay is shown. Per-layer visibility is `app.ui.layer(name).visible`.

###### Returns

`boolean`

`true` while the overlay is shown.

###### Set Signature

> **set** **visible**(`value`): `void`

###### Parameters

###### value

`boolean`

###### Returns

`void`

#### Methods

##### layer()

> **layer**(`name`, `options?`): [`UiLayer`](#uilayer)

Returns the named layer, creating it the first time it is asked for.

###### Parameters

###### name

`string`

The layer name.

###### options?

[`UiLayerOptions`](#uilayeroptions)

The stacking order and the initial visibility, used only on creation.

###### Returns

[`UiLayer`](#uilayer)

The layer.

###### Example

```ts
const menu = app.ui.layer("menu", { zIndex: 100 });
```

##### refresh()

> **refresh**(): `void`

Re-measures the canvas and rewrites the root's geometry.

###### Returns

`void`

###### Remarks

Called by the `ResizeObserver`, by the window's `resize` event — which is what a
device-pixel-ratio change fires — and by every write to a scaling property. Games call it after
changing the canvas's size by hand. A recomputation that produces the same layout writes
nothing and emits nothing.

***

### UiLayer

A named layer of the overlay.

#### Example

```ts
const hud = app.ui.layer("hud");
hud.element?.append(document.createElement("div"));
hud.visible = false;
```

#### Properties

##### name

> `readonly` **name**: `string`

The name the layer is addressed by.

#### Accessors

##### element

###### Get Signature

> **get** **element**(): `HTMLDivElement` \| `null`

The layer's element, or `null` when the app has no DOM overlay.

###### Returns

`HTMLDivElement` \| `null`

The `<div>` a game mounts its tree into.

##### visible

###### Get Signature

> **get** **visible**(): `boolean`

Whether the layer is shown. Hiding a layer hides everything mounted in it without unmounting
anything, which is what a pause menu wants.

###### Returns

`boolean`

`true` while the layer is shown.

###### Set Signature

> **set** **visible**(`value`): `void`

###### Parameters

###### value

`boolean`

###### Returns

`void`

##### zIndex

###### Get Signature

> **get** **zIndex**(): `number`

The layer's stacking order within the root.

###### Returns

`number`

The `z-index`.

###### Set Signature

> **set** **zIndex**(`value`): `void`

###### Parameters

###### value

`number`

###### Returns

`void`

#### Methods

##### clear()

> **clear**(): `void`

Removes every child of the layer without removing the layer itself.

###### Returns

`void`

###### Remarks

A no-op under a headless app.

***

### UiSystem

Projects world anchors and re-shapes text once per frame.

#### Implements

- `System`

#### Properties

##### name

> `readonly` **name**: `"ignifx/ui-sync"` = `"ignifx/ui-sync"`

The name diagnostics and error reports use.

###### Implementation of

`System.name`

#### Methods

##### onWorldCreated()

> **onWorldCreated**(`_world`): `void`

Builds the overlay, now that the engine and its canvas exist.

###### Parameters

###### \_world

`World`

The new world, which the overlay does not need.

###### Returns

`void`

###### Remarks

This is the only hook that fires inside `createApp` **after** the Lite engine was created:
`register` runs before it, and `onStart` runs only when a game calls `app.start()`, which a
headless tool never does. `@ignifx/2d` uses the same hook for the same reason.

###### Implementation of

`System.onWorldCreated`

##### update()

> **update**(`ctx`): `void`

Runs one frame's synchronisation.

###### Parameters

###### ctx

`SystemContext`

The world, clock, phase, and delta.

###### Returns

`void`

###### Implementation of

`System.update`

***

### VirtualButton

An on-screen button.

#### Example

```ts
const jump = new VirtualButton(app, { control: "jump", label: "A" });
```

#### Constructors

##### Constructor

> **new VirtualButton**(`app`, `options`): [`VirtualButton`](#virtualbutton)

Builds the widget and mounts it.

###### Parameters

###### app

`App`

The running app; `app.ui` and `app.input.devices.virtual` are the parts used.

###### options

[`VirtualButtonOptions`](#virtualbuttonoptions)

The control name, the label, the layer, and the placement styles.

###### Returns

[`VirtualButton`](#virtualbutton)

###### Throws

IgnifxError with code `IGX-1305` when `@ignifx/input` is not registered.

#### Accessors

##### control

###### Get Signature

> **get** **control**(): `string`

The control this button writes.

###### Returns

`string`

The name, as it appears after `<Virtual>/`.

##### element

###### Get Signature

> **get** **element**(): `HTMLButtonElement` \| `null`

The button element, so a template can restyle or reposition it.

###### Returns

`HTMLButtonElement` \| `null`

The element, or `null` when the app has no DOM overlay.

##### isPressed

###### Get Signature

> **get** **isPressed**(): `boolean`

Whether the button is currently held.

###### Returns

`boolean`

`true` while it is pressed.

#### Methods

##### dispose()

> **dispose**(): `void`

Removes the widget, unsubscribes, and releases the control.

###### Returns

`void`

***

### VirtualJoystick

An on-screen thumbstick.

#### Example

```ts
const stick = new VirtualJoystick(app, { control: "joystick" });
// later
stick.dispose();
```

#### Constructors

##### Constructor

> **new VirtualJoystick**(`app`, `options?`): [`VirtualJoystick`](#virtualjoystick)

Builds the widget and mounts it.

###### Parameters

###### app

`App`

The running app; `app.ui` and `app.input.devices.virtual` are the parts used.

###### options?

[`VirtualJoystickOptions`](#virtualjoystickoptions) = `{}`

The control name, the layer, the geometry, and the placement styles.

###### Returns

[`VirtualJoystick`](#virtualjoystick)

###### Throws

IgnifxError with code `IGX-1305` when `@ignifx/input` is not registered.

#### Accessors

##### control

###### Get Signature

> **get** **control**(): `string`

The control this stick writes.

###### Returns

`string`

The name, as it appears after `<Virtual>/`.

##### element

###### Get Signature

> **get** **element**(): `HTMLDivElement` \| `null`

The pad element, so a template can restyle or reposition it.

###### Returns

`HTMLDivElement` \| `null`

The element, or `null` when the app has no DOM overlay.

##### isActive

###### Get Signature

> **get** **isActive**(): `boolean`

Whether a pointer currently holds the stick.

###### Returns

`boolean`

`true` while the stick is being dragged.

#### Methods

##### dispose()

> **dispose**(): `void`

Removes the widget, unsubscribes, and centres the control.

###### Returns

`void`

***

### WorldAnchor

An entity-to-element anchor.

#### Example

```ts
const tag = document.createElement("div");
tag.textContent = "Boss";
app.ui.layer("hud").element?.append(tag);

const anchor = enemy.addComponent(WorldAnchor);
anchor.element = tag;
anchor.offset = { x: 0, y: 2, z: 0 };
```

#### Extends

- `Component`

#### Implements

- `ComponentHooks`

#### Constructors

##### Constructor

> **new WorldAnchor**(): [`WorldAnchor`](#worldanchor)

Builds an anchor with the schema's defaults.

###### Returns

[`WorldAnchor`](#worldanchor)

###### Overrides

`Component.constructor`

#### Properties

##### allowMultiple

> `static` **allowMultiple**: `boolean` = `false`

One anchored element per entity.

##### clampToScreen

> **clampToScreen**: `boolean`

Whether the element is kept inside the overlay's bounds instead of being hidden off-screen.

##### element

> **element**: `HTMLElement` \| `null` = `null`

The element to position. Not serialised — a DOM node cannot be — so a scene file carries the
flags and the game assigns the element in `awake`.

##### hideWhenBehindCamera

> **hideWhenBehindCamera**: `boolean`

Whether the element is hidden when the anchor point is behind the camera.

##### maxScale

> **maxScale**: `number`

The largest scale distance scaling may produce.

##### minScale

> **minScale**: `number`

The smallest scale distance scaling may produce.

##### offset

> **offset**: `Vec3Like`

A world-space offset added to the entity's position before projecting, in metres.

##### referenceDistance

> **referenceDistance**: `number`

The distance at which [WorldAnchor.scaleWithDistance](#scalewithdistance-1) produces a scale of `1`, in metres.

##### scaleWithDistance

> **scaleWithDistance**: `boolean`

Whether the element shrinks with distance.

##### schema

> `static` **schema**: `Schema`

The declarative fields (ADR-0004).

##### typeId

> `static` **typeId**: `string` = `"ignifx/WorldAnchor"`

The registration id the serializer writes into scene files.

#### Accessors

##### app

###### Get Signature

> **get** **app**(): `App`

The app that owns the world.

###### Returns

`App`

The app.

###### Inherited from

`Component.app`

##### enabled

###### Get Signature

> **get** **enabled**(): `boolean`

The component's own enabled flag; `true` by default. Setting it runs the enable or disable
transition (`docs/architecture/01-lifecycle-and-time.md` §6): `onDisable` runs immediately,
`awake`/`onEnable` run in the next lifecycle flush — or immediately and nested when the change
happens inside a callback.

###### Returns

`boolean`

`true` when the component's own flag is set.

###### Set Signature

> **set** **enabled**(`value`): `void`

###### Parameters

###### value

`boolean`

###### Returns

`void`

###### Inherited from

`Component.enabled`

##### entity

###### Get Signature

> **get** **entity**(): `Entity`

The entity this component is attached to.

###### Returns

`Entity`

The owning entity.

###### Inherited from

`Component.entity`

##### handle

###### Get Signature

> **get** **handle**(): `ComponentHandle`

The dense runtime handle; invalid after destruction.

###### Returns

`ComponentHandle`

The handle.

###### Inherited from

`Component.handle`

##### isDestroyed

###### Get Signature

> **get** **isDestroyed**(): `boolean`

`true` from the moment `destroy()` is called, long before the destroy flush runs.

###### Returns

`boolean`

`true` once the component has been queued for destruction.

###### Inherited from

`Component.isDestroyed`

##### isEnabledInHierarchy

###### Get Signature

> **get** **isEnabledInHierarchy**(): `boolean`

`true` when the component's own flag is set **and** its entity is active in the hierarchy.

###### Returns

`boolean`

`true` when the component is effectively enabled.

###### Inherited from

`Component.isEnabledInHierarchy`

##### onDestroyed

###### Get Signature

> **get** **onDestroyed**(): `Signal`\<`Component`\>

Emitted once when the component is destroyed, in the destroy flush. Connecting with
`{ owner: this }` elsewhere uses it to detach handlers automatically
(`docs/architecture/02-scene-graph.md` §8).

###### Returns

`Signal`\<`Component`\>

The signal. It is created on first access, so a component nobody listens to allocates
nothing.

###### Inherited from

`Component.onDestroyed`

##### placement

###### Get Signature

> **get** **placement**(): `Readonly`\<[`AnchorPlacement`](#anchorplacement)\>

Where the element was placed on the last synchronised frame.

###### Returns

`Readonly`\<[`AnchorPlacement`](#anchorplacement)\>

The placement; `visible` is `false` before the first sync.

##### transform

###### Get Signature

> **get** **transform**(): `Transform`

The entity's transform — sugar for `this.entity.transform`, the most-used lookup there is.

###### Returns

`Transform`

The entity's transform.

###### Inherited from

`Component.transform`

##### uid

###### Get Signature

> **get** **uid**(): `string`

The stable ULID; the key files use to reference this component.

###### Returns

`string`

The identifier.

###### Inherited from

`Component.uid`

##### world

###### Get Signature

> **get** **world**(): `World`

The world the entity belongs to.

###### Returns

`World`

The world.

###### Inherited from

`Component.world`

#### Methods

##### define()

> `static` **define**\<`S`\>(`schema`): `ComponentDefinition`\<`S`\>

Declares a component's serialized fields and returns the base class to extend (ADR-0004,
`docs/architecture/03-scripting-and-components.md` §3). The returned class exposes every field
as a typed instance property, applies the defaults in its constructor, and carries the schema
for the serializer, the inspector, and the docs harness.

###### Type Parameters

###### S

`S` *extends* `Readonly`\<`Record`\<`string`, `FieldDefinition`\<`unknown`\>\>\>

The schema being declared.

###### Parameters

###### schema

`S`

The field definitions, keyed by the property name they become.

###### Returns

`ComponentDefinition`\<`S`\>

An abstract class to extend.

###### Throws

IgnifxError with code `IGX-0607` when a field name is not identifier-like or collides
with a `Component`/`Script` member.

###### Example

```ts
class Spinner extends Component.define({
  degreesPerSecond: f32(90, { min: -360, max: 360 }),
  axis: vec3({ x: 0, y: 1, z: 0 }),
}) {
  static typeId = "mygame/Spinner";
}
```

###### Inherited from

`Component.define`

##### destroy()

> **destroy**(): `void`

Queues this component for destruction. It stays usable until the destroy flush of the current
frame, but reports `isDestroyed === true` immediately
(`docs/architecture/01-lifecycle-and-time.md` §6). Calling it twice is a no-op.

###### Returns

`void`

###### Inherited from

`Component.destroy`

##### getComponent()

> **getComponent**\<`T`\>(`type`): `T` \| `null`

Finds another component on the same entity — sugar for `this.entity.getComponent`.

###### Type Parameters

###### T

`T` *extends* `Component`

The component type to look for.

###### Parameters

###### type

`ComponentType`\<`T`\>

The component class; matching is by class identity **and** inheritance.

###### Returns

`T` \| `null`

The first match in attach order, or `null`.

###### Inherited from

`Component.getComponent`

##### onDetach()

> **onDetach**(): `void`

Hides the element when the component goes away, so an orphaned tag does not linger.

###### Returns

`void`

###### Implementation of

`ComponentHooks.onDetach`

##### requireComponent()

> **requireComponent**\<`T`\>(`type`): `T`

Finds another component on the same entity, requiring it to be there — the supported way to
link components (`docs/architecture/03-scripting-and-components.md` §8).

###### Type Parameters

###### T

`T` *extends* `Component`

The component type to look for.

###### Parameters

###### type

`ComponentType`\<`T`\>

The component class.

###### Returns

`T`

The first match in attach order.

###### Throws

IgnifxError with code `IGX-0201` when the entity has no such component.

###### Inherited from

`Component.requireComponent`

***

### WorldText

World-space 3D text.

#### Example

```ts
const sign = app.world.createEntity("sign").addComponent(WorldText);
sign.font = app.assets.load<FontAsset>("ui/Inter-Regular.ttf");
sign.text = "Danger";
sign.billboard = true;
```

#### Extends

- [`TextComponent`](#abstract-textcomponent)

#### Implements

- `ComponentHooks`

#### Constructors

##### Constructor

> **new WorldText**(): [`WorldText`](#worldtext)

Builds a sign with the schema's defaults.

###### Returns

[`WorldText`](#worldtext)

###### Overrides

[`TextComponent`](#abstract-textcomponent).[`constructor`](#constructor-5)

#### Properties

##### align

> **align**: `"left"` \| `"center"` \| `"right"`

Which edge the lines align to.

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`align`](#align-1)

##### allowMultiple

> `static` **allowMultiple**: `boolean` = `false`

One sign per entity.

##### alwaysOnTop

> **alwaysOnTop**: `boolean`

Whether the text draws through geometry in front of it.

##### billboard

> **billboard**: `boolean`

Whether the text turns to face the camera instead of following the entity's rotation.

##### color

> **color**: `ColorLike`

The colour every glyph starts with.

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`color`](#color-1)

##### font

> **font**: `AssetHandle`\<`FontAsset`\> \| `null`

The TTF or OTF the glyphs come from.

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`font`](#font-1)

##### fontSize

> **fontSize**: `number`

The em size, in render-target pixels.

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`fontSize`](#fontsize-2)

##### i18nKey

> **i18nKey**: `string`

A translation key looked up in `app.i18n`; wins over [TextComponent.text](#text-2).

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`i18nKey`](#i18nkey-1)

##### lineHeight

> **lineHeight**: `number`

The line-height multiplier.

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`lineHeight`](#lineheight-1)

##### maxWidth

> **maxWidth**: `number`

The wrap width, in render-target pixels; `0` does not wrap.

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`maxWidth`](#maxwidth-1)

##### offset

> **offset**: `Vec3Like`

A local offset added to the entity's world position, in metres.

##### opacity

> **opacity**: `number`

The whole-block alpha multiplier.

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`opacity`](#opacity-1)

##### pixelsPerUnit

> **pixelsPerUnit**: `number`

How many pixels of laid-out text span one world metre.

##### schema

> `static` **schema**: `Schema`

The declarative fields (ADR-0004).

##### text

> **text**: `string`

The literal string to draw; ignored when [TextComponent.i18nKey](#i18nkey-1) is set.

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`text`](#text-2)

##### typeId

> `static` **typeId**: `string` = `"ignifx/WorldText"`

The registration id the serializer writes into scene files.

#### Accessors

##### app

###### Get Signature

> **get** **app**(): `App`

The app that owns the world.

###### Returns

`App`

The app.

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`app`](#app-1)

##### enabled

###### Get Signature

> **get** **enabled**(): `boolean`

The component's own enabled flag; `true` by default. Setting it runs the enable or disable
transition (`docs/architecture/01-lifecycle-and-time.md` §6): `onDisable` runs immediately,
`awake`/`onEnable` run in the next lifecycle flush — or immediately and nested when the change
happens inside a callback.

###### Returns

`boolean`

`true` when the component's own flag is set.

###### Set Signature

> **set** **enabled**(`value`): `void`

###### Parameters

###### value

`boolean`

###### Returns

`void`

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`enabled`](#enabled-7)

##### entity

###### Get Signature

> **get** **entity**(): `Entity`

The entity this component is attached to.

###### Returns

`Entity`

The owning entity.

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`entity`](#entity-1)

##### handle

###### Get Signature

> **get** **handle**(): `ComponentHandle`

The dense runtime handle; invalid after destruction.

###### Returns

`ComponentHandle`

The handle.

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`handle`](#handle-1)

##### isDestroyed

###### Get Signature

> **get** **isDestroyed**(): `boolean`

`true` from the moment `destroy()` is called, long before the destroy flush runs.

###### Returns

`boolean`

`true` once the component has been queued for destruction.

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`isDestroyed`](#isdestroyed-1)

##### isEnabledInHierarchy

###### Get Signature

> **get** **isEnabledInHierarchy**(): `boolean`

`true` when the component's own flag is set **and** its entity is active in the hierarchy.

###### Returns

`boolean`

`true` when the component is effectively enabled.

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`isEnabledInHierarchy`](#isenabledinhierarchy-1)

##### lite

###### Get Signature

> **get** **lite**(): `object`

The Babylon Lite objects the component owns. Unstable escape hatch.

###### Returns

`object`

The renderable, or `null` before the first frame that had a font and a string.

###### renderable

> `readonly` **renderable**: `TextRenderable` \| `null`

##### metrics

###### Get Signature

> **get** **metrics**(): [`TextMetrics`](#textmetrics)

The block's laid-out size, in render-target pixels.

###### Remarks

`{ width: 0, height: 0 }` until the block exists. This is Lite's only text measurement, and
it is what a caller centring a block on the screen needs — Lite's `align` aligns lines against
each other, not against the screen.

###### Example

```ts
const label = entity.addComponent(HudText);
label.metrics.width; // 0 until a font and a string are set
```

###### Returns

[`TextMetrics`](#textmetrics)

The size.

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`metrics`](#metrics-1)

##### onDestroyed

###### Get Signature

> **get** **onDestroyed**(): `Signal`\<`Component`\>

Emitted once when the component is destroyed, in the destroy flush. Connecting with
`{ owner: this }` elsewhere uses it to detach handlers automatically
(`docs/architecture/02-scene-graph.md` §8).

###### Returns

`Signal`\<`Component`\>

The signal. It is created on first access, so a component nobody listens to allocates
nothing.

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`onDestroyed`](#ondestroyed-1)

##### transform

###### Get Signature

> **get** **transform**(): `Transform`

The entity's transform — sugar for `this.entity.transform`, the most-used lookup there is.

###### Returns

`Transform`

The entity's transform.

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`transform`](#transform-1)

##### uid

###### Get Signature

> **get** **uid**(): `string`

The stable ULID; the key files use to reference this component.

###### Returns

`string`

The identifier.

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`uid`](#uid-1)

##### world

###### Get Signature

> **get** **world**(): `World`

The world the entity belongs to.

###### Returns

`World`

The world.

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`world`](#world-1)

#### Methods

##### define()

> `static` **define**\<`S`\>(`schema`): `ComponentDefinition`\<`S`\>

Declares a component's serialized fields and returns the base class to extend (ADR-0004,
`docs/architecture/03-scripting-and-components.md` §3). The returned class exposes every field
as a typed instance property, applies the defaults in its constructor, and carries the schema
for the serializer, the inspector, and the docs harness.

###### Type Parameters

###### S

`S` *extends* `Readonly`\<`Record`\<`string`, `FieldDefinition`\<`unknown`\>\>\>

The schema being declared.

###### Parameters

###### schema

`S`

The field definitions, keyed by the property name they become.

###### Returns

`ComponentDefinition`\<`S`\>

An abstract class to extend.

###### Throws

IgnifxError with code `IGX-0607` when a field name is not identifier-like or collides
with a `Component`/`Script` member.

###### Example

```ts
class Spinner extends Component.define({
  degreesPerSecond: f32(90, { min: -360, max: 360 }),
  axis: vec3({ x: 0, y: 1, z: 0 }),
}) {
  static typeId = "mygame/Spinner";
}
```

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`define`](#define-1)

##### destroy()

> **destroy**(): `void`

Queues this component for destruction. It stays usable until the destroy flush of the current
frame, but reports `isDestroyed === true` immediately
(`docs/architecture/01-lifecycle-and-time.md` §6). Calling it twice is a no-op.

###### Returns

`void`

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`destroy`](#destroy-1)

##### getComponent()

> **getComponent**\<`T`\>(`type`): `T` \| `null`

Finds another component on the same entity — sugar for `this.entity.getComponent`.

###### Type Parameters

###### T

`T` *extends* `Component`

The component type to look for.

###### Parameters

###### type

`ComponentType`\<`T`\>

The component class; matching is by class identity **and** inheritance.

###### Returns

`T` \| `null`

The first match in attach order, or `null`.

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`getComponent`](#getcomponent-1)

##### onDetach()

> **onDetach**(): `void`

Silences and releases the renderable when the component goes away.

###### Returns

`void`

###### Implementation of

`ComponentHooks.onDetach`

##### requireComponent()

> **requireComponent**\<`T`\>(`type`): `T`

Finds another component on the same entity, requiring it to be there — the supported way to
link components (`docs/architecture/03-scripting-and-components.md` §8).

###### Type Parameters

###### T

`T` *extends* `Component`

The component type to look for.

###### Parameters

###### type

`ComponentType`\<`T`\>

The component class.

###### Returns

`T`

The first match in attach order.

###### Throws

IgnifxError with code `IGX-0201` when the entity has no such component.

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`requireComponent`](#requirecomponent-1)

##### resolveText()

> **resolveText**(`i18n`): `string`

The string that will actually be drawn: the translated `i18nKey`, or `text`.

###### Parameters

###### i18n

[`I18nService`](#i18nservice) \| `null`

The localization service, or `null` when the app has none.

###### Returns

`string`

The resolved string.

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`resolveText`](#resolvetext-1)

***

### WorldText2D

World-anchored pixel-space text.

#### Example

```ts
const damage = app.world.createEntity("damage").addComponent(WorldText2D);
damage.font = app.assets.load<FontAsset>("ui/Inter-Regular.ttf");
damage.text = "-12";
damage.offset = { x: 0, y: 1.8, z: 0 };
```

#### Extends

- [`TextComponent`](#abstract-textcomponent)

#### Implements

- `ComponentHooks`

#### Constructors

##### Constructor

> **new WorldText2D**(): [`WorldText2D`](#worldtext2d)

Builds a floating label with the schema's defaults.

###### Returns

[`WorldText2D`](#worldtext2d)

###### Overrides

[`TextComponent`](#abstract-textcomponent).[`constructor`](#constructor-5)

#### Properties

##### align

> **align**: `"left"` \| `"center"` \| `"right"`

Which edge the lines align to.

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`align`](#align-1)

##### allowMultiple

> `static` **allowMultiple**: `boolean` = `false`

One floating label per entity.

##### color

> **color**: `ColorLike`

The colour every glyph starts with.

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`color`](#color-1)

##### font

> **font**: `AssetHandle`\<`FontAsset`\> \| `null`

The TTF or OTF the glyphs come from.

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`font`](#font-1)

##### fontSize

> **fontSize**: `number`

The em size, in render-target pixels.

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`fontSize`](#fontsize-2)

##### hideWhenBehindCamera

> **hideWhenBehindCamera**: `boolean`

Whether the label is hidden when the anchor point is behind the camera.

##### i18nKey

> **i18nKey**: `string`

A translation key looked up in `app.i18n`; wins over [TextComponent.text](#text-2).

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`i18nKey`](#i18nkey-1)

##### lineHeight

> **lineHeight**: `number`

The line-height multiplier.

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`lineHeight`](#lineheight-1)

##### maxWidth

> **maxWidth**: `number`

The wrap width, in render-target pixels; `0` does not wrap.

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`maxWidth`](#maxwidth-1)

##### offset

> **offset**: `Vec3Like`

A world-space offset added to the entity's position before projecting, in metres.

##### opacity

> **opacity**: `number`

The whole-block alpha multiplier.

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`opacity`](#opacity-1)

##### order

> **order**: `number`

The sort order within the text renderer; lower draws first.

##### pivot

> **pivot**: `"top"` \| `"left"` \| `"center"` \| `"right"` \| `"topLeft"` \| `"topRight"` \| `"bottomLeft"` \| `"bottom"` \| `"bottomRight"`

Which point of the block sits on the projected position.

##### schema

> `static` **schema**: `Schema`

The declarative fields (ADR-0004).

##### screenOffset

> **screenOffset**: `Vec2Like`

A screen-space offset added after projecting, in render-target pixels.

##### text

> **text**: `string`

The literal string to draw; ignored when [TextComponent.i18nKey](#i18nkey-1) is set.

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`text`](#text-2)

##### typeId

> `static` **typeId**: `string` = `"ignifx/WorldText2D"`

The registration id the serializer writes into scene files.

#### Accessors

##### app

###### Get Signature

> **get** **app**(): `App`

The app that owns the world.

###### Returns

`App`

The app.

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`app`](#app-1)

##### enabled

###### Get Signature

> **get** **enabled**(): `boolean`

The component's own enabled flag; `true` by default. Setting it runs the enable or disable
transition (`docs/architecture/01-lifecycle-and-time.md` §6): `onDisable` runs immediately,
`awake`/`onEnable` run in the next lifecycle flush — or immediately and nested when the change
happens inside a callback.

###### Returns

`boolean`

`true` when the component's own flag is set.

###### Set Signature

> **set** **enabled**(`value`): `void`

###### Parameters

###### value

`boolean`

###### Returns

`void`

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`enabled`](#enabled-7)

##### entity

###### Get Signature

> **get** **entity**(): `Entity`

The entity this component is attached to.

###### Returns

`Entity`

The owning entity.

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`entity`](#entity-1)

##### handle

###### Get Signature

> **get** **handle**(): `ComponentHandle`

The dense runtime handle; invalid after destruction.

###### Returns

`ComponentHandle`

The handle.

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`handle`](#handle-1)

##### isDestroyed

###### Get Signature

> **get** **isDestroyed**(): `boolean`

`true` from the moment `destroy()` is called, long before the destroy flush runs.

###### Returns

`boolean`

`true` once the component has been queued for destruction.

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`isDestroyed`](#isdestroyed-1)

##### isEnabledInHierarchy

###### Get Signature

> **get** **isEnabledInHierarchy**(): `boolean`

`true` when the component's own flag is set **and** its entity is active in the hierarchy.

###### Returns

`boolean`

`true` when the component is effectively enabled.

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`isEnabledInHierarchy`](#isenabledinhierarchy-1)

##### lite

###### Get Signature

> **get** **lite**(): `object`

The Babylon Lite objects the component owns. Unstable escape hatch.

###### Returns

`object`

The text layer, or `null` before the first frame that had a font and a string.

###### layer

> `readonly` **layer**: `TextLayer` \| `null`

##### metrics

###### Get Signature

> **get** **metrics**(): [`TextMetrics`](#textmetrics)

The block's laid-out size, in render-target pixels.

###### Remarks

`{ width: 0, height: 0 }` until the block exists. This is Lite's only text measurement, and
it is what a caller centring a block on the screen needs — Lite's `align` aligns lines against
each other, not against the screen.

###### Example

```ts
const label = entity.addComponent(HudText);
label.metrics.width; // 0 until a font and a string are set
```

###### Returns

[`TextMetrics`](#textmetrics)

The size.

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`metrics`](#metrics-1)

##### onDestroyed

###### Get Signature

> **get** **onDestroyed**(): `Signal`\<`Component`\>

Emitted once when the component is destroyed, in the destroy flush. Connecting with
`{ owner: this }` elsewhere uses it to detach handlers automatically
(`docs/architecture/02-scene-graph.md` §8).

###### Returns

`Signal`\<`Component`\>

The signal. It is created on first access, so a component nobody listens to allocates
nothing.

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`onDestroyed`](#ondestroyed-1)

##### transform

###### Get Signature

> **get** **transform**(): `Transform`

The entity's transform — sugar for `this.entity.transform`, the most-used lookup there is.

###### Returns

`Transform`

The entity's transform.

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`transform`](#transform-1)

##### uid

###### Get Signature

> **get** **uid**(): `string`

The stable ULID; the key files use to reference this component.

###### Returns

`string`

The identifier.

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`uid`](#uid-1)

##### world

###### Get Signature

> **get** **world**(): `World`

The world the entity belongs to.

###### Returns

`World`

The world.

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`world`](#world-1)

#### Methods

##### define()

> `static` **define**\<`S`\>(`schema`): `ComponentDefinition`\<`S`\>

Declares a component's serialized fields and returns the base class to extend (ADR-0004,
`docs/architecture/03-scripting-and-components.md` §3). The returned class exposes every field
as a typed instance property, applies the defaults in its constructor, and carries the schema
for the serializer, the inspector, and the docs harness.

###### Type Parameters

###### S

`S` *extends* `Readonly`\<`Record`\<`string`, `FieldDefinition`\<`unknown`\>\>\>

The schema being declared.

###### Parameters

###### schema

`S`

The field definitions, keyed by the property name they become.

###### Returns

`ComponentDefinition`\<`S`\>

An abstract class to extend.

###### Throws

IgnifxError with code `IGX-0607` when a field name is not identifier-like or collides
with a `Component`/`Script` member.

###### Example

```ts
class Spinner extends Component.define({
  degreesPerSecond: f32(90, { min: -360, max: 360 }),
  axis: vec3({ x: 0, y: 1, z: 0 }),
}) {
  static typeId = "mygame/Spinner";
}
```

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`define`](#define-1)

##### destroy()

> **destroy**(): `void`

Queues this component for destruction. It stays usable until the destroy flush of the current
frame, but reports `isDestroyed === true` immediately
(`docs/architecture/01-lifecycle-and-time.md` §6). Calling it twice is a no-op.

###### Returns

`void`

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`destroy`](#destroy-1)

##### getComponent()

> **getComponent**\<`T`\>(`type`): `T` \| `null`

Finds another component on the same entity — sugar for `this.entity.getComponent`.

###### Type Parameters

###### T

`T` *extends* `Component`

The component type to look for.

###### Parameters

###### type

`ComponentType`\<`T`\>

The component class; matching is by class identity **and** inheritance.

###### Returns

`T` \| `null`

The first match in attach order, or `null`.

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`getComponent`](#getcomponent-1)

##### onDetach()

> **onDetach**(): `void`

Drops the layer and the block when the component goes away.

###### Returns

`void`

###### Implementation of

`ComponentHooks.onDetach`

##### requireComponent()

> **requireComponent**\<`T`\>(`type`): `T`

Finds another component on the same entity, requiring it to be there — the supported way to
link components (`docs/architecture/03-scripting-and-components.md` §8).

###### Type Parameters

###### T

`T` *extends* `Component`

The component type to look for.

###### Parameters

###### type

`ComponentType`\<`T`\>

The component class.

###### Returns

`T`

The first match in attach order.

###### Throws

IgnifxError with code `IGX-0201` when the entity has no such component.

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`requireComponent`](#requirecomponent-1)

##### resolveText()

> **resolveText**(`i18n`): `string`

The string that will actually be drawn: the translated `i18nKey`, or `text`.

###### Parameters

###### i18n

[`I18nService`](#i18nservice) \| `null`

The localization service, or `null` when the app has none.

###### Returns

`string`

The resolved string.

###### Inherited from

[`TextComponent`](#abstract-textcomponent).[`resolveText`](#resolvetext-1)

## Interfaces

### AnchorInput

Everything [computeAnchorPlacement](#computeanchorplacement) reads.

#### Properties

##### clampToScreen

> `readonly` **clampToScreen**: `boolean`

Whether the element is kept inside the overlay's bounds.

##### distance

> `readonly` **distance**: `number`

How far the point is from the camera, in metres.

##### hideWhenBehindCamera

> `readonly` **hideWhenBehindCamera**: `boolean`

Whether the element is hidden when the point is behind the camera.

##### inFront

> `readonly` **inFront**: `boolean`

Whether the point is in front of the camera.

##### mapping

> `readonly` **mapping**: [`UiPixelMapping`](#uipixelmapping)

The render-target-pixel to UI-unit conversion.

##### maxScale

> `readonly` **maxScale**: `number`

The largest scale distance scaling may produce.

##### minScale

> `readonly` **minScale**: `number`

The smallest scale distance scaling may produce.

##### referenceDistance

> `readonly` **referenceDistance**: `number`

The distance at which [AnchorInput.scaleWithDistance](#scalewithdistance) produces a scale of `1`.

##### scaleWithDistance

> `readonly` **scaleWithDistance**: `boolean`

Whether the element shrinks with distance.

##### screenX

> `readonly` **screenX**: `number`

The projected x, in render-target pixels.

##### screenY

> `readonly` **screenY**: `number`

The projected y, in render-target pixels.

##### viewHeight

> `readonly` **viewHeight**: `number`

The overlay root's height, in UI units.

##### viewWidth

> `readonly` **viewWidth**: `number`

The overlay root's width, in UI units.

***

### AnchorPlacement

Where the element goes, written in place so the per-frame path allocates nothing.

#### Properties

##### scale

> **scale**: `number`

The uniform scale to draw the element at.

##### visible

> **visible**: `boolean`

Whether the element is shown at all.

##### x

> **x**: `number`

The x, in UI units from the overlay root's left edge.

##### y

> **y**: `number`

The y, in UI units from the overlay root's top edge.

***

### ArgumentNode

A `{name}` substitution.

#### Properties

##### kind

> `readonly` **kind**: `"argument"`

The discriminator.

##### name

> `readonly` **name**: `string`

The parameter name.

***

### DialogButton

One button in a dialog.

#### Properties

##### id

> `readonly` **id**: `string`

The identifier `onChosen` reports.

##### label

> `readonly` **label**: `string`

The text drawn on the button.

***

### DialogOptions

What `new Dialog(app.ui, options)` accepts.

#### Properties

##### buttons?

> `readonly` `optional` **buttons?**: readonly [`DialogButton`](#dialogbutton)[]

The buttons, left to right.

##### dismissOnBackdrop?

> `readonly` `optional` **dismissOnBackdrop?**: `boolean`

Whether a click on the backdrop dismisses the dialog. Defaults to `false`.

##### layer?

> `readonly` `optional` **layer?**: `string`

The layer to mount into. Defaults to `"menu"`.

##### message?

> `readonly` `optional` **message?**: `string`

The body text. Omit for a dialog with no message.

##### title?

> `readonly` `optional` **title?**: `string`

The heading. Omit for a dialog with no title.

##### visible?

> `readonly` `optional` **visible?**: `boolean`

Whether the dialog starts shown. Defaults to `false`.

##### zIndex?

> `readonly` `optional` **zIndex?**: `number`

The stacking order inside the layer. Defaults to `UI_DIALOG_Z_INDEX`, from the stylesheet.

***

### HudPlacement

A layer position, written in place so the per-frame path allocates nothing.

#### Properties

##### x

> **x**: `number`

The layer's x, in render-target pixels.

##### y

> **y**: `number`

The layer's y — the first baseline — in render-target pixels.

***

### HudPlacementInput

What [computeHudPlacement](#computehudplacement) needs.

#### Properties

##### anchor

> `readonly` **anchor**: `"top"` \| `"left"` \| `"center"` \| `"right"` \| `"topLeft"` \| `"topRight"` \| `"bottomLeft"` \| `"bottom"` \| `"bottomRight"`

Which point of the target the position is measured from, and which point of the block lands there.

##### blockHeight

> `readonly` **blockHeight**: `number`

The block's laid-out height.

##### blockWidth

> `readonly` **blockWidth**: `number`

The block's laid-out width.

##### fontSize

> `readonly` **fontSize**: `number`

The em size the block was shaped at.

##### offsetX

> `readonly` **offsetX**: `number`

The offset from that point, in render-target pixels; x grows right, y grows down.

##### offsetY

> `readonly` **offsetY**: `number`

The offset from that point, in render-target pixels.

##### targetHeight

> `readonly` **targetHeight**: `number`

The render target's height, in pixels.

##### targetWidth

> `readonly` **targetWidth**: `number`

The render target's width, in pixels.

***

### LoadingScreenOptions

What `new LoadingScreen(app.ui, options)` accepts.

#### Properties

##### label?

> `readonly` `optional` **label?**: `string`

The initial label. Defaults to `"Loading…"`.

##### layer?

> `readonly` `optional` **layer?**: `string`

The layer to mount into. Defaults to `"overlay"`.

##### visible?

> `readonly` `optional` **visible?**: `boolean`

Whether the screen starts shown. Defaults to `true` — a boot screen is up before anything else.

***

### LocaleDocument

A parsed `ignifx.i18n` document.

#### Properties

##### defaultLocale

> `readonly` **defaultLocale**: `string`

The locale used when nothing else selected one.

##### locales

> `readonly` **locales**: `Readonly`\<`Record`\<`string`, `Readonly`\<`Record`\<`string`, `string`\>\>\>\>

Every locale's message table, keyed by BCP 47 tag.

***

### MenuActionRow

A row that runs something when it is activated.

#### Extends

- [`MenuRowBase`](#menurowbase)

#### Properties

##### activate?

> `readonly` `optional` **activate?**: () => `void`

What Enter, the pad's south button and a click do.

###### Returns

`void`

##### enabled?

> `readonly` `optional` **enabled?**: () => `boolean`

Whether the row can be selected. A row that answers `false` is drawn dimmed and skipped.

###### Returns

`boolean`

###### Inherited from

[`MenuRowBase`](#menurowbase).[`enabled`](#enabled-4)

##### id

> `readonly` **id**: `string`

A stable id. It becomes the row's `data-row` attribute, which is what a test selects on.

###### Inherited from

[`MenuRowBase`](#menurowbase).[`id`](#id-7)

##### kind

> `readonly` **kind**: `"action"`

What kind of row this is.

##### label

> `readonly` **label**: [`MenuLabel`](#menulabel)

The left-hand text.

###### Inherited from

[`MenuRowBase`](#menurowbase).[`label`](#label-6)

##### value?

> `readonly` `optional` **value?**: [`MenuLabel`](#menulabel)

The right-hand text, when the row shows one.

***

### MenuBindingRow

A row that shows one input binding and starts a rebind when it is activated.

#### Remarks

The row knows nothing about `@ignifx/input`: it is handed the binding's path as a string and a
callback that starts whatever rebinding flow the game uses. `@ignifx/input`'s
`performInteractiveRebind` is the usual one.

#### Extends

- [`MenuRowBase`](#menurowbase)

#### Properties

##### enabled?

> `readonly` `optional` **enabled?**: () => `boolean`

Whether the row can be selected. A row that answers `false` is drawn dimmed and skipped.

###### Returns

`boolean`

###### Inherited from

[`MenuRowBase`](#menurowbase).[`enabled`](#enabled-4)

##### id

> `readonly` **id**: `string`

A stable id. It becomes the row's `data-row` attribute, which is what a test selects on.

###### Inherited from

[`MenuRowBase`](#menurowbase).[`id`](#id-7)

##### kind

> `readonly` **kind**: `"binding"`

What kind of row this is.

##### label

> `readonly` **label**: [`MenuLabel`](#menulabel)

The left-hand text.

###### Inherited from

[`MenuRowBase`](#menurowbase).[`label`](#label-6)

##### listening?

> `readonly` `optional` **listening?**: () => `boolean`

Whether this row's rebind is listening right now, which changes what the row shows.

###### Returns

`boolean`

##### path

> `readonly` **path**: () => `string`

Reads the binding path, such as `<Keyboard>/arrowUp`, or `""` when nothing is bound.

###### Returns

`string`

##### rebind?

> `readonly` `optional` **rebind?**: () => `void`

Starts the rebind.

###### Returns

`void`

***

### MenuButtonSource

Anything with a press edge, which `@ignifx/input`'s `InputAction` is.

#### Properties

##### wasPressedThisFrame

> `readonly` **wasPressedThisFrame**: `boolean`

Whether the control went down this frame.

***

### MenuChoiceRow

A row that cycles through a list of values.

#### Extends

- [`MenuRowBase`](#menurowbase)

#### Properties

##### enabled?

> `readonly` `optional` **enabled?**: () => `boolean`

Whether the row can be selected. A row that answers `false` is drawn dimmed and skipped.

###### Returns

`boolean`

###### Inherited from

[`MenuRowBase`](#menurowbase).[`enabled`](#enabled-4)

##### format?

> `readonly` `optional` **format?**: (`value`) => `string`

Renders a value for display. Defaults to the value itself.

###### Parameters

###### value

`string`

###### Returns

`string`

##### get

> `readonly` **get**: () => `string`

Reads the current value.

###### Returns

`string`

##### id

> `readonly` **id**: `string`

A stable id. It becomes the row's `data-row` attribute, which is what a test selects on.

###### Inherited from

[`MenuRowBase`](#menurowbase).[`id`](#id-7)

##### kind

> `readonly` **kind**: `"choice"`

What kind of row this is.

##### label

> `readonly` **label**: [`MenuLabel`](#menulabel)

The left-hand text.

###### Inherited from

[`MenuRowBase`](#menurowbase).[`label`](#label-6)

##### set

> `readonly` **set**: (`value`) => `void`

Writes the new value.

###### Parameters

###### value

`string`

###### Returns

`void`

##### values

> `readonly` **values**: [`MenuChoiceValues`](#menuchoicevalues)

The values to cycle through, in order.

***

### MenuHeadingRow

A non-selectable label that groups the rows under it.

#### Properties

##### id

> `readonly` **id**: `string`

A stable id, which becomes the row's `data-row` attribute.

##### kind

> `readonly` **kind**: `"heading"`

What kind of row this is.

##### label

> `readonly` **label**: [`MenuLabel`](#menulabel)

The heading text.

***

### MenuNavigation

The three controls a menu stack reads.

#### Properties

##### back?

> `readonly` `optional` **back?**: [`MenuButtonSource`](#menubuttonsource) \| `null`

Backs out one screen.

##### move?

> `readonly` `optional` **move?**: [`MenuVectorSource`](#menuvectorsource) \| `null`

Moves the selection (`y`) and adjusts the selected row (`x`).

##### submit?

> `readonly` `optional` **submit?**: [`MenuButtonSource`](#menubuttonsource) \| `null`

Activates the selected row.

***

### MenuOptions

What `new Menu(app.ui, options)` accepts.

#### Properties

##### cancelable?

> `readonly` `optional` **cancelable?**: `boolean`

Whether Escape and [Menu.cancel](#cancel) back out of the menu. Defaults to `true`.

##### id

> `readonly` **id**: `string`

A stable id; it becomes the panel's `data-menu` attribute.

##### keyboard?

> `readonly` `optional` **keyboard?**: `boolean`

Whether the widget reads the keyboard itself. Defaults to `true`.

###### Remarks

Turn it off when the game drives navigation from its own input actions, or every arrow press
moves the selection twice. A [MenuStack](#menustack) built with a navigation
source does that for you.

##### layer?

> `readonly` `optional` **layer?**: `string`

The overlay layer to mount into. Defaults to `"menu"`.

##### rows?

> `readonly` `optional` **rows?**: readonly [`MenuRow`](#menurow)[]

The rows to start with. More usually arrive through [Menu.setRows](#setrows).

##### subtitle?

> `readonly` `optional` **subtitle?**: [`MenuLabel`](#menulabel)

A line of prose under the heading.

##### text?

> `readonly` `optional` **text?**: [`MenuText`](#menutext)

The words the rows use for their states.

##### title?

> `readonly` `optional` **title?**: [`MenuLabel`](#menulabel)

The panel's heading. Re-read on every [Menu.refresh](#refresh).

##### visible?

> `readonly` `optional` **visible?**: `boolean`

Whether the menu starts shown. Defaults to `false`.

##### wrap?

> `readonly` `optional` **wrap?**: `boolean`

Whether the selection wraps at both ends. Defaults to `true`.

***

### MenuRowBase

What every selectable row carries.

#### Extended by

- [`MenuActionRow`](#menuactionrow)
- [`MenuBindingRow`](#menubindingrow)
- [`MenuChoiceRow`](#menuchoicerow)
- [`MenuSliderRow`](#menusliderrow)
- [`MenuToggleRow`](#menutogglerow)

#### Properties

##### enabled?

> `readonly` `optional` **enabled?**: () => `boolean`

Whether the row can be selected. A row that answers `false` is drawn dimmed and skipped.

###### Returns

`boolean`

##### id

> `readonly` **id**: `string`

A stable id. It becomes the row's `data-row` attribute, which is what a test selects on.

##### label

> `readonly` **label**: [`MenuLabel`](#menulabel)

The left-hand text.

***

### MenuSeparatorRow

A non-selectable rule between groups of rows.

#### Properties

##### id

> `readonly` **id**: `string`

A stable id, which becomes the row's `data-row` attribute.

##### kind

> `readonly` **kind**: `"separator"`

What kind of row this is.

***

### MenuSliderRow

A row that edits a number over a range.

#### Remarks

Drawn as a native `<input type="range">` plus the formatted value, because dragging a knob is
worth having and `@ignifx/ui`'s own focus policy deliberately does not count a slider as a text
field (`docs/architecture/13-ui.md` §1), so a slider under the pointer never suppresses gameplay
input.

#### Extends

- [`MenuRowBase`](#menurowbase)

#### Properties

##### enabled?

> `readonly` `optional` **enabled?**: () => `boolean`

Whether the row can be selected. A row that answers `false` is drawn dimmed and skipped.

###### Returns

`boolean`

###### Inherited from

[`MenuRowBase`](#menurowbase).[`enabled`](#enabled-4)

##### format?

> `readonly` `optional` **format?**: (`value`) => `string`

Renders the value. Defaults to the number itself.

###### Parameters

###### value

`number`

###### Returns

`string`

##### get

> `readonly` **get**: () => `number`

Reads the current value.

###### Returns

`number`

##### id

> `readonly` **id**: `string`

A stable id. It becomes the row's `data-row` attribute, which is what a test selects on.

###### Inherited from

[`MenuRowBase`](#menurowbase).[`id`](#id-7)

##### kind

> `readonly` **kind**: `"slider"`

What kind of row this is.

##### label

> `readonly` **label**: [`MenuLabel`](#menulabel)

The left-hand text.

###### Inherited from

[`MenuRowBase`](#menurowbase).[`label`](#label-6)

##### max

> `readonly` **max**: `number`

The highest value the row may take.

##### min

> `readonly` **min**: `number`

The lowest value the row may take.

##### set

> `readonly` **set**: (`value`) => `void`

Writes a new value, already clamped and snapped to the step.

###### Parameters

###### value

`number`

###### Returns

`void`

##### step

> `readonly` **step**: `number`

How far one Left or Right press moves the value.

***

### MenuStackOptions

What `new MenuStack(options)` accepts.

#### Properties

##### navigation?

> `readonly` `optional` **navigation?**: [`MenuNavigation`](#menunavigation)

The controls to read in [MenuStack.update](#update). Omit to drive the stack by hand.

##### repeatDelay?

> `readonly` `optional` **repeatDelay?**: `number`

How long the first repeat of a held direction waits, in seconds. Defaults to `0.35`.

##### repeatInterval?

> `readonly` `optional` **repeatInterval?**: `number`

How long each following repeat waits, in seconds. Defaults to `0.12`.

##### threshold?

> `readonly` `optional` **threshold?**: `number`

How far an axis must move before it counts as a direction. Defaults to `0.5`.

***

### MenuText

The words a menu uses for the states its rows can be in, so a localized game sets them once per
menu rather than on every row.

#### Properties

##### listening?

> `readonly` `optional` **listening?**: [`MenuLabel`](#menulabel)

What a `"binding"` row shows while it is listening. Defaults to `"Press any key…"`.

##### off?

> `readonly` `optional` **off?**: [`MenuLabel`](#menulabel)

What a `"toggle"` row shows when it is off. Defaults to `"Off"`.

##### on?

> `readonly` `optional` **on?**: [`MenuLabel`](#menulabel)

What a `"toggle"` row shows when it is on. Defaults to `"On"`.

##### unbound?

> `readonly` `optional` **unbound?**: [`MenuLabel`](#menulabel)

What a `"binding"` row shows when nothing is bound. Defaults to `"—"`.

***

### MenuToggleRow

A row that flips a flag.

#### Extends

- [`MenuRowBase`](#menurowbase)

#### Properties

##### enabled?

> `readonly` `optional` **enabled?**: () => `boolean`

Whether the row can be selected. A row that answers `false` is drawn dimmed and skipped.

###### Returns

`boolean`

###### Inherited from

[`MenuRowBase`](#menurowbase).[`enabled`](#enabled-4)

##### format?

> `readonly` `optional` **format?**: (`value`) => `string`

Renders the flag. Defaults to the menu's `text.on` / `text.off`.

###### Parameters

###### value

`boolean`

###### Returns

`string`

##### get

> `readonly` **get**: () => `boolean`

Reads the flag.

###### Returns

`boolean`

##### id

> `readonly` **id**: `string`

A stable id. It becomes the row's `data-row` attribute, which is what a test selects on.

###### Inherited from

[`MenuRowBase`](#menurowbase).[`id`](#id-7)

##### kind

> `readonly` **kind**: `"toggle"`

What kind of row this is.

##### label

> `readonly` **label**: [`MenuLabel`](#menulabel)

The left-hand text.

###### Inherited from

[`MenuRowBase`](#menurowbase).[`label`](#label-6)

##### set

> `readonly` **set**: (`value`) => `void`

Writes the flag.

###### Parameters

###### value

`boolean`

###### Returns

`void`

***

### MenuVectorSource

Anything with a two-dimensional value, which `@ignifx/input`'s `InputAction` is.

#### Properties

##### vector

> `readonly` **vector**: `Vec2Like`

The direction, `-1` to `1` on each axis. Positive `y` is up.

***

### MessagePattern

A parsed message, or the reason it could not be parsed.

#### Properties

##### error

> `readonly` **error**: `string` \| `null`

Why the pattern could not be read, or `null` when it parsed.

##### nodes

> `readonly` **nodes**: readonly [`MessageNode`](#messagenode)[]

The nodes to render. Holds the raw pattern as one text node when [MessagePattern.error](#error) is set.

***

### PluralNode

A `{name, plural, …}` selection.

#### Properties

##### branches

> `readonly` **branches**: `ReadonlyMap`\<`string`, readonly [`MessageNode`](#messagenode)[]\>

The branches, keyed by `"=0"`-style exact matches and by plural category.

##### kind

> `readonly` **kind**: `"plural"`

The discriminator.

##### name

> `readonly` **name**: `string`

The parameter name holding the number.

***

### TextMetrics

The pixel size of a laid-out block.

#### Properties

##### height

> `readonly` **height**: `number`

The number of lines times the line height, in render-target pixels.

##### width

> `readonly` **width**: `number`

The width of the longest line, in render-target pixels.

***

### TextNode

A run of literal text.

#### Properties

##### kind

> `readonly` **kind**: `"text"`

The discriminator.

##### value

> `readonly` **value**: `string`

The literal.

***

### ToastOptions

What `new Toast(app.ui, options)` accepts.

#### Properties

##### duration?

> `readonly` `optional` **duration?**: `number`

How long a message stays up, in seconds, unless [Toast.show](#show-3) overrides it.

##### layer?

> `readonly` `optional` **layer?**: `string`

The layer to mount the stack into. Defaults to `"overlay"`.

##### maxVisible?

> `readonly` `optional` **maxVisible?**: `number`

How many messages are stacked before the oldest is dropped. Defaults to `4`.

***

### UiDomTarget

The DOM objects one app's overlay is built in.

#### Properties

##### canvas

> `readonly` **canvas**: `HTMLCanvasElement`

The canvas the overlay is positioned over.

##### document

> `readonly` **document**: `Document`

The document the overlay's elements and its stylesheet are created in.

##### window

> `readonly` **window**: `Window`

The window resize and focus events are read from, and the pixel ratio is read from.

***

### UiErrorOptions

Options accepted by [uiError](#uierror): the same subset of `IgnifxErrorOptions` this package uses.

#### Properties

##### cause?

> `readonly` `optional` **cause?**: `unknown`

The failure being wrapped, when there is one.

##### context?

> `readonly` `optional` **context?**: `Readonly`\<`Record`\<`string`, `string` \| `number` \| `boolean` \| `null`\>\>

Identifiers that locate the failure.

##### hint?

> `readonly` `optional` **hint?**: `string`

One sentence telling the developer what to do about it.

***

### UiLayerOptions

Options accepted by `app.ui.layer`.

#### Properties

##### visible?

> `readonly` `optional` **visible?**: `boolean`

Whether the layer starts visible. Defaults to `true`.

##### zIndex?

> `readonly` `optional` **zIndex?**: `number`

The stacking order. Defaults to the layer's declaration index times `UI_LAYER_Z_STEP`.

***

### UiLayout

Where the overlay root sits and how big it is, in the units the mode chose.

#### Properties

##### height

> `readonly` **height**: `number`

The root's height, in UI units.

##### mode

> `readonly` **mode**: `"css"` \| `"fit"` \| `"dpi"`

The mode this layout was computed for.

##### offsetX

> `readonly` **offsetX**: `number`

The root's left edge, in CSS pixels from the canvas's left edge.

##### offsetY

> `readonly` **offsetY**: `number`

The root's top edge, in CSS pixels from the canvas's top edge.

##### scale

> `readonly` **scale**: `number`

The uniform CSS scale applied to the root.

##### width

> `readonly` **width**: `number`

The root's width, in UI units.

***

### UiOptions

What `ui()` accepts. Every field that names a settings value overrides the matching `ui` section
value, which is the shape `04-extensions.md` §1 shows for `physics()`.

#### Properties

##### layers?

> `readonly` `optional` **layers?**: readonly `string`[]

The layers created up front, back to front.

##### locale?

> `readonly` `optional` **locale?**: `string`

The locale the app starts in, before any document is loaded. Defaults to `"en"`.

##### referenceResolution?

> `readonly` `optional` **referenceResolution?**: readonly `number`[]

The `[width, height]` the `"fit"` mode scales to.

##### scaling?

> `readonly` `optional` **scaling?**: `"css"` \| `"fit"` \| `"dpi"`

How the overlay's coordinate system relates to the canvas.

##### strings?

> `readonly` `optional` **strings?**: `string`

The address of a `.i18n.json` document to load into `app.i18n` at start-up. Empty loads
nothing; a game that ships one file per locale calls `app.i18n.load` itself.

##### visible?

> `readonly` `optional` **visible?**: `boolean`

Whether the overlay starts shown.

***

### UiPixelMapping

How a render-target pixel maps onto a UI unit under one layout.

#### Remarks

`Camera.worldToScreen` answers in **backing-store** pixels (it divides by
`RendererImpl.readTargetSize`, which reads `canvas.width`/`canvas.height`), and a DOM element is
placed in UI units inside a root that is itself translated by `offsetX`/`offsetY` CSS pixels and
scaled by `scale`. This is the conversion between the two, expressed so a per-frame loop needs
two multiplies and a subtract and allocates nothing.

#### Properties

##### originX

> `readonly` **originX**: `number`

Then subtract this.

##### originY

> `readonly` **originY**: `number`

Then subtract this.

##### scaleX

> `readonly` **scaleX**: `number`

Multiply a backing-store x by this.

##### scaleY

> `readonly` **scaleY**: `number`

Multiply a backing-store y by this.

***

### UiSettings

The resolved `ui` settings section.

#### Example

```ts
// ignifx.config.ts
export default defineConfig({
  ui: { scaling: "fit", referenceResolution: [640, 360], layers: ["hud", "menu"] },
});
```

#### Properties

##### layers

> `readonly` **layers**: readonly `string`[]

The layers created eagerly, back to front. Declaring them here is what makes their stacking
order independent of the order the game happens to call [UiHost.layer](#layer-5) in.

##### referenceResolution

> `readonly` **referenceResolution**: readonly `number`[]

The `[width, height]`, in UI units, that `"fit"` scales to. Ignored by the other two modes.
Defaults to `[1920, 1080]`.

##### scaling

> `readonly` **scaling**: `"css"` \| `"fit"` \| `"dpi"`

How the overlay's coordinate system relates to the canvas. Defaults to `"css"`.

##### visible

> `readonly` **visible**: `boolean`

Whether the overlay is shown at all. Defaults to `true`.

***

### UiSurfaceMetrics

The two sizes of the canvas the overlay covers, both measured by the host.

#### Properties

##### cssHeight

> `readonly` **cssHeight**: `number`

The canvas's laid-out height, in CSS pixels.

##### cssWidth

> `readonly` **cssWidth**: `number`

The canvas's laid-out width, in CSS pixels.

##### deviceHeight

> `readonly` **deviceHeight**: `number`

The canvas's backing-store height, in device pixels — `canvas.height`.

##### deviceWidth

> `readonly` **deviceWidth**: `number`

The canvas's backing-store width, in device pixels — `canvas.width`.

***

### VirtualButtonOptions

What `new VirtualButton(app, options)` accepts.

#### Properties

##### ariaLabel?

> `readonly` `optional` **ariaLabel?**: `string`

An accessible label. Defaults to the control name.

##### control

> `readonly` **control**: `string`

The `<Virtual>/…` control to write.

##### label?

> `readonly` `optional` **label?**: `string`

The glyph or word drawn on the button. Defaults to the control name.

##### layer?

> `readonly` `optional` **layer?**: `string`

The layer to mount into. Defaults to `"hud"`.

##### style?

> `readonly` `optional` **style?**: `Readonly`\<`Record`\<`string`, `string`\>\>

Inline styles applied to the button, for placement.

***

### VirtualDeviceLike

The part of `@ignifx/input`'s virtual device the touch widgets use.

#### Remarks

Structural on purpose. A test passes a recording double; a game passes
`app.input.devices.virtual`.

#### Methods

##### set()

> **set**(`name`, `value`): `void`

Writes a scalar control, creating it when it does not exist.

###### Parameters

###### name

`string`

The control name, as it appears after `<Virtual>/`.

###### value

`number`

The new value.

###### Returns

`void`

##### setVector()

> **setVector**(`name`, `x`, `y`): `void`

Writes a vector control, creating it when it does not exist.

###### Parameters

###### name

`string`

The control name.

###### x

`number`

The new x component.

###### y

`number`

The new y component.

###### Returns

`void`

***

### VirtualJoystickOptions

What `new VirtualJoystick(app, options)` accepts.

#### Properties

##### ariaLabel?

> `readonly` `optional` **ariaLabel?**: `string`

An accessible label for the pad. Defaults to the control name.

##### control?

> `readonly` `optional` **control?**: `string`

The `<Virtual>/…` control to write. Defaults to `"joystick"`.

##### deadZone?

> `readonly` `optional` **deadZone?**: `number`

Deflections shorter than this fraction of the radius read as zero. Defaults to `0.15`.

##### layer?

> `readonly` `optional` **layer?**: `string`

The layer to mount into. Defaults to `"hud"`.

##### radius?

> `readonly` `optional` **radius?**: `number`

How far the knob travels, in UI units, before the stick reads as fully deflected.

##### style?

> `readonly` `optional` **style?**: `Readonly`\<`Record`\<`string`, `string`\>\>

Inline styles applied to the pad, for placement.

## Type Aliases

### HudAnchor

> **HudAnchor** = *typeof* [`HUD_ANCHORS`](#hud_anchors)\[`number`\]

Which point of the render target a `HudText`'s position is measured from, and which point of the
block sits there.

***

### LiteFont

> **LiteFont** = `Font`

The Babylon Lite font handle, re-exported under an ignifx name so feature code can name the type
without importing `@babylonjs/lite` (`CONSTITUTION.md` §3.4).

#### Remarks

Unstable: it is Lite's own type, reachable only through documented `.lite` escape hatches.

***

### LiteTextData

> **LiteTextData** = `DefaultTextData`

A shaped block of text, with its glyph storage.

#### Remarks

Unstable escape-hatch type.

***

### LiteTextLayer

> **LiteTextLayer** = `TextLayer`

A 2D text layer placed in render-target pixel space.

#### Remarks

Unstable escape-hatch type.

***

### LiteTextRenderable

> **LiteTextRenderable** = `TextRenderable`

A scene renderable that draws a block of text in world space.

#### Remarks

Unstable escape-hatch type.

***

### LiteTextRenderer

> **LiteTextRenderer** = `TextRenderer`

The standalone rendering context that draws 2D text layers onto the swapchain.

#### Remarks

Unstable escape-hatch type.

***

### MenuChoiceValues

> **MenuChoiceValues** = readonly `string`[] \| (() => readonly `string`[])

The values a `"choice"` row cycles through: a fixed list, or one read per use.

***

### MenuLabel

> **MenuLabel** = `string` \| (() => `string`)

Text that is either fixed or re-read on every refresh.

#### Remarks

A function is what makes a menu localizable: `label: () => app.i18n.t("menu.resume")` re-renders
itself when `app.i18n.locale` changes, because [Menu.refresh](#refresh) calls it again.

***

### MenuRow

> **MenuRow** = [`MenuActionRow`](#menuactionrow) \| [`MenuBindingRow`](#menubindingrow) \| [`MenuChoiceRow`](#menuchoicerow) \| [`MenuHeadingRow`](#menuheadingrow) \| [`MenuSeparatorRow`](#menuseparatorrow) \| [`MenuSliderRow`](#menusliderrow) \| [`MenuToggleRow`](#menutogglerow)

One row of a [Menu](#menu).

***

### MessageNode

> **MessageNode** = [`TextNode`](#textnode) \| [`ArgumentNode`](#argumentnode) \| [`PluralNode`](#pluralnode)

One piece of a parsed message.

***

### MessageParams

> **MessageParams** = `Readonly`\<`Record`\<`string`, `string` \| `number`\>\>

What a message's parameters may be.

***

### PluralSelector

> **PluralSelector** = (`value`) => `string`

Chooses a plural category for a number, in one locale.

#### Parameters

##### value

`number`

#### Returns

`string`

***

### TextAlignment

> **TextAlignment** = *typeof* [`TEXT_ALIGNMENTS`](#text_alignments)\[`number`\]

Which edge a block's lines align to. Lite aligns lines against the block's **longest line**, not
against `maxWidth`, so a single-line block looks the same in all three.

***

### UiErrorCode

> **UiErrorCode** = *typeof* [`UiErrorCode`](#uierrorcode)\[keyof *typeof* [`UiErrorCode`](#uierrorcode)\]

The union of the codes the `UiErrorCode` table declares.

***

### UiScalingMode

> **UiScalingMode** = *typeof* [`UI_SCALING_MODES`](#ui_scaling_modes)\[`number`\]

How the overlay's coordinate system relates to the canvas.

#### Remarks

- `"css"` — one UI unit is one CSS pixel and nothing is scaled. The browser default, and what a
  responsive HTML menu wants.
- `"fit"` — the root is exactly [UiSettings.referenceResolution](#referenceresolution-2) CSS pixels and is scaled
  uniformly to fit inside the canvas, keeping aspect and centring the letterbox. A HUD authored
  once at 1920x1080 then looks the same on every window size.
- `"dpi"` — one UI unit is one **render-target** pixel: the root is sized to the canvas's
  backing store and scaled by `1 / devicePixelRatio` so it still covers the same area. This is
  the space `Camera.worldToScreen`, `HudText`, and `app.renderer.captureScreenshot()` all work
  in, so an element placed at `left: 100px` lands on render-target column 100 exactly.

## Variables

### HUD\_ANCHORS

> `const` **HUD\_ANCHORS**: readonly \[`"topLeft"`, `"top"`, `"topRight"`, `"left"`, `"center"`, `"right"`, `"bottomLeft"`, `"bottom"`, `"bottomRight"`\]

The nine points of a rectangle a block can be anchored to.

***

### I18N\_ASSET\_TYPE

> `const` **I18N\_ASSET\_TYPE**: `"i18n"` = `"i18n"`

The asset type translation documents are registered under.

***

### I18N\_FILE\_EXTENSIONS

> `const` **I18N\_FILE\_EXTENSIONS**: readonly `string`[]

The file extensions the translation loader claims.

***

### I18N\_FORMAT

> `const` **I18N\_FORMAT**: `"ignifx.i18n"` = `"ignifx.i18n"`

The `format` discriminator every translation document carries.

***

### I18N\_FORMAT\_VERSION

> `const` **I18N\_FORMAT\_VERSION**: `1` = `1`

The `formatVersion` this build writes and is the only one it can read. Before 1.0 the number
stays `1` and an incompatible change invalidates files rather than migrating them
(`CONSTITUTION.md` §4.2); a file declaring anything else is rejected with `IGX-1302`.

***

### TEXT\_ALIGNMENTS

> `const` **TEXT\_ALIGNMENTS**: readonly \[`"left"`, `"center"`, `"right"`\]

The alignments Lite's default layout supports (`index.d.ts` 12826-12827).

***

### ui

> `const` **ui**: (`options?`) => `Extension`

The `@ignifx/ui` extension factory.

#### Parameters

##### options?

[`UiOptions`](#uioptions)

Overrides for the `ui` settings section, plus the start-up translation document.

#### Returns

`Extension`

The extension descriptor to pass to `createApp`.

#### Example

```ts
const app = await createApp({
  canvas,
  extensions: [ui({ scaling: "fit", referenceResolution: [640, 360] })],
});
```

***

### UI\_CLASS\_NAMES

> `const` **UI\_CLASS\_NAMES**: `object`

The class names the host and the helper widgets set, so a template's CSS can target them without
guessing (`docs/architecture/13-ui.md` §3).

#### Type Declaration

##### button

> `readonly` **button**: `"ignifx-ui-button"` = `"ignifx-ui-button"`

A `VirtualButton`.

##### dialog

> `readonly` **dialog**: `"ignifx-ui-dialog"` = `"ignifx-ui-dialog"`

A `Dialog`'s outermost element.

##### dialogBackdrop

> `readonly` **dialogBackdrop**: `"ignifx-ui-dialog-backdrop"` = `"ignifx-ui-dialog-backdrop"`

A `Dialog`'s backdrop.

##### dialogButton

> `readonly` **dialogButton**: `"ignifx-ui-dialog-button"` = `"ignifx-ui-dialog-button"`

One `Dialog` button.

##### dialogButtons

> `readonly` **dialogButtons**: `"ignifx-ui-dialog-buttons"` = `"ignifx-ui-dialog-buttons"`

A `Dialog`'s button row.

##### dialogMessage

> `readonly` **dialogMessage**: `"ignifx-ui-dialog-message"` = `"ignifx-ui-dialog-message"`

A `Dialog`'s message.

##### dialogPanel

> `readonly` **dialogPanel**: `"ignifx-ui-dialog-panel"` = `"ignifx-ui-dialog-panel"`

A `Dialog`'s panel.

##### dialogTitle

> `readonly` **dialogTitle**: `"ignifx-ui-dialog-title"` = `"ignifx-ui-dialog-title"`

A `Dialog`'s title.

##### interactive

> `readonly` **interactive**: `"ignifx-ui-interactive"` = `"ignifx-ui-interactive"`

Anything that should receive pointer events; the root does not.

##### joystick

> `readonly` **joystick**: `"ignifx-ui-joystick"` = `"ignifx-ui-joystick"`

A `VirtualJoystick`'s outer pad.

##### joystickKnob

> `readonly` **joystickKnob**: `"ignifx-ui-joystick-knob"` = `"ignifx-ui-joystick-knob"`

A `VirtualJoystick`'s knob.

##### layer

> `readonly` **layer**: `"ignifx-ui-layer"` = `"ignifx-ui-layer"`

A named layer inside the root.

##### loading

> `readonly` **loading**: `"ignifx-ui-loading"` = `"ignifx-ui-loading"`

A `LoadingScreen`'s outermost element.

##### loadingBar

> `readonly` **loadingBar**: `"ignifx-ui-loading-bar"` = `"ignifx-ui-loading-bar"`

A `LoadingScreen`'s progress bar.

##### loadingLabel

> `readonly` **loadingLabel**: `"ignifx-ui-loading-label"` = `"ignifx-ui-loading-label"`

A `LoadingScreen`'s label.

##### loadingTrack

> `readonly` **loadingTrack**: `"ignifx-ui-loading-track"` = `"ignifx-ui-loading-track"`

A `LoadingScreen`'s progress track.

##### menu

> `readonly` **menu**: `"ignifx-ui-menu"` = `"ignifx-ui-menu"`

A `Menu`'s outermost panel.

##### menuHeading

> `readonly` **menuHeading**: `"ignifx-ui-menu-heading"` = `"ignifx-ui-menu-heading"`

A `Menu`'s `"heading"` row.

##### menuRow

> `readonly` **menuRow**: `"ignifx-ui-menu-row"` = `"ignifx-ui-menu-row"`

One selectable `Menu` row.

##### menuRowLabel

> `readonly` **menuRowLabel**: `"ignifx-ui-menu-row-label"` = `"ignifx-ui-menu-row-label"`

A `Menu` row's left-hand text.

##### menuRows

> `readonly` **menuRows**: `"ignifx-ui-menu-rows"` = `"ignifx-ui-menu-rows"`

The list a `Menu`'s rows are appended to.

##### menuRowSlider

> `readonly` **menuRowSlider**: `"ignifx-ui-menu-row-slider"` = `"ignifx-ui-menu-row-slider"`

A `Menu` slider row's range input.

##### menuRowValue

> `readonly` **menuRowValue**: `"ignifx-ui-menu-row-value"` = `"ignifx-ui-menu-row-value"`

A `Menu` row's right-hand text.

##### menuSeparator

> `readonly` **menuSeparator**: `"ignifx-ui-menu-separator"` = `"ignifx-ui-menu-separator"`

A `Menu`'s `"separator"` row.

##### menuSubtitle

> `readonly` **menuSubtitle**: `"ignifx-ui-menu-subtitle"` = `"ignifx-ui-menu-subtitle"`

A `Menu`'s subtitle.

##### menuTitle

> `readonly` **menuTitle**: `"ignifx-ui-menu-title"` = `"ignifx-ui-menu-title"`

A `Menu`'s heading.

##### root

> `readonly` **root**: `"ignifx-ui-root"` = `"ignifx-ui-root"`

The overlay root.

##### toast

> `readonly` **toast**: `"ignifx-ui-toast"` = `"ignifx-ui-toast"`

One toast.

##### toastStack

> `readonly` **toastStack**: `"ignifx-ui-toasts"` = `"ignifx-ui-toasts"`

A `Toast`'s stack container.

***

### UI\_CSS\_VARIABLES

> `const` **UI\_CSS\_VARIABLES**: `object`

The CSS custom properties the root carries, so game CSS can read the safe area and the current
scale without measuring anything (`docs/architecture/13-ui.md` §1).

#### Type Declaration

##### safeBottom

> `readonly` **safeBottom**: `"--ignifx-safe-bottom"` = `"--ignifx-safe-bottom"`

The bottom safe-area inset.

##### safeLeft

> `readonly` **safeLeft**: `"--ignifx-safe-left"` = `"--ignifx-safe-left"`

The left safe-area inset.

##### safeRight

> `readonly` **safeRight**: `"--ignifx-safe-right"` = `"--ignifx-safe-right"`

The right safe-area inset.

##### safeTop

> `readonly` **safeTop**: `"--ignifx-safe-top"` = `"--ignifx-safe-top"`

The top safe-area inset, from `env(safe-area-inset-top)`.

##### scale

> `readonly` **scale**: `"--ignifx-ui-scale"` = `"--ignifx-ui-scale"`

The uniform scale the root is drawn at, as a bare number.

***

### UI\_DIALOG\_Z\_INDEX

> `const` **UI\_DIALOG\_Z\_INDEX**: `1000` = `1000`

The `z-index` a `Dialog` is drawn at inside its layer.

#### Remarks

A dialog is modal, and a modal that paints under the panel that opened it swallows every click
on that panel. Siblings with no `z-index` paint in DOM order, so a `Dialog` created before a
`Menu` in the same layer would lose; giving every dialog one number puts it above every other
root of its layer whatever order they were built in. Two dialogs in one layer still stack in DOM
order, and `DialogOptions.zIndex` overrides the number for a dialog that must sit elsewhere.

***

### UI\_ERROR\_MESSAGES

> `const` **UI\_ERROR\_MESSAGES**: `Readonly`\<`Record`\<`string`, `string`\>\>

The one-line message template of every code, as `ExtensionContext.registerErrorCodes` wants it.
Context keys appear in braces, matching the core table's convention.

***

### UI\_FOCUS\_ATTRIBUTE

> `const` **UI\_FOCUS\_ATTRIBUTE**: `"data-ignifx-focus"` = `"data-ignifx-focus"`

The attribute that overrides the editability guess in either direction.

***

### UI\_LAYER\_Z\_STEP

> `const` **UI\_LAYER\_Z\_STEP**: `10` = `10`

The z-index step between two consecutive layers. The first declared layer sits at
`UI_LAYER_Z_STEP`, the second at twice that, and so on, which leaves nine free slots between any
two layers for a game that wants to interleave its own elements.

***

### UI\_SCALING\_MODES

> `const` **UI\_SCALING\_MODES**: readonly \[`"css"`, `"fit"`, `"dpi"`\]

Every scaling mode the overlay host supports, in the order an inspector should list them
(`docs/architecture/13-ui.md` §1).

***

### UI\_SETTINGS\_SECTION

> `const` **UI\_SETTINGS\_SECTION**: `"ui"` = `"ui"`

The section name as it appears in `ignifx.config.ts`.

***

### UI\_STYLE\_ELEMENT\_ID

> `const` **UI\_STYLE\_ELEMENT\_ID**: `"ignifx-ui-styles"` = `"ignifx-ui-styles"`

The `id` of the injected `<style>` element, so a second app in one document reuses it.

***

### UI\_SYNC\_ORDER

> `const` **UI\_SYNC\_ORDER**: `1100` = `1100`

The `PreRender` order the UI system runs at.

#### Remarks

After `RENDER_SYNC_ORDER` (900), which is the frame's camera synchronisation, and inside the
extension band. See the module's own remarks.

***

### UiErrorCode

> `const` **UiErrorCode**: `object`

Every diagnostic code `@ignifx/ui` can throw or log, keyed by an intention-revealing name so call
sites read as prose and the compiler catches typos (coding standards §5.2).

#### Type Declaration

##### duplicateExtension

> `readonly` **duplicateExtension**: `"IGX-1301"` = `"IGX-1301"`

A second `ui()` extension was registered on one app.

##### headlessNoOp

> `readonly` **headlessNoOp**: `"IGX-1307"` = `"IGX-1307"`

A DOM-only member was reached on a host with no document, and did nothing.

##### inputExtensionMissing

> `readonly` **inputExtensionMissing**: `"IGX-1305"` = `"IGX-1305"`

A widget that needs `@ignifx/input` was built on an app that did not register it.

##### invalidLocaleFile

> `readonly` **invalidLocaleFile**: `"IGX-1302"` = `"IGX-1302"`

A `.i18n.json` file is not an `ignifx.i18n` document this build can read.

##### invalidMessagePattern

> `readonly` **invalidMessagePattern**: `"IGX-1304"` = `"IGX-1304"`

A message pattern could not be parsed: an unbalanced brace or an unknown argument form.

##### missingFont

> `readonly` **missingFont**: `"IGX-1306"` = `"IGX-1306"`

A `WorldText` or `HudText` was asked to draw before its `font` asset was assigned.

##### sceneAlreadyBuilt

> `readonly` **sceneAlreadyBuilt**: `"IGX-1308"` = `"IGX-1308"`

A `WorldText` needed a scene renderable after the render scene had already been built.

##### unknownLocale

> `readonly` **unknownLocale**: `"IGX-1303"` = `"IGX-1303"`

`app.i18n.locale` was set to a locale the loaded document does not declare.

#### Example

```ts
throw uiError(UiErrorCode.unknownLayer, "hud is not a declared UI layer.", {
  context: { layer: "hud" },
});
```

***

### VERSION

> `const` **VERSION**: `"0.0.0"` = `"0.0.0"`

The `@ignifx/ui` version this build was cut from.

## Functions

### computeAnchorPlacement()

> **computeAnchorPlacement**(`input`, `out`): [`AnchorPlacement`](#anchorplacement)

Computes where an anchored element goes this frame.

#### Parameters

##### input

[`AnchorInput`](#anchorinput)

The projection, the flags, and the conversion.

##### out

[`AnchorPlacement`](#anchorplacement)

Receives the placement.

#### Returns

[`AnchorPlacement`](#anchorplacement)

`out`, for chaining.

#### Example

```ts
const out = createAnchorPlacement();
computeAnchorPlacement(
  {
    screenX: 400,
    screenY: 300,
    inFront: true,
    distance: 10,
    viewWidth: 800,
    viewHeight: 600,
    mapping: { scaleX: 1, originX: 0, scaleY: 1, originY: 0 },
    hideWhenBehindCamera: true,
    clampToScreen: false,
    scaleWithDistance: false,
    referenceDistance: 10,
    minScale: 0.5,
    maxScale: 2,
  },
  out,
);
out.x; // 400
```

***

### computeHudPlacement()

> **computeHudPlacement**(`input`, `out`): [`HudPlacement`](#hudplacement)

Places a block against one of the nine anchors of the render target.

#### Parameters

##### input

[`HudPlacementInput`](#hudplacementinput)

The anchor, the offset, the target size, and the block's size.

##### out

[`HudPlacement`](#hudplacement)

Receives the layer position.

#### Returns

[`HudPlacement`](#hudplacement)

`out`, for chaining.

#### Example

```ts
const out = { x: 0, y: 0 };
computeHudPlacement(
  {
    anchor: "topRight",
    offsetX: -16,
    offsetY: 16,
    targetWidth: 800,
    targetHeight: 600,
    blockWidth: 100,
    blockHeight: 40,
    fontSize: 32,
  },
  out,
);
out.x; // 684 — 16 px in from the right edge
```

***

### computePivotPlacement()

> **computePivotPlacement**(`pivot`, `x`, `y`, `blockWidth`, `blockHeight`, `fontSize`, `out`): [`HudPlacement`](#hudplacement)

Places a block around a point, with the given point of the block sitting on it.

#### Parameters

##### pivot

`"top"` \| `"left"` \| `"center"` \| `"right"` \| `"topLeft"` \| `"topRight"` \| `"bottomLeft"` \| `"bottom"` \| `"bottomRight"`

Which point of the block lands on the position.

##### x

`number`

The point's x, in render-target pixels.

##### y

`number`

The point's y, in render-target pixels.

##### blockWidth

`number`

The block's laid-out width.

##### blockHeight

`number`

The block's laid-out height.

##### fontSize

`number`

The em size the block was shaped at.

##### out

[`HudPlacement`](#hudplacement)

Receives the layer position.

#### Returns

[`HudPlacement`](#hudplacement)

`out`, for chaining.

#### Example

```ts
const out = { x: 0, y: 0 };
computePivotPlacement("center", 400, 300, 100, 40, 32, out);
out.x; // 350
```

***

### computeUiLayout()

> **computeUiLayout**(`mode`, `metrics`, `reference`): [`UiLayout`](#uilayout)

Computes the overlay root's size, scale, and offset for one mode and one measured canvas.

#### Parameters

##### mode

`"css"` \| `"fit"` \| `"dpi"`

The scaling mode.

##### metrics

[`UiSurfaceMetrics`](#uisurfacemetrics)

The canvas's CSS and backing-store sizes.

##### reference

readonly `number`[]

The `[width, height]` a `"fit"` layout scales to; ignored by the other modes.

#### Returns

[`UiLayout`](#uilayout)

The layout to write onto the root.

#### Example

```ts
computeUiLayout("fit", { cssWidth: 800, cssHeight: 600, deviceWidth: 800, deviceHeight: 600 }, [
  400, 300,
]).scale; // 2
```

***

### createLocaleLoader()

> **createLocaleLoader**(): `AssetLoader`\<[`LocaleAsset`](#localeasset)\>

Builds the loader for `.i18n.json` addresses.

#### Returns

`AssetLoader`\<[`LocaleAsset`](#localeasset)\>

The loader to register with `ctx.registerAssetLoader`.

#### Example

```ts
ctx.registerAssetLoader(createLocaleLoader());
```

***

### createPluralSelector()

> **createPluralSelector**(`locale`): [`PluralSelector`](#pluralselector)

Builds the plural selector for a locale.

#### Parameters

##### locale

`string`

The BCP 47 locale tag.

#### Returns

[`PluralSelector`](#pluralselector)

A function from a number to a plural category.

#### Remarks

`Intl.PluralRules` is present in every browser and in Node, but a stripped runtime without
`Intl` still has to work, so the fallback is English's two-category rule.

#### Example

```ts
createPluralSelector("en")(1); // "one"
```

***

### defaultUiSettings()

> **defaultUiSettings**(): [`UiSettings`](#uisettings)

The values used for everything a project omits.

#### Returns

[`UiSettings`](#uisettings)

The default `ui` section.

***

### describeLocaleFileFormat()

> **describeLocaleFileFormat**(): `SchemaDescription`

Describes the `ignifx.i18n` file format for the documentation harness.

#### Returns

`SchemaDescription`

The record `pnpm docs:schemas` renders.

***

### describeSchemas()

> **describeSchemas**(): `Readonly`\<`Record`\<`string`, `SchemaDescription`\>\>

Describes every component and file format this package declares, for the documentation harness.

#### Returns

`Readonly`\<`Record`\<`string`, `SchemaDescription`\>\>

The records, keyed by namespaced type id.

#### Example

```ts
describeSchemas()["ignifx/HudText"].fields["fontSize"].default; // 32
```

***

### findVirtualDevice()

> **findVirtualDevice**(`app`): [`VirtualDeviceLike`](#virtualdevicelike) \| `null`

Finds `app.input.devices.virtual`, if `@ignifx/input` is registered.

#### Parameters

##### app

`App`

The running app.

#### Returns

[`VirtualDeviceLike`](#virtualdevicelike) \| `null`

The device, or `null` when the input extension is not installed.

#### Example

```ts
const device = findVirtualDevice(app);
device?.setVector("joystick", 0, 1);
```

***

### formatBindingPath()

> **formatBindingPath**(`path`, `unbound`): `string`

Renders an `@ignifx/input` binding path the way a player reads it.

#### Parameters

##### path

`string`

The binding path, such as `<Keyboard>/arrowUp`, or `""` for none.

##### unbound

`string`

What to answer for an empty path.

#### Returns

`string`

The label, such as `Keyboard: Arrow up`.

#### Example

```ts
formatBindingPath("<Keyboard>/arrowUp", "—"); // "Keyboard: Arrow up"
formatBindingPath("", "—"); // "—"
```

***

### isEditableElement()

> **isEditableElement**(`node`): `boolean`

Reports whether a focused node is a text-entry element, and therefore owns the keyboard.

#### Parameters

##### node

`unknown`

The node that just received focus, or `null`.

#### Returns

`boolean`

`true` when typing into it must stop keyboard actions from firing.

#### Remarks

Deliberately structural rather than `instanceof HTMLInputElement`: the same function then answers
for a real element in Chromium and for the fake DOM the node suite builds, and two documents in
one page (an `<iframe>`) do not need their constructors to match.

#### Example

```ts
const field = document.createElement("input");
isEditableElement(field); // true — an <input> with no type is a text field
```

***

### localeFileSchema()

> **localeFileSchema**(): `Schema`

The schema a translation document is described and validated against for tooling.

#### Returns

`Schema`

The schema, built fresh so no module holds state (`CONSTITUTION.md` §3.5).

#### Remarks

The loader validates with [parseLocaleFile](#parselocalefile), which produces an actionable `IGX-1302`
naming the file; this schema is what `pnpm docs:schemas` renders and what a JSON Schema for an
editor is generated from — the split `@ignifx/2d`'s `file-schemas.ts` documents.

***

### localeJsonSchema()

> **localeJsonSchema**(): `JsonObject`

The JSON Schema a tool validates a `.i18n.json` document against.

#### Returns

`JsonObject`

The JSON Schema object.

***

### parseLocaleFile()

> **parseLocaleFile**(`value`, `address`): [`LocaleDocument`](#localedocument)

Parses and validates a translation document.

#### Parameters

##### value

`unknown`

The parsed JSON.

##### address

`string`

The address it came from, for the error's context.

#### Returns

[`LocaleDocument`](#localedocument)

The document.

#### Throws

IgnifxError with code `IGX-1302` when the header is missing, the version does not match,
or the file declares no locales.

#### Example

```ts
const document = parseLocaleFile(
  { format: "ignifx.i18n", formatVersion: 1, defaultLocale: "en", locales: { en: { ok: "OK" } } },
  "ui/strings.i18n.json",
);
document.locales["en"]?.["ok"]; // "OK"
```

***

### parseMessage()

> **parseMessage**(`pattern`): [`MessagePattern`](#messagepattern)

Parses one message pattern.

#### Parameters

##### pattern

`string`

The pattern, as written in the `.i18n.json` document.

#### Returns

[`MessagePattern`](#messagepattern)

The parsed nodes, or the raw text plus the reason it could not be parsed.

#### Example

```ts
parseMessage("{count, plural, one {# life} other {# lives}}").error; // null
parseMessage("{count, plural, one {# life}}").error; // "plural count has no other branch"
```

***

### pixelMapping()

> **pixelMapping**(`layout`, `metrics`): [`UiPixelMapping`](#uipixelmapping)

Builds the backing-store-pixel to UI-unit conversion for one layout and one canvas.

#### Parameters

##### layout

[`UiLayout`](#uilayout)

The current layout.

##### metrics

[`UiSurfaceMetrics`](#uisurfacemetrics)

The canvas's CSS and backing-store sizes.

#### Returns

[`UiPixelMapping`](#uipixelmapping)

The mapping.

#### Example

```ts
const metrics = { cssWidth: 400, cssHeight: 300, deviceWidth: 800, deviceHeight: 600 };
const layout = computeUiLayout("css", metrics, [400, 300]);
const map = pixelMapping(layout, metrics);
map.scaleX * 800 - map.originX; // 400 — the canvas's right edge, in CSS pixels
```

***

### progressFraction()

> **progressFraction**(`progress`): `number`

The fraction of an asset batch that is done.

#### Parameters

##### progress

`AssetProgress`

The payload of `app.assets.onProgress`.

#### Returns

`number`

The fraction, in `[0, 1]`.

#### Remarks

Bytes when the build recorded sizes, handles otherwise, and `1` for an empty batch — a loading
screen that never reaches 100% because nothing was queued is worse than one that closes at once.

#### Example

```ts
progressFraction({ loaded: 1, total: 4, bytesLoaded: 0, bytesTotal: 0 }); // 0.25
```

***

### renderMessage()

> **renderMessage**(`pattern`, `params`, `select`): `string`

Renders a parsed message.

#### Parameters

##### pattern

[`MessagePattern`](#messagepattern)

The parsed pattern.

##### params

[`MessageParams`](#messageparams)

The values to substitute.

##### select

[`PluralSelector`](#pluralselector)

The active locale's plural selector.

#### Returns

`string`

The rendered string.

#### Example

```ts
const pattern = parseMessage("{count, plural, one {# life} other {# lives}}");
renderMessage(pattern, { count: 3 }, createPluralSelector("en")); // "3 lives"
```

***

### resolveMenuChoices()

> **resolveMenuChoices**(`values`): readonly `string`[]

Reads a [MenuChoiceValues](#menuchoicevalues).

#### Parameters

##### values

[`MenuChoiceValues`](#menuchoicevalues)

The fixed list or the function.

#### Returns

readonly `string`[]

The values, in order.

***

### resolveMenuLabel()

> **resolveMenuLabel**(`label`, `fallback`): `string`

Reads a [MenuLabel](#menulabel).

#### Parameters

##### label

[`MenuLabel`](#menulabel) \| `undefined`

The fixed string, the function, or nothing.

##### fallback

`string`

What to answer when `label` is `undefined`.

#### Returns

`string`

The text to draw.

***

### snapToStep()

> **snapToStep**(`value`, `min`, `max`, `step`): `number`

Clamps a number into a range and snaps it to the step.

#### Parameters

##### value

`number`

The raw value.

##### min

`number`

The lowest allowed value.

##### max

`number`

The highest allowed value.

##### step

`number`

The grid the value is snapped to. A step of `0` or less disables snapping.

#### Returns

`number`

The clamped, snapped value.

#### Remarks

Snapping rather than accumulating is what stops a slider from drifting by floating-point error
after a few hundred key presses: every value is recomputed from `min` and a whole number of
steps.

#### Example

```ts
snapToStep(0.37, 0, 1, 0.05); // 0.35
```

***

### stickAxis()

> **stickAxis**(`delta`, `length`, `radius`, `deadZone`): `number`

Converts a raw deflection into the value written to the control.

#### Parameters

##### delta

`number`

The deflection along one axis, in UI units.

##### length

`number`

The deflection's length, in UI units.

##### radius

`number`

The radius at which the stick is fully deflected.

##### deadZone

`number`

The fraction of the radius below which the stick reads as centred.

#### Returns

`number`

The axis value, in `-1` to `1`.

#### Example

```ts
stickAxis(0, 0, 44, 0.15); // 0
stickAxis(44, 44, 44, 0.15); // 1
```

***

### uiError()

> **uiError**(`code`, `message`, `options?`): `IgnifxError`

Builds an `IgnifxError` carrying one of this package's codes.

#### Parameters

##### code

[`UiErrorCode`](#uierrorcode-1)

The code from the `UiErrorCode` table.

##### message

`string`

The actionable development sentence.

##### options?

[`UiErrorOptions`](#uierroroptions)

Context identifiers, a remedy hint, and the wrapped cause.

#### Returns

`IgnifxError`

The error to throw or to reject with.

#### Example

```ts
throw uiError(UiErrorCode.unknownLocale, "fr is not a locale strings.i18n.json declares.", {
  context: { locale: "fr" },
});
```

***

### uiSettingsSchema()

> **uiSettingsSchema**(): `Schema`

The schema the `ui` section is validated against.

#### Returns

`Schema`

The schema, built fresh so no module holds state (`CONSTITUTION.md` §3.5).
