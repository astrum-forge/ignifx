/**
 * `@ignifx/audio` public barrel: the audio service and its mixer tree, `AudioSource`,
 * `AudioListener`, `MusicPlayer`, the `audio` and `audiobuses` assets, the two backends, and the
 * `audio()` extension (`docs/architecture/10-audio.md`). Explicit named re-exports only — no
 * `export *` (coding standards §4).
 *
 * @packageDocumentation
 */

// Type-only side effect: the module declares `app.audio` on `@ignifx/core`'s `App`, and naming it
// here is what keeps the augmentation in the bundled declarations. It emits no JavaScript.
// oxlint-disable-next-line import/no-unassigned-import -- the module is type-only; see its header.
import "./augmentation.js";

// assets — the `audio` clip type and the `audiobuses` file format.
export {
  AUDIO_ASSET_TYPE,
  AUDIO_FILE_EXTENSIONS,
  AudioClip,
  type AudioClipInit,
  type AudioClipLiteHandles,
} from "./assets/audio-clip.js";
export { createAudioClipLoader, type AudioClipLoaderOptions, type AudioDecoder } from "./assets/audio-clip-loader.js";
export {
  AUDIO_BUSES_ASSET_TYPE,
  AUDIO_BUSES_FILE_EXTENSION,
  AUDIO_BUSES_FORMAT,
  AUDIO_BUSES_FORMAT_VERSION,
  AudioBusesAsset,
  describeAudioBusesFormat,
  parseAudioBusesFile,
  type AudioBusDefinition,
} from "./assets/bus-file.js";
export { createAudioBusesLoader } from "./assets/bus-loader.js";
export { parseWavHeader, type WavHeader } from "./assets/wav-header.js";

// backend — the one contract the service and the components talk to.
export {
  AUDIO_DISTANCE_MODELS,
  type AudioBackend,
  type AudioBackendContext,
  type AudioBackendKind,
  type AudioBackendState,
  type AudioDistanceModel,
  type AudioLiteHandles,
  type BackendBus,
  type BackendBusRequest,
  type BackendPlayRequest,
  type BackendSound,
  type BackendSoundRequest,
  type BackendSpatialRequest,
} from "./backend/types.js";

// components — what a game puts on an entity.
export { AudioListener } from "./components/audio-listener.js";
export { AudioSource, type AudioConeSettings, type OneShotVolume } from "./components/audio-source.js";
export { MusicPlayer, type MusicPlayOptions, type MusicStopOptions } from "./components/music-player.js";

// errors — the `IGX-10xx` code space this package owns.
export { AUDIO_ERROR_MESSAGES, audioError, AudioErrorCode, type AudioErrorOptions } from "./errors.js";

// extension — the factory a game passes to `createApp`.
export { audio, type AudioOptions } from "./extension.js";

// headless — the simulation that makes gameplay audio testable under Node.
export {
  HeadlessBackend,
  HeadlessBus,
  HeadlessSound,
  type HeadlessBackendOptions,
} from "./headless/headless-backend.js";

// lite — the escape-hatch type aliases the public signatures name (`00-overview.md` §3).
export type {
  LiteAudioBus,
  LiteAudioEngine,
  LiteSoundBuffer,
  LiteSpatialTarget,
  LiteStaticSound,
  LiteStreamingSound,
} from "./lite/types.js";
export { createWebAudioBackend, WebAudioBackend } from "./lite/web/web-backend.js";

// schemas — the documentation harness's view of what this package declares.
export { describeSchemas } from "./schemas.js";

// service — `app.audio`, its buses, and the frame pump.
export { type AudioBus } from "./service/audio-bus.js";
export {
  AUDIO_DIAGNOSTICS_COUNTERS,
  AUDIO_DIAGNOSTICS_GROUP,
  AudioService,
  type AudioServiceLiteHandles,
  type AudioServiceOptions,
  type AudioServiceState,
  type CreateBusOptions,
  type OneShotOptions,
} from "./service/audio-service.js";
export { AUDIO_PUMP_ORDER } from "./service/audio-system.js";
export {
  SoundVoice,
  type PlayOptions,
  type SoundInstance,
  type VoiceHost,
  type VoiceRequest,
} from "./service/voice.js";

// settings — what a project writes in `ignifx.config.ts`.
export {
  audioSettingsSchema,
  AUDIO_SETTINGS_SECTION,
  DEFAULT_AUDIO_BUSES,
  DEFAULT_PAUSABLE_BUSES,
  DEFAULT_SOUND_BUS,
  defaultAudioSettings,
  type AudioSettings,
} from "./settings.js";

export { VERSION } from "./version.js";
