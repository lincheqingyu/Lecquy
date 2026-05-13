export type RightRailMode =
  | 'context'
  | 'progress'
  | 'artifact'
  | 'memory'
  | 'runtime'
  | 'approval'

export type RightRailOpenReason = 'user' | 'system' | 'restore' | 'approval'

export interface RightRailArtifactRef {
  kind: 'attachment' | 'artifact'
  key: string
  sessionKey?: string | null
}

export interface RightRailMemoryRef {
  id: string
  kind?: string
}

export interface RightRailApprovalRef {
  id: string
  title: string
}

export interface RightRailProgressRef {
  runId?: string
  goal?: string
}

export interface RightRailState {
  isOpen: boolean
  mode: RightRailMode
  openReason: RightRailOpenReason
  pinnedMode: RightRailMode | null
  lastNonBlockingMode: RightRailMode
  artifactRef: RightRailArtifactRef | null
  memoryRef: RightRailMemoryRef | null
  approvalRef: RightRailApprovalRef | null
  progressRef: RightRailProgressRef | null
}

export type RightRailAction =
  | {
      type: 'open-mode'
      mode: RightRailMode
      reason?: RightRailOpenReason
      pin?: boolean
    }
  | {
      type: 'toggle-mode'
      mode: RightRailMode
      reason?: RightRailOpenReason
      pin?: boolean
    }
  | { type: 'close' }
  | { type: 'reset-session' }
  | { type: 'set-artifact-ref'; ref: RightRailArtifactRef | null }

const DEFAULT_MODE: RightRailMode = 'context'

function isUserInspectMode(mode: RightRailMode): boolean {
  return mode === 'artifact' || mode === 'memory' || mode === 'runtime'
}

function openMode(
  state: RightRailState,
  mode: RightRailMode,
  reason: RightRailOpenReason,
  pin?: boolean,
): RightRailState {
  if (state.mode === 'approval' && mode !== 'approval') return state
  if (reason === 'system' && state.pinnedMode && state.pinnedMode !== mode) return state

  const shouldPin = pin ?? (reason === 'user' && isUserInspectMode(mode))

  return {
    ...state,
    isOpen: true,
    mode,
    openReason: reason,
    pinnedMode: shouldPin ? mode : state.pinnedMode,
    lastNonBlockingMode: mode === 'approval' ? state.lastNonBlockingMode : mode,
  }
}

export function createInitialRightRailState(): RightRailState {
  return {
    isOpen: false,
    mode: DEFAULT_MODE,
    openReason: 'restore',
    pinnedMode: null,
    lastNonBlockingMode: DEFAULT_MODE,
    artifactRef: null,
    memoryRef: null,
    approvalRef: null,
    progressRef: null,
  }
}

export function rightRailReducer(state: RightRailState, action: RightRailAction): RightRailState {
  switch (action.type) {
    case 'open-mode':
      return openMode(state, action.mode, action.reason ?? 'user', action.pin)
    case 'toggle-mode':
      if (state.isOpen && state.mode === action.mode) {
        return rightRailReducer(state, { type: 'close' })
      }
      return openMode(state, action.mode, action.reason ?? 'user', action.pin)
    case 'close':
      if (state.mode === 'approval') return state
      return {
        ...state,
        isOpen: false,
        openReason: 'user',
        pinnedMode: null,
      }
    case 'reset-session':
      return createInitialRightRailState()
    case 'set-artifact-ref':
      return {
        ...state,
        artifactRef: action.ref,
      }
    default:
      return state
  }
}
