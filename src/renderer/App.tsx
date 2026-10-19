import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import { bankSchema, MAX_IMPORT_BYTES, selectedAnswer, type AppState, type Attempt, type QuestionBank, type QuizSession, type Result, type StartConfig } from '../shared/model'
import exampleJSON from '../../examples/general-knowledge.json'
import { dateLabel, durationLabel, Icon, Logo, Modal, SetupDialog, Timer, type Setup } from './components'

type Page = 'library' | 'history' | 'quiz' | 'result'
type Confirmation = { title: string; body: string; label: string; danger?: boolean; action: () => Promise<void>; resume?: () => void }
const api = window.studio
const example = bankSchema.parse(exampleJSON)
async function unwrap<T>(promise: Promise<Result<T>>): Promise<T> {
  const result = await promise
  if (!result.ok) throw new Error(result.error)
  return result.value
}

export function App() {
  const [data, setData] = useState<AppState | null>(null)
  const dataRef = useRef<AppState | null>(null)
  const [page, setPage] = useState<Page>('library')
  const pageRef = useRef<Page>('library')
  const [resultId, setResultId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const working = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [setup, setSetup] = useState<Setup | null>(null)
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [help, setHelp] = useState(false)
  const [dragging, setDragging] = useState(false)
  const dragCount = useRef(0)

  const go = useCallback((next: Page) => { pageRef.current = next; setPage(next) }, [])
  const receive = useCallback((next: AppState) => {
    const previous = dataRef.current
    dataRef.current = next
    setData(next)
    if (previous?.activeSession && !next.activeSession && pageRef.current === 'quiz') {
      const result = next.attempts.find((a) => a.id === previous.activeSession?.id)
      if (result) { setResultId(result.id); go('result') }
      else go('library')
    }
  }, [go])
  const perform = useCallback(async (action: () => Promise<void>) => {
    if (working.current) return
    working.current = true; setBusy(true); setError(null)
    try { await action() } catch (err) { setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.') }
    finally { working.current = false; setBusy(false) }
  }, [])

  useEffect(() => {
    void perform(async () => { const loaded = await unwrap(api.load()); receive(loaded.state); setNotice(loaded.notice) })
    const offState = api.onState((next) => { receive(next); setConfirmation(null); setToast('Time is up. Your exam has been submitted and saved.') })
    const offError = api.onError(setError)
    return () => { offState(); offError() }
  }, [perform, receive])
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(null), 5000); return () => clearTimeout(timer) }, [toast])

  function openBank(bank: QuestionBank) { setSetup({ source: { kind: 'bank', id: bank.id }, title: bank.title, count: bank.questions.length }) }
  async function acceptBank(bank: QuestionBank) {
    const existing = dataRef.current?.banks.find((entry) => entry.bank.id === bank.id)
    if (existing) {
      setConfirmation({ title: 'Replace this question bank?', body: `“${existing.bank.title}” uses the same bank ID. Replace it with “${bank.title}”? Your past results and unfinished quiz will be kept.`, label: 'Replace bank', action: async () => { receive(await unwrap(api.saveBank(bank, true))); setConfirmation(null); setToast('Question bank updated.'); go('library') } })
    } else { receive(await unwrap(api.saveBank(bank, false))); setToast('Question bank added to your library.'); go('library') }
  }
  function chooseBank() { void perform(async () => { const bank = await unwrap(api.chooseBank()); if (bank) await acceptBank(bank) }) }
  function importFile(file: File | undefined) {
    if (!file) return
    void perform(async () => {
      if (file.size > MAX_IMPORT_BYTES) throw new Error('This file exceeds the 10 MiB limit.')
      await acceptBank(await unwrap(api.parseBank(await file.text())))
    })
  }
  function dropFile(event: DragEvent) {
    event.preventDefault(); setDragging(false); dragCount.current = 0
    if (confirmation || setup || help) return
    if (event.dataTransfer.files.length !== 1) { setError('Please import one JSON question bank at a time.'); return }
    importFile(event.dataTransfer.files[0])
  }
  function tryExample() {
    void perform(async () => {
      let bank = dataRef.current?.banks.find((entry) => entry.bank.id === example.id)?.bank
      if (!bank) { receive(await unwrap(api.saveBank(example, false))); bank = example }
      openBank(bank)
    })
  }
  async function begin(config: StartConfig) {
    const next = await unwrap(api.start(config))
    receive(next); setSetup(null); setConfirmation(null); go('quiz')
  }
  function start(config: StartConfig) {
    if (data?.activeSession) {
      setConfirmation({ title: 'You have a session in progress', body: `Resume “${data.activeSession.bankTitle}”, or discard that progress and start this session. Completed results will be kept.`, label: 'Discard & start', danger: true, action: () => begin({ ...config, discardActive: true }), resume: () => { setSetup(null); setConfirmation(null); go('quiz') } })
    } else void perform(() => begin(config))
  }
  function submit() {
    if (!data?.activeSession) return
    const unanswered = data.activeSession.questions.filter((q) => selectedAnswer(data.activeSession!, q.id) === undefined).length
    setConfirmation({ title: 'Ready to finish?', body: unanswered ? `You have ${unanswered} unanswered question${unanswered === 1 ? '' : 's'}. Unanswered questions receive no points. Submit to see your results.` : 'Your answers will be saved, and you can review your results and explanations.', label: 'Submit quiz', action: async () => { receive(await unwrap(api.submit())); setConfirmation(null) } })
  }
  function openResult(attempt: Attempt) { setResultId(attempt.id); go('result') }
  function retry(attempt: Attempt, missedOnly: boolean) {
    const count = missedOnly ? attempt.summary.incorrect + attempt.summary.unanswered : attempt.summary.total
    setSetup({ source: { kind: 'attempt', id: attempt.id, missedOnly }, title: attempt.session.bankTitle, count })
  }

  if (!data) return <main className="loading-screen"><Logo /><h1>MCQ Studio</h1><p>{error || 'Getting your library ready…'}</p>{error && <button className="button primary" onClick={() => location.reload()}>Try again</button>}</main>
  const currentResult = data.attempts.find((a) => a.id === resultId)
  const isStudying = page === 'quiz' || page === 'result'
  const visibleBanks = data.banks.filter(({ bank }) => bank.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
  const answered = data.activeSession ? Object.keys(data.activeSession.answers).length : 0

  return <div className="app" onDragEnter={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); dragCount.current++; setDragging(true) } }} onDragLeave={(e) => { if (e.dataTransfer.types.includes('Files')) { dragCount.current--; if (dragCount.current <= 0) setDragging(false) } }} onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = busy ? 'none' : 'copy' }} onDrop={dropFile}>
    <input className="sr-only" type="file" accept=".json,application/json" tabIndex={-1} aria-hidden="true" data-testid="file-input" onChange={(e) => { importFile(e.target.files?.[0]); e.target.value = '' }} />
    <aside className="sidebar">
      <a href="#" className="brand" onClick={(e) => { e.preventDefault(); go('library') }}><Logo /><span>MCQ <strong>Studio</strong></span></a>
      <div className="workspace-label">YOUR WORKSPACE</div>
      <nav aria-label="Main navigation"><button className={`nav-item ${page === 'library' ? 'active' : ''}`} onClick={() => go('library')}><Icon name="library" />Library<span className="nav-count">{data.banks.length}</span></button><button className={`nav-item ${page === 'history' || page === 'result' ? 'active' : ''}`} onClick={() => go('history')}><Icon name="history" />History{data.attempts.length > 0 && <span className="nav-count">{data.attempts.length}</span>}</button></nav>
      {data.activeSession && <div className="sidebar-session"><span className="eyebrow">IN PROGRESS</span><p dir="auto">{data.activeSession.bankTitle}</p><span>{answered} of {data.activeSession.questions.length} answered</span><button className="text-button" onClick={() => go('quiz')}>Resume session<Icon name="arrow" size={15} /></button></div>}
      <div className="sidebar-bottom"><button className="nav-item help-button" onClick={() => setHelp(true)}><Icon name="info" size={18} />File format & help</button><div className="offline"><span className="status-dot" />All yours. All offline.<small>MCQ Studio · 1.0</small></div></div>
    </aside>
    <main className={`main ${isStudying ? 'study-main' : ''}`} aria-busy={busy}>
      <header className="topbar"><div className="breadcrumb">Workspace<span>/</span><strong>{page === 'library' ? 'Library' : page === 'history' ? 'History' : page === 'quiz' ? 'Session' : 'Results'}</strong></div><span className="local-label"><span className="status-dot" />Saved on this device</span></header>
      <div className="content">
        {error && <div className="banner error" role="alert"><Icon name="info" /><span>{error}</span><button className="icon-button" aria-label="Dismiss error" onClick={() => setError(null)}><Icon name="close" size={17} /></button></div>}
        {notice && <div className="banner" role="status"><Icon name="info" /><span>{notice}</span><button className="icon-button" aria-label="Dismiss notice" onClick={() => setNotice(null)}><Icon name="close" size={17} /></button></div>}
        {page === 'library' && <>
          <div className="page-heading"><div><span className="eyebrow">A LITTLE PROGRESS, EVERY DAY</span><h1>Your library<span className="title-dot">.</span></h1><p>A place for everything you’re learning.</p></div><button className="button primary" onClick={chooseBank} disabled={busy}><Icon name="upload" size={18} />Import question bank</button></div>
          <div className="stats"><div><span className="stat-icon blue"><Icon name="library" /></span><div><strong>{data.banks.length}</strong><span>Question banks</span></div></div><div><span className="stat-icon violet"><Icon name="file" /></span><div><strong>{data.banks.reduce((sum, entry) => sum + entry.bank.questions.length, 0).toLocaleString()}</strong><span>Questions to explore</span></div></div><div><span className="stat-icon green"><Icon name="check" /></span><div><strong>{data.attempts.length}</strong><span>Sessions completed</span></div></div></div>
          {data.activeSession && <div className="resume-banner"><div className="resume-symbol"><Icon name="clock" size={22} /></div><div><strong>Pick up where you left off</strong><p><bdi>{data.activeSession.bankTitle}</bdi><span className="middle-dot">·</span>{answered} of {data.activeSession.questions.length} answered</p></div><button className="button secondary" onClick={() => go('quiz')}>Resume<Icon name="arrow" size={16} /></button></div>}
          <div className="section-heading"><h2>Question banks<span>{data.banks.length}</span></h2><label className="search"><Icon name="search" size={17} /><input aria-label="Search question banks" placeholder="Search your library…" value={search} onChange={(e) => setSearch(e.target.value)} /></label></div>
          {data.banks.length === 0 ? <div className="empty-library"><div className="empty-illustration"><div className="paper behind" /><div className="paper front"><span className="paper-line" /><span className="paper-line short" /><span className="paper-choice"><i /><b /></span><span className="paper-choice selected"><i /><b /></span><span className="paper-choice"><i /><b /></span></div><span className="floating-check"><Icon name="check" size={21} /></span></div><h2>Your next chapter starts here</h2><p>Bring your questions. We’ll make room for the learning.<br />Import a JSON question bank to get started.</p><button className="button primary" onClick={chooseBank} disabled={busy}><Icon name="upload" size={17} />Choose a JSON file</button><span className="drop-hint">or drop your file anywhere in the app · up to 10 MiB</span></div> : visibleBanks.length === 0 ? <div className="empty-small"><Icon name="search" size={30} /><h3>No matching banks</h3><p>Try another title or <button className="text-button inline" onClick={() => setSearch('')}>clear your search</button>.</p></div> : <div className="bank-grid">{visibleBanks.map(({ bank, importedAt }, index) => <article className="bank-card" key={bank.id}><div className="bank-card-top"><span className={`bank-icon tone-${index % 3}`}><Icon name="file" size={23} /></span><button className="icon-button delete-button" aria-label={`Delete ${bank.title}`} disabled={busy} onClick={() => setConfirmation({ title: 'Remove this question bank?', body: `Remove “${bank.title}” from your library? Your saved results and unfinished session will be kept. You can import the file again later.`, label: 'Remove bank', danger: true, action: async () => { receive(await unwrap(api.removeBank(bank.id))); setConfirmation(null); setToast('Question bank removed.') } })}><Icon name="trash" size={17} /></button></div><h3 dir="auto">{bank.title}</h3><p className="bank-description" dir="auto">{bank.description || 'A fresh set of questions. Ready when you are.'}</p><div className="bank-meta"><span>{bank.questions.length} questions</span><span>Added {dateLabel(importedAt)}</span></div><button className="button card-button" onClick={() => openBank(bank)} disabled={busy}>Start studying<Icon name="arrow" size={17} /></button></article>)}</div>}
          <div className="example-banner"><span className="example-icon"><Icon name="spark" size={22} /></span><div><strong>A small start goes a long way.</strong><p>Try our example bank, or save it to see how to format your own.</p></div><button className="text-button" onClick={tryExample} disabled={busy}>Try the example<Icon name="arrow" size={16} /></button></div>
          <div className="page-footer"><Icon name="leaf" size={15} />Your questions stay on your computer. Study at your own pace.</div>
        </>}
        {page === 'history' && <><div className="page-heading"><div><span className="eyebrow">EVERY SESSION COUNTS</span><h1>Your progress<span className="title-dot">.</span></h1><p>Look back, learn a little more, and keep going.</p></div></div>{data.attempts.length === 0 ? <div className="empty-small history-empty"><span className="large-symbol"><Icon name="history" size={30} /></span><h2>A fresh start</h2><p>Your completed sessions will appear here.<br />Start with a question bank from your library.</p><button className="button primary" onClick={() => go('library')}>Explore your library<Icon name="arrow" size={17} /></button></div> : <div className="history-list">{data.attempts.map((attempt) => <button className="history-card" key={attempt.id} onClick={() => openResult(attempt)}><span className={`history-score ${attempt.summary.percentage >= 70 ? 'good' : ''}`}>{attempt.summary.percentage}<small>%</small></span><span className="history-info"><strong dir="auto">{attempt.session.bankTitle}</strong><span>{attempt.session.mode === 'practice' ? 'Practice' : 'Exam'}<span className="middle-dot">·</span>{dateLabel(attempt.submittedAt)}<span className="middle-dot">·</span>{attempt.summary.total} questions{attempt.reason === 'expired' && <span className="time-ended">Time ended</span>}</span></span><span className="history-correct">{attempt.summary.correct} / {attempt.summary.total}<small>correct</small></span><Icon name="right" size={19} /></button>)}</div>}</>}
        {page === 'quiz' && data.activeSession && <QuizScreen session={data.activeSession} busy={busy} onBack={() => go('library')} onAnswer={(q, o) => { void perform(async () => receive(await unwrap(api.answer(q, o)))) }} onCheck={(id) => { void perform(async () => receive(await unwrap(api.check(id)))) }} onNavigate={(index) => { void perform(async () => receive(await unwrap(api.navigate(index)))) }} onSubmit={submit} />}
        {page === 'quiz' && !data.activeSession && <div className="empty-small"><h2>You’re all caught up.</h2><button className="button primary" onClick={() => go('library')}>Back to library</button></div>}
        {page === 'result' && currentResult && <ResultScreen attempt={currentResult} onBack={() => go('history')} onRetry={(missed) => retry(currentResult, missed)} />}
      </div>
    </main>
    {setup && <SetupDialog key={`${setup.source.kind}-${setup.source.id}`} setup={setup} busy={busy} onClose={() => setSetup(null)} onStart={start} />}
    {help && <Modal title="Your questions, one simple file" wide onClose={() => setHelp(false)} busy={busy}><div className="help-content"><p>Import a UTF-8 JSON file with this structure. You can write your own, or ask a tool to create one in this format.</p><pre>{JSON.stringify({ schemaVersion: 1, id: 'my-bank', title: 'My question bank', questions: [{ id: 'q1', prompt: 'What is 2 + 2?', options: [{ id: 'a', text: '3' }, { id: 'b', text: '4' }], correctOptionId: 'b', explanation: 'Two plus two equals four.' }] }, null, 2)}</pre><ul><li>Each question needs two or more choices and one correct answer.</li><li>Bank, question, and option IDs are nonempty text. Question IDs must be unique in a bank; option IDs must be unique in a question.</li><li><code>description</code> on the bank and <code>explanation</code> on questions are optional.</li><li>Text can be in any language. Images and text formatting are not supported.</li><li>Files can be up to 10 MiB. Import a bank with the same ID to update it.</li></ul><p className="muted">Everything stays on this device. Practice checks answers as you go. Exams reveal answers after submission; timed exams keep counting down if you close the app.</p></div><div className="modal-actions"><button className="button secondary" onClick={() => setHelp(false)} disabled={busy}>Done</button><button className="button primary" disabled={busy} onClick={() => { void perform(async () => { if (await unwrap(api.exportExample())) setToast('Example JSON saved.') }) }}><Icon name="download" size={17} />Save example JSON</button></div></Modal>}
    {confirmation && <Modal title={confirmation.title} busy={busy} onClose={() => setConfirmation(null)}><p className="confirmation-body">{confirmation.body}</p><div className="modal-actions">{confirmation.resume ? <button className="button secondary" onClick={confirmation.resume} disabled={busy}>Resume existing</button> : <button className="button secondary" onClick={() => setConfirmation(null)} disabled={busy}>Cancel</button>}<button className={`button ${confirmation.danger ? 'danger' : 'primary'}`} disabled={busy} onClick={() => { void perform(confirmation.action) }}>{confirmation.label}</button></div></Modal>}
    {toast && <div className="toast" role="status"><span className="toast-check"><Icon name="check" size={16} /></span>{toast}<button className="icon-button" aria-label="Dismiss notification" onClick={() => setToast(null)}><Icon name="close" size={15} /></button></div>}
    {dragging && !setup && !confirmation && !help && <div className="drop-overlay"><div><Icon name="upload" size={40} /><h2>Make room for something new.</h2><p>Drop your JSON question bank here.</p><span>One file · up to 10 MiB</span></div></div>}
  </div>
}

