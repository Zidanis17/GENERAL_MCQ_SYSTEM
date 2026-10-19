export type UpdatePhase = 'disabled' | 'idle' | 'checking' | 'up-to-date' | 'downloading' | 'ready' | 'installing' | 'error'

export interface AppUpdateState {
  currentVersion: string
  phase: UpdatePhase
  availableVersion: string | null
  progress: number | null
  message: string | null
}

export function updateDisabledReason(isPackaged: boolean, isPortable: boolean, hasFeed: boolean): string | null {
  if (!isPackaged) return 'Update checks are available in the installed app.'
  if (isPortable) return 'This is the portable edition. Install the setup edition to receive automatic updates.'
  if (!hasFeed) return 'This build is not connected to a release repository yet.'
  return null
}
