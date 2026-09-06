/**
 * `@ignifx/3d` public barrel: the 3D toolkit — character and camera rigs, the `Animator` state
 * machine, navigation, and the environment helpers (`docs/architecture/12-3d-toolkit.md`).
 *
 * Explicit named re-exports only — no `export *` (coding standards §4). Everything the adapter owns
 * (`src/lite/**`) stays internal apart from the type aliases the `.lite` escape hatches name in
 * their signatures.
 *
 * @packageDocumentation
 */

// The augmentation that types `app.navigation`. Bare, and load-bearing: declaration bundling drops
// a module nothing references, and takes the `declare module` block with it. It emits no
// JavaScript, so `sideEffects: false` stays honest.
// oxlint-disable-next-line import/no-unassigned-import -- the module is type-only; see its header.
import "./augmentation.js";

// animator — the `.animator.json` document, its loader, the pure state machine, and the component.
export {
  ANIMATOR_ASSET_TYPE,
  ANIMATOR_CONDITION_OPS,
  ANIMATOR_FILE_EXTENSIONS,
  ANIMATOR_FORMAT,
  ANIMATOR_FORMAT_VERSION,
  ANIMATOR_MASK_MODES,
  ANIMATOR_PARAMETER_KINDS,
  ANY_STATE,
  defaultStateOf,
  defineAnimator,
  type AnimatorBlendChildDefinition,
  type AnimatorBlendTreeDefinition,
  type AnimatorConditionDefinition,
  type AnimatorConditionOp,
  type AnimatorDefinition,
  type AnimatorEventDefinition,
  type AnimatorInput,
  type AnimatorLayerDefinition,
  type AnimatorMaskMode,
  type AnimatorParameterDefinition,
  type AnimatorParameterKind,
  type AnimatorStateDefinition,
  type AnimatorTransitionDefinition,
} from "./animator/definition.js";
export { AnimatorAsset } from "./animator/animator-asset.js";
export { createAnimatorLoader } from "./animator/loader.js";
export {
  AnimatorStateMachine,
  DEFAULT_CLIP_LENGTH,
  type AnimatorPlayOptions,
  type ClipWeight,
  type StateChange,
} from "./animator/state-machine.js";
export { Animator } from "./animator/animator.js";
export { THREE_D_ANIMATION_ORDER, ThreeDAnimationSystem } from "./animator/animation-system.js";

// camera — the orbit rig and the "which camera is the main one" rule.
export { mainCamera, mainCameraForward, WORLD_FORWARD } from "./camera/main-camera.js";
export { ThirdPersonCamera } from "./camera/third-person-camera.js";

// character — the controllers, the movers, and the pure movement arithmetic they are built on.
export {
  cameraRelativeToRef,
  JumpTimers,
  jumpVelocity,
  projectOnSlopeToRef,
  slopeAngleDegrees,
  turnTowardsDegrees,
  yawFromDirection,
} from "./character/movement.js";
export { ThirdPersonController } from "./character/third-person-controller.js";
export { FirstPersonController } from "./character/first-person-controller.js";
export { PlatformMover, Projectile, RigidbodyMover } from "./character/movers.js";

// environment — the two Phase 7 helpers of `12-3d-toolkit.md` §6.
export { LOD_CULLED, LOD_ORDER, LodGroup, LodSystem, type LodLevel } from "./environment/lod-group.js";
export {
  BILLBOARD_MODES,
  BILLBOARD_ORDER,
  Billboard,
  BillboardSystem,
  type BillboardMode,
} from "./environment/billboard.js";

// errors — the `IGX-12##` code space this package owns.
export { THREE_D_ERROR_MESSAGES, ThreeDErrorCode, threeDError, type ThreeDErrorOptions } from "./errors.js";

// extension — the factory a game passes to `createApp`.
export { threeD, type ThreeDOptions } from "./extension.js";

// lite — the escape-hatch type aliases the `.lite` getters name in their signatures.
export type {
  LiteAnimationGroup,
  LiteAnimationManager,
  LiteNavCrowd,
  LiteNavigationPlugin,
  LiteObstacleHandle,
} from "./lite/types.js";

// navigation — the surfaces, the agents, the obstacles, and `app.navigation`.
export { NavMeshSurface } from "./navigation/nav-mesh-surface.js";
export { NavMeshAgent } from "./navigation/nav-mesh-agent.js";
export { NAV_OBSTACLE_SHAPES, NavMeshObstacle, type NavObstacleShape } from "./navigation/nav-mesh-obstacle.js";
export { NavigationService } from "./navigation/navigation-service.js";
export { NAVIGATION_ORDER, NavigationSystem } from "./navigation/navigation-system.js";

// schemas — what the documentation harness reads.
export { animatorFileSchema } from "./file-schemas.js";
export { describeAnimatorFormat, describeSchemas } from "./schemas.js";

// settings — the `threeD` project settings section.
export {
  defaultThreeDSettings,
  THREE_D_SETTINGS_SECTION,
  threeDSettingsSchema,
  type ThreeDSettings,
} from "./settings.js";

// version — the string reported as `Extension.version`.
export { VERSION } from "./version.js";