function QuizScreen({ session, busy, onBack, onAnswer, onCheck, onNavigate, onSubmit }: { session: QuizSession; busy: boolean; onBack: () => void; onAnswer: (question: string, option: string) => void; onCheck: (id: string) => void; onNavigate: (index: number) => void; onSubmit: () => void }) {
  const question = session.questions[session.currentIndex]
  const selected = selectedAnswer(session, question.id)
  const checked = session.checkedIds.includes(question.id)
  const correct = checked && selected === question.correctOptionId
  const answered = Object.keys(session.answers).length
  return <>
    <button className="text-button back-button" onClick={onBack}><Icon name="left" size={16} />Back to library<span className="muted">— progress is saved</span></button>
    <div className="quiz-heading"><div><span className="badge">{session.mode === 'practice' ? 'PRACTICE SESSION' : 'EXAM SESSION'}</span><h1 dir="auto">{session.bankTitle}</h1></div>{session.deadline !== null && <Timer deadline={session.deadline} />}</div>
    <div className="quiz-layout"><section className="question-panel" aria-label="Current question"><div className="question-top"><span className="eyebrow">QUESTION {session.currentIndex + 1} OF {session.questions.length}</span><span className="muted">Choose one answer</span></div><h2 className="question-prompt" dir="auto">{question.prompt}</h2><fieldset className="answer-options" disabled={busy || checked}><legend className="sr-only">Answer choices</legend>{question.options.map((option, index) => {
      const isSelected = selected === option.id
      const isCorrect = checked && option.id === question.correctOptionId
      const isWrong = checked && isSelected && !isCorrect
      return <label key={option.id} className={`answer-option ${isSelected ? 'selected' : ''} ${isCorrect ? 'correct' : ''} ${isWrong ? 'wrong' : ''}`}><input type="radio" name={`answer-${question.id}`} value={option.id} checked={isSelected} onChange={() => onAnswer(question.id, option.id)} /><span className="option-letter">{index < 26 ? String.fromCharCode(65 + index) : index + 1}</span><span className="option-text" dir="auto">{option.text}</span>{isCorrect && <Icon name="check" size={18} />}{isWrong && <Icon name="close" size={18} />}</label>
    })}</fieldset>{checked && <div className={`answer-feedback ${correct ? 'correct' : 'wrong'}`} role="status"><strong><Icon name={correct ? 'check' : 'info'} size={18} />{correct ? 'That’s right. Nicely done.' : 'A good moment to learn.'}</strong>{!correct && <p dir="auto">Correct answer: {question.options.find((o) => o.id === question.correctOptionId)?.text}</p>}{question.explanation && <p dir="auto">{question.explanation}</p>}</div>}<div className="question-bottom"><button className="button secondary" disabled={busy || session.currentIndex === 0} onClick={() => onNavigate(session.currentIndex - 1)}><Icon name="left" size={16} />Previous</button><div className="question-next">{session.mode === 'practice' && !checked && <button className="button primary" disabled={busy || selected === undefined} onClick={() => onCheck(question.id)}>Check answer<Icon name="check" size={17} /></button>}{session.currentIndex < session.questions.length - 1 ? <button className={`button ${session.mode === 'exam' || checked ? 'primary' : 'secondary'}`} disabled={busy} onClick={() => onNavigate(session.currentIndex + 1)}>Next<Icon name="right" size={16} /></button> : <button className={`button ${checked || session.mode === 'exam' ? 'primary' : 'secondary'}`} disabled={busy} onClick={onSubmit}>Finish quiz<Icon name="arrow" size={16} /></button>}</div></div></section>
      <aside className="question-sidebar"><div className="navigator-title"><Icon name="grid" size={17} /><h3>Your session</h3></div><p>{answered} of {session.questions.length} answered</p><progress value={answered} max={session.questions.length} aria-label="Questions answered" /><div className="question-grid">{session.questions.map((q, index) => <button key={q.id} aria-label={`Go to question ${index + 1}${selectedAnswer(session, q.id) !== undefined ? ', answered' : ''}`} aria-current={index === session.currentIndex ? 'step' : undefined} className={`${selectedAnswer(session, q.id) !== undefined ? 'answered' : ''} ${index === session.currentIndex ? 'current' : ''}`} disabled={busy} onClick={() => onNavigate(index)}>{index + 1}</button>)}</div><div className="navigator-legend"><span><i className="legend-answered" />Answered</span><span><i />Unanswered</span></div><button className="button secondary submit-button" onClick={onSubmit} disabled={busy}>Submit quiz<Icon name="arrow" size={16} /></button><p className="session-note"><Icon name="info" size={15} />{session.mode === 'practice' ? 'Check your answer to learn as you go. You can revisit any question.' : 'You can change your answers until you submit. Take your time.'}</p></aside></div>
  </>
}

