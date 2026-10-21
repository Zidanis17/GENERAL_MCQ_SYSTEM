import { useState } from 'react'
import type { MixDraft, QuestionBank, SavedMix } from '../shared/model'
import { Icon, Modal } from './components'

export function Mixes({ mixes, bankCount, busy, onCreate, onEdit, onStart, onDelete }: {
  mixes: SavedMix[]; bankCount: number; busy: boolean; onCreate: () => void;
  onEdit: (mix: SavedMix) => void; onStart: (mix: SavedMix) => void; onDelete: (mix: SavedMix) => void
}) {
  return <section className="mixes-section" aria-label="Saved mixes">
    <div className="section-heading"><h2>Saved mixes<span>{mixes.length}</span></h2><button className="button secondary small" disabled={busy || bankCount < 2} onClick={onCreate}><Icon name="mix" size={16} />Create mix</button></div>
    {bankCount < 2 && <p className="field-help mix-hint">Import at least two banks to create a new mix. Existing mixes keep their own saved copies.</p>}
    {mixes.length === 0 ? <div className="mix-empty"><span className="example-icon"><Icon name="mix" size={23} /></span><div><h3>A little of this, a little of that.</h3><p>Combine banks, choose a count from each, and save your own exam.</p></div></div> : <div className="bank-grid">{mixes.map((mix) => <article className="bank-card mix-card" key={mix.id}>
      <div className="bank-card-top"><span className="bank-icon tone-1"><Icon name="mix" size={23} /></span><div className="mix-card-actions"><button className="icon-button" aria-label={`Edit ${mix.title}`} disabled={busy} onClick={() => onEdit(mix)}><Icon name="edit" size={17} /></button><button className="icon-button delete-button" aria-label={`Delete mix ${mix.title}`} disabled={busy} onClick={() => onDelete(mix)}><Icon name="trash" size={17} /></button></div></div>
      <h3 dir="auto">{mix.title}</h3><ul className="mix-sources">{mix.sources.map(({ bank, questionCount }) => <li key={bank.id}><bdi>{bank.title}</bdi><span>{questionCount}</span></li>)}</ul>
      <div className="bank-meta"><span>{mix.sources.reduce((sum, source) => sum + source.questionCount, 0)} questions</span><span>Frozen bank copies</span></div>
      <button className="button card-button" disabled={busy} onClick={() => onStart(mix)}>Start mix<Icon name="arrow" size={17} /></button>
    </article>)}</div>}
  </section>
}

export function MixEditor({ mix, banks, busy, error, onClose, onSave }: {
  mix: SavedMix | null; banks: QuestionBank[]; busy: boolean; error: string | null;
  onClose: () => void; onSave: (mix: MixDraft) => void
}) {
  const [title, setTitle] = useState(mix?.title ?? '')
  const [sources, setSources] = useState<MixDraft['sources']>(() => structuredClone(mix?.sources ?? []))
  const [frozenIds, setFrozenIds] = useState(() => new Set(mix?.sources.map(({ bank }) => bank.id)))
  const available = banks.filter((bank) => !sources.some((source) => source.bank.id === bank.id))
  const valid = title.trim().length > 0 && sources.length >= 2 && sources.every(({ bank, questionCount }) => Number.isInteger(questionCount) && questionCount > 0 && questionCount <= bank.questions.length)
  const total = sources.reduce((sum, source) => sum + source.questionCount, 0)
  function row(bank: QuestionBank, selected: boolean, questionCount = bank.questions.length) {
    return <div className={`mix-source-row ${selected ? 'selected' : ''}`} key={bank.id}>
      <label className="mix-source-choice"><input type="checkbox" checked={selected} onChange={() => {
        setSources(selected ? sources.filter((source) => source.bank.id !== bank.id) : [...sources, { bank: structuredClone(bank), questionCount: bank.questions.length }])
        if (selected) setFrozenIds((current) => { const next = new Set(current); next.delete(bank.id); return next })
      }} /><span><strong dir="auto">{bank.title}</strong><small>{bank.questions.length} available{selected && frozenIds.has(bank.id) ? ' · Saved copy' : ''}</small></span></label>
      {selected && <label className="mix-quota"><span className="sr-only">Questions from {bank.title}</span><input type="number" min="1" max={bank.questions.length} step="1" required value={Number.isNaN(questionCount) ? '' : questionCount} onChange={(e) => setSources(sources.map((source) => source.bank.id === bank.id ? { ...source, questionCount: e.target.valueAsNumber } : source))} /></label>}
    </div>
  }
  return <Modal title={mix ? 'Edit saved mix' : 'Create a mix'} wide busy={busy} onClose={onClose}>
    <p className="mix-editor-intro">Choose at least two banks and how many questions to draw from each. A fresh random sample is drawn every session.</p>
    {error && <div className="banner error" role="alert">{error}</div>}
    <form onSubmit={(e) => { e.preventDefault(); if (valid) onSave({ ...(mix ? { id: mix.id } : {}), title, sources }) }}>
      <fieldset disabled={busy}>
        <legend className="sr-only">Mix details</legend><label className="mix-name">Mix name<input type="text" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="For example, Anatomy revision" autoFocus /></label>
        <div className="mix-source-heading"><span>Question banks</span><span>Questions</span></div>
        <div className="mix-source-list">{sources.map(({ bank, questionCount }) => row(bank, true, questionCount))}{available.map((bank) => row(bank, false))}</div>
        <div className="mix-total"><span>{sources.length} banks selected</span><strong>{Number.isFinite(total) ? total : '—'} questions total</strong></div>
        <p className="field-help">Your mix keeps frozen copies of all questions in the selected banks. Replacing or deleting a library bank won't change it. To refresh a copy, remove that bank here and select it again.</p>
      </fieldset>
      <div className="modal-actions"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" className="button primary" disabled={busy || !valid}>Save mix<Icon name="check" size={17} /></button></div>
    </form>
  </Modal>
}
