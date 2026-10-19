import { useEffect, useState } from 'react'
import type { AppUpdateState } from '../shared/updates'
import type { Result } from '../shared/model'
import { Icon, Modal } from './components'

export function AppUpdates() {
  const [state, setState] = useState<AppUpdateState | null>(null)
  const [open, setOpen] = useState(false)
  const [confirmRestart, setConfirmRestart] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const off = window.studio.onUpdateState(setState)
    void window.studio.getUpdateState().then((result) => { if (result.ok) setState(result.value); else setError(result.error) }).catch(() => setError('Update information is unavailable.'))
    return off
  }, [])
  async function run(action: Promise<Result<AppUpdateState>>) {
    setError(null)
    try {
      const result = await action
      if (!result.ok) throw new Error(result.error)
      setState(result.value)
    } catch (error) { setError(error instanceof Error ? error.message : 'Please try again.') }
  }
  const working = state?.phase === 'checking' || state?.phase === 'downloading' || state?.phase === 'installing'
  const heading = !state ? 'Loading update information…' : ({
    disabled: 'Automatic updates', idle: 'Keep your studio up to date', checking: 'Checking for updates…',
    'up-to-date': 'You’re up to date', downloading: `Downloading version ${state.availableVersion}…`,
    ready: `Version ${state.availableVersion} is ready`, installing: 'Saving progress and restarting…', error: 'Let’s try again'
  })[state.phase]
  return <>
    <button className={`nav-item help-button ${state?.phase === 'ready' ? 'update-ready' : ''}`} onClick={() => setOpen(true)}><Icon name="update" size={18} />{state?.phase === 'ready' ? 'Update ready' : 'App updates'}{state?.phase === 'ready' && <span className="update-dot" />}</button>
    {open && <Modal title="App updates" onClose={() => { setOpen(false); setConfirmRestart(false) }} busy={state?.phase === 'installing'}>
      <div className="update-content"><span className="large-symbol"><Icon name="update" size={29} /></span><h3>{heading}</h3>{state && <p className="update-version">MCQ Studio · Version {state.currentVersion}</p>}
        <p>{state?.message || (state?.phase === 'ready' ? 'Restart when you’re ready. Your question banks, progress, and history will be kept.' : state?.phase === 'downloading' ? 'You can keep studying while the update downloads. We’ll wait for you to choose when to restart.' : state?.phase === 'disabled' ? '' : 'The installed app checks automatically and downloads updates in the background. You choose when to restart.')}</p>
        {state?.phase === 'downloading' && <><progress value={state.progress ?? 0} max={100} aria-label="Update download progress" /><span className="update-percent">{state.progress ?? 0}% downloaded</span></>}
        {error && <p className="update-error" role="alert">{error}</p>}
        {confirmRestart && state?.phase === 'ready' && <div className="banner update-confirm"><Icon name="info" size={18} /><span>The app will close and reopen after installation. Your unfinished quiz will be saved. A timed exam keeps counting down.</span></div>}
      </div>
      <div className="modal-actions"><button className="button secondary" disabled={state?.phase === 'installing'} onClick={() => { setOpen(false); setConfirmRestart(false) }}>{state?.phase === 'ready' ? 'Later' : 'Close'}</button>{state?.phase === 'ready' ? <button className="button primary" onClick={() => { if (!confirmRestart) setConfirmRestart(true); else { setConfirmRestart(false); void run(window.studio.installUpdate()) } }}>{confirmRestart ? 'Save & restart now' : 'Restart to update'}<Icon name="update" size={16} /></button> : <button className="button primary" disabled={!state || state.phase === 'disabled' || working} onClick={() => { void run(window.studio.checkForUpdates()) }}>Check for updates<Icon name="update" size={16} /></button>}</div>
    </Modal>}
  </>
}