function ResultScreen({ attempt, onBack, onRetry }: { attempt: Attempt; onBack: () => void; onRetry: (missed: boolean) => void }) {
  const [missedOnly, setMissedOnly] = useState(false)
  useEffect(() => setMissedOnly(false), [attempt.id])
  const { summary, session } = attempt
  const missed = summary.incorrect + summary.unanswered
  return <>
    <button className="text-button back-button" onClick={onBack}><Icon name="left" size={16} />Back to history</button>
    <div className="page-heading result-heading"><div><span className="eyebrow">ANOTHER STEP FORWARD</span><h1>Session complete<span className="title-dot">.</span></h1><p dir="auto">{session.bankTitle}</p></div><button className="button primary" onClick={() => onRetry(false)}>Practice again<Icon name="arrow" size={17} /></button></div>
    {attempt.reason === 'expired' && <div className="banner"><Icon name="clock" size={19} /><span>Time ended. Your exam was submitted automatically with the answers you had saved.</span></div>}
    <section className="result-summary" aria-label="Quiz results"><div className="score-ring"><svg viewBox="0 0 120 120" aria-hidden="true"><circle className="ring-track" cx="60" cy="60" r="51" /><circle className="ring-value" cx="60" cy="60" r="51" strokeDasharray={`${summary.percentage * 3.2044} 320.44`} /></svg><div><strong>{summary.percentage}<small>%</small></strong><span>your score</span></div></div><div className="result-message"><h2>{summary.percentage === 100 ? 'A clean sweep. Well done.' : summary.percentage >= 70 ? 'You’re making great progress.' : 'Every question is a chance to learn.'}</h2><p>{summary.correct} of {summary.total} correct. {missed ? 'Take a look below and build on what you know.' : 'Keep the momentum going with another session.'}</p><span className="result-meta">{session.mode === 'practice' ? 'Practice' : 'Exam'}<span className="middle-dot">·</span>{dateLabel(attempt.submittedAt)}<span className="middle-dot">·</span>{durationLabel(session.startedAt, session.deadline === null ? attempt.submittedAt : Math.min(attempt.submittedAt, session.deadline))}</span></div><div className="result-counts"><span><i className="dot-correct" /><strong>{summary.correct}</strong>Correct</span><span><i className="dot-wrong" /><strong>{summary.incorrect}</strong>Incorrect</span><span><i className="dot-unanswered" /><strong>{summary.unanswered}</strong>Unanswered</span></div></section>
    <div className="section-heading review-heading"><h2>Review your answers</h2><div className="review-controls"><label className="compact-check"><input type="checkbox" checked={missedOnly} onChange={(e) => setMissedOnly(e.target.checked)} />Missed only</label>{missed > 0 && <button className="button secondary small" onClick={() => onRetry(true)}>Retry {missed} missed<Icon name="arrow" size={15} /></button>}</div></div>
    <div className="review-list">{session.questions.map((question, index) => {
      const selected = selectedAnswer(session, question.id)
      const correct = selected === question.correctOptionId
      if (missedOnly && correct) return null
      return <article className="review-card" key={question.id}><div className="review-top"><span className="eyebrow">QUESTION {index + 1}</span><span className={`review-badge ${correct ? 'correct' : selected === undefined ? 'unanswered' : 'wrong'}`}>{correct ? 'Correct' : selected === undefined ? 'Unanswered' : 'Incorrect'}</span></div><h3 dir="auto">{question.prompt}</h3><div className="review-options">{question.options.map((option, i) => <div key={option.id} className={`review-option ${option.id === question.correctOptionId ? 'correct' : option.id === selected ? 'wrong' : ''}`}><span className="review-letter">{i < 26 ? String.fromCharCode(65 + i) : i + 1}</span><span className="option-text" dir="auto">{option.text}</span>{option.id === question.correctOptionId && <span className="answer-tag"><Icon name="check" size={15} />Correct answer</span>}{option.id === selected && <span className="answer-tag">Your answer</span>}</div>)}</div>{question.explanation && <div className="review-explanation"><span><Icon name="info" size={15} />Explanation</span><p dir="auto">{question.explanation}</p></div>}</article>
    })}{missedOnly && missed === 0 && <div className="empty-small"><Icon name="check" size={28} /><h3>Nothing to revisit here.</h3><p>You answered every question correctly.</p></div>}</div>
  </>
}
