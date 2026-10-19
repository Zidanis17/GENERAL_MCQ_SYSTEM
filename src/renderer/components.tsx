import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { QuizSource, StartConfig } from '../shared/model'

export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    update: <><path d="M20 7a9 9 0 0 0-15-1L3 9m0-6v6h6M4 17a9 9 0 0 0 15 1l2-3m0 6v-6h-6" /></>,
    library: <><rect x="3" y="4" width="7" height="16" rx="1.5" /><path d="M6.5 8v8M14 5l4-1 4 15-4 1z" /></>,
    history: <><path d="M3 10a9 9 0 1 1 1 7M3 4v6h6M12 7v5l3 2" /></>,
    upload: <><path d="M12 16V3m-5 5 5-5 5 5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5" /></>,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    left: <path d="m14 6-6 6 6 6" />,
    right: <path d="m10 6 6 6-6 6" />,
    check: <path d="m5 12 4 4L19 6" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    file: <><path d="M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10zM13 3v7h7M8 14h8m-8 3h5" /></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
    trash: <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" /></>,
    spark: <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z" /></>,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6m0-10v.1" /></>,
    grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    leaf: <><path d="M20 4C8 2 3 7 5 14s14 7 15-10ZM5 20 16 9" /></>,
    download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" /></>
  }
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.file}</svg>
}

export function Logo() {
  return <span className="logo-mark"><svg width="25" height="25" viewBox="0 0 28 28" fill="none" aria-hidden="true"><rect x="5" y="4" width="17" height="20" rx="4" stroke="currentColor" strokeWidth="1.8" /><path d="m9 14 3.3 3.3L18 11" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
}

export function Modal({ title, children, onClose, busy = false, wide = false }: { title: string; children: ReactNode; onClose: () => void; busy?: boolean; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { const el = ref.current!; el.showModal(); return () => { el.close() } }, [])
  return <dialog ref={ref} className={`modal ${wide ? 'wide' : ''}`} aria-label={title} onCancel={(e) => { e.preventDefault(); if (!busy) onClose() }} onClick={(e) => { if (!busy && e.target === ref.current) { const rect = ref.current.getBoundingClientRect(); if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) onClose() } }}>
    <div className="modal-head"><h2>{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={onClose} disabled={busy}><Icon name="close" /></button></div>
    {children}
  </dialog>
}

export type Setup = { source: QuizSource; title: string; count: number }
export function SetupDialog({ setup, busy, onClose, onStart }: { setup: Setup; busy: boolean; onClose: () => void; onStart: (config: StartConfig) => void }) {
  const [mode, setMode] = useState<'practice' | 'exam'>('practice')
  const [count, setCount] = useState(setup.count)
  const [shuffleQuestions, setShuffleQuestions] = useState(false)
  const [shuffleOptions, setShuffleOptions] = useState(false)
  const [timer, setTimer] = useState('')
  return <Modal title="Make this session yours" onClose={onClose} busy={busy}>
    <p className="setup-bank" dir="auto">{setup.title}</p>
    <form onSubmit={(e) => { e.preventDefault(); onStart({ source: setup.source, mode, questionCount: count, shuffleQuestions, shuffleOptions, timeLimitMinutes: mode === 'exam' && timer ? Number(timer) : null, discardActive: false }) }}>
      <fieldset disabled={busy} className="form-fields">
        <legend className="sr-only">Quiz settings</legend>
        <div className="mode-switch"><button type="button" className={mode === 'practice' ? 'active' : ''} aria-pressed={mode === 'practice'} onClick={() => setMode('practice')}><Icon name="leaf" /> Practice</button><button type="button" className={mode === 'exam' ? 'active' : ''} aria-pressed={mode === 'exam'} onClick={() => setMode('exam')}><Icon name="clock" /> Exam</button></div>
        <p className="field-help mode-help">{mode === 'practice' ? 'Learn as you go. Check each answer and see an explanation.' : 'Test what you know. Answers stay hidden until you submit.'}</p>
        <div className="form-row"><label>Questions<input aria-label="Questions" type="number" min="1" max={setup.count} required value={count} onChange={(e) => setCount(e.target.valueAsNumber)} /><span className="field-help">of {setup.count} available</span></label>{mode === 'exam' && <label>Time limit <span className="optional">optional</span><input aria-label="Time limit" type="number" min="1" max="1440" placeholder="No limit" value={timer} onChange={(e) => setTimer(e.target.value)} /><span className="field-help">minutes · continues if you close the app</span></label>}</div>
        <label className="check-row"><input type="checkbox" checked={shuffleQuestions} onChange={(e) => setShuffleQuestions(e.target.checked)} /><span>Shuffle questions<small>Mix up the order for a fresh session.</small></span></label>
        <label className="check-row"><input type="checkbox" checked={shuffleOptions} onChange={(e) => setShuffleOptions(e.target.checked)} /><span>Shuffle answer choices<small>Keep the focus on understanding.</small></span></label>
      </fieldset>
      <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" className="button primary" disabled={busy}>Start {mode === 'practice' ? 'practice' : 'exam'}<Icon name="arrow" size={17} /></button></div>
    </form>
  </Modal>
}

export function Timer({ deadline }: { deadline: number }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(timer) }, [])
  const remaining = Math.max(0, Math.ceil((deadline - now) / 1000))
  return <span className={`timer ${remaining < 60 ? 'urgent' : ''}`} role="timer" aria-label="Time remaining"><Icon name="clock" size={17} />{Math.floor(remaining / 60).toString().padStart(2, '0')}:{(remaining % 60).toString().padStart(2, '0')}</span>
}

export function dateLabel(timestamp: number) { return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) }
export function durationLabel(start: number, end: number) {
  const seconds = Math.max(0, Math.round((end - start) / 1000))
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}
