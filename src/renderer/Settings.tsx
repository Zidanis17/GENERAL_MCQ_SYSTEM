import { useEffect, useState } from 'react'
import { DEFAULT_SETTINGS, type AppSettings } from '../shared/model'
import { Icon } from './components'

export function applyAppearance(settings: AppSettings) {
  document.documentElement.dataset.theme = settings.theme
  document.documentElement.dataset.studyTextSize = settings.studyTextSize
}

export function Settings({ settings, busy, onChange }: { settings: AppSettings; busy: boolean; onChange: (change: Partial<AppSettings>) => void }) {
  const [timer, setTimer] = useState('')
  useEffect(() => setTimer(settings.timeLimitMinutes?.toString() ?? ''), [settings.timeLimitMinutes])
  const update = onChange
  return <>
    <div className="page-heading"><div><span className="eyebrow">MAKE YOURSELF AT HOME</span><h1>Settings<span className="title-dot">.</span></h1><p>Small adjustments for the way you study. Changes save automatically.</p></div></div>
    <div className="settings-sections">
      <fieldset className="settings-card" disabled={busy}>
        <legend>Appearance</legend>
        <p className="settings-description">Choose a theme for your workspace.</p>
        <div className="setting-choices" role="group" aria-label="Theme">
          {(['light', 'dark', 'system'] as const).map((theme) => <button type="button" key={theme} className={`setting-choice ${settings.theme === theme ? 'active' : ''}`} aria-pressed={settings.theme === theme} onClick={() => update({ theme })}><Icon name={theme === 'light' ? 'sun' : theme === 'dark' ? 'moon' : 'monitor'} size={22} /><strong>{theme[0].toUpperCase() + theme.slice(1)}</strong><small>{theme === 'system' ? 'Follow Windows' : theme === 'dark' ? 'A softer glow' : 'Bright and clear'}</small></button>)}
        </div>
        <h2 className="setting-label">Study text size</h2><p className="settings-description">Adjust questions, answer choices, and explanations.</p>
        <div className="setting-choices" role="group" aria-label="Study text size">
          {(['standard', 'large', 'extra-large'] as const).map((studyTextSize, index) => <button type="button" key={studyTextSize} className={`setting-choice text-size-choice ${settings.studyTextSize === studyTextSize ? 'active' : ''}`} aria-pressed={settings.studyTextSize === studyTextSize} onClick={() => update({ studyTextSize })}><span aria-hidden="true" style={{ fontSize: 19 + index * 4 }}>Aa</span><strong>{['Standard', 'Large', 'Extra large'][index]}</strong></button>)}
        </div>
        <div className="text-preview"><span className="eyebrow">PREVIEW</span><p>Every question is a chance to learn.</p><span>Choose the answer that fits best.</span></div>
      </fieldset>
      <fieldset className="settings-card" disabled={busy}>
        <legend>Study defaults</legend><p className="settings-description">Start new sessions with your preferences. You can adjust them each time.</p>
        <div className="mode-switch" role="group" aria-label="Default study mode">{(['practice', 'exam'] as const).map((defaultMode) => <button type="button" key={defaultMode} className={settings.defaultMode === defaultMode ? 'active' : ''} aria-pressed={settings.defaultMode === defaultMode} onClick={() => update({ defaultMode })}><Icon name={defaultMode === 'practice' ? 'leaf' : 'clock'} size={18} />{defaultMode === 'practice' ? 'Practice' : 'Exam'}</button>)}</div>
        <label className="check-row"><input type="checkbox" checked={settings.shuffleQuestions} onChange={(e) => update({ shuffleQuestions: e.target.checked })} /><span>Shuffle questions<small>Mix up the final question order.</small></span></label>
        <label className="check-row"><input type="checkbox" checked={settings.shuffleOptions} onChange={(e) => update({ shuffleOptions: e.target.checked })} /><span>Shuffle answer choices<small>Give the choices a different order.</small></span></label>
        <label className="setting-timer">Default exam time limit <span className="optional">optional</span><input aria-label="Default exam time limit" type="number" min="1" max="1440" step="1" placeholder="No limit" value={timer} onChange={(e) => setTimer(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } }} onBlur={(e) => {
          if (!e.currentTarget.validity.valid) { e.currentTarget.reportValidity(); return }
          const value = timer === '' ? null : Number(timer)
          if (value !== settings.timeLimitMinutes) update({ timeLimitMinutes: value })
        }} /><span className="field-help">1–1440 minutes, or leave blank for no limit. Applies to exams only.</span></label>
      </fieldset>
    </div>
    <div className="settings-footer"><span className="field-help">Preferences stay on this device.</span><button className="button secondary" disabled={busy} onClick={() => { setTimer(''); onChange({ ...DEFAULT_SETTINGS }) }}>Reset settings</button></div>
  </>
}
