import type { Dispatch, SetStateAction } from 'react'
import type { ModelConfig } from '../../../hooks/useChat'
import type { ModelPresetItem } from '../../../lib/model-presets'
import type { RightRailState } from './rightRailState'
import { RuntimeMode } from './RuntimeMode'
import {
  RightRailEmptyState,
  RightRailShell,
} from './RightRailPrimitives'

interface RightRailProps {
  state: RightRailState
  modelConfig: ModelConfig
  onModelConfigChange: (config: ModelConfig) => void
  modelPresets: ModelPresetItem[]
  selectedModelPresetId: string
  onModelPresetsChange: Dispatch<SetStateAction<ModelPresetItem[]>>
  onSelectedModelPresetIdChange: Dispatch<SetStateAction<string>>
}

const modeTitle: Record<RightRailState['mode'], string> = {
  context: 'Context',
  progress: 'Progress',
  artifact: 'Artifact',
  memory: 'Memory',
  runtime: 'Runtime',
  approval: 'Approval',
}

export function RightRail({
  state,
  modelConfig,
  onModelConfigChange,
  modelPresets,
  selectedModelPresetId,
  onModelPresetsChange,
  onSelectedModelPresetIdChange,
}: RightRailProps) {
  return (
    <RightRailShell isOpen={state.isOpen} ariaLabel="右侧工作区">
      {state.mode === 'runtime' ? (
        <RuntimeMode
          isActive={state.isOpen && state.mode === 'runtime'}
          modelConfig={modelConfig}
          onModelConfigChange={onModelConfigChange}
          modelPresets={modelPresets}
          selectedModelPresetId={selectedModelPresetId}
          onModelPresetsChange={onModelPresetsChange}
          onSelectedModelPresetIdChange={onSelectedModelPresetIdChange}
        />
      ) : (
        <div className="settings-scrollbar-hidden min-h-0 flex-1 overflow-y-auto pb-5">
          <RightRailEmptyState
            title={`${modeTitle[state.mode]} mode`}
            description="第一阶段只落地 RightRail 外壳与 Runtime mode；其它 mode 已进入统一状态模型，内容会在后续阶段接入。"
          />
        </div>
      )}
    </RightRailShell>
  )
}
