import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  getPublicChecklists, getPublicChecklistGame, startPublicChecklist,
  updatePublicChecklistItem, submitPublicChecklist,
} from '../api/client'
import { useLanguage } from '../i18n/LanguageContext'
import { LogoMonogram } from '../components/brand/Logo'
import ChecklistRunner, { runTone } from './games/ChecklistRunner'

// El checklist de sede, tal como lo abre el oficial: link secreto, sin cuenta,
// desde el celular parado al lado de la mesa.
//
// Se renderiza fuera del shell autenticado (early-return en App.jsx). Arranca
// en la fecha de hoy si hay partidos hoy — el 95% de las veces es lo que la
// persona necesita — y solo entonces ofrece el resto del calendario.
//
// Antes de tocar un ítem hay que decir quién sos: la firma se pide una vez al
// abrir la corrida, no ítem por ítem. Ver public_checklists.py.

const card = 'rounded-xl border border-ink-200 dark:border-navy-800 bg-white dark:bg-navy-900'

function shortDate(iso, lang) {
  if (!iso) return '—'
  return new Date(iso + 'T12:00:00').toLocaleDateString(lang === 'es' ? 'es' : 'en-US',
    { weekday: 'short', day: 'numeric', month: 'short' })
}

const todayISO = () => new Date().toISOString().slice(0, 10)

export default function PublicChecklist() {
  const { token } = useParams()
  const { lang, setLang } = useLanguage()
  const t = (es, en) => (lang === 'es' ? es : en)

  const [overview, setOverview] = useState(null)
  const [loading, setLoading] = useState(true)
  const [invalid, setInvalid] = useState(false)
  const [date, setDate] = useState(null)

  const [openGame, setOpenGame] = useState(null)   // { game, checklists, roster }
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [signing, setSigning] = useState(null)     // plantilla que se está por abrir
  const [who, setWho] = useState({ personnel_id: '', signed_name: '' })

  useEffect(() => {
    let cancelled = false
    getPublicChecklists(token)
      .then(data => {
        if (cancelled) return
        setOverview(data)
        // Hoy si hay partidos hoy; si no, la primera fecha del calendario.
        const today = todayISO()
        setDate(data.dates?.includes(today) ? today : (data.dates?.[0] || null))
        setLoading(false)
      })
      .catch(() => { if (!cancelled) { setInvalid(true); setLoading(false) } })
    return () => { cancelled = true }
  }, [token])

  const games = useMemo(() => {
    if (!overview) return []
    if (!date) return overview.games
    return overview.games.filter(g => (g.date || '').slice(0, 10) === date)
  }, [overview, date])

  // La plantilla de VGO no tiene por qué ofrecer la lista de TDs. Se filtra en
  // el cliente y no en el endpoint porque el roster ya vino entero: si nadie
  // del roster tiene ese rol, mejor mostrarlos a todos que un combo vacío.
  const signingRoster = useMemo(() => {
    const roster = openGame?.roster || []
    if (!signing?.role) return roster
    const matching = roster.filter(p => p.role === signing.role)
    return matching.length > 0 ? matching : roster
  }, [openGame, signing])

  async function refreshOverview() {
    try { setOverview(await getPublicChecklists(token)) } catch { /* no-op */ }
  }

  async function openGameDetail(game) {
    setError(null)
    setBusy(true)
    try {
      setOpenGame(await getPublicChecklistGame(token, game.id))
    } catch {
      setError(t('No se pudo abrir el partido.', 'Could not open the game.'))
    } finally {
      setBusy(false)
    }
  }

  async function reloadDetail() {
    if (!openGame) return
    setOpenGame(await getPublicChecklistGame(token, openGame.game.id))
    refreshOverview()
  }

  async function guard(fn) {
    setError(null)
    try { await fn(); await reloadDetail() }
    catch (err) { setError(err.response?.data?.detail || t('No se pudo guardar.', 'Could not save.')) }
  }

  async function confirmStart() {
    const name = who.signed_name.trim()
    if (!who.personnel_id && !name) {
      setError(t('Dinos quién está haciendo el control.', 'Tell us who is running the check.'))
      return
    }
    const tpl = signing
    setSigning(null)
    await guard(() => startPublicChecklist(token, openGame.game.id, {
      template_id: tpl.id,
      personnel_id: who.personnel_id || null,
      signed_name: name || null,
    }))
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-ink-50 dark:bg-navy-950 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-basketball-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (invalid) {
    return (
      <div className="min-h-screen bg-ink-50 dark:bg-navy-950 flex items-center justify-center px-4">
        <div className="text-center">
          <div className="flex justify-center mb-4"><LogoMonogram size={48} /></div>
          <h1 className="text-lg font-semibold text-ink-900 dark:text-white mb-1">
            {t('Este link no está disponible', 'This link is not available')}
          </h1>
          <p className="text-sm text-ink-500 dark:text-ink-400">
            {t('Puede haber vencido o haber sido reemplazado. Pídele uno nuevo a la organización.',
               'It may have expired or been replaced. Ask the organisers for a new one.')}
          </p>
        </div>
      </div>
    )
  }

  const comp = overview.competition

  return (
    <div className="min-h-screen bg-ink-50 dark:bg-navy-950 text-ink-900 dark:text-white">
      <header className="border-b border-ink-200 dark:border-navy-800 bg-white dark:bg-navy-900">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="shrink-0"><LogoMonogram size={36} /></div>
            <div className="leading-tight">
              <h1 className="text-base sm:text-lg font-semibold">{comp.name}</h1>
              <p className="text-xs text-ink-500 dark:text-ink-400">
                {t('Control de sede', 'Venue check')}{comp.location ? ` · ${comp.location}` : ''}
              </p>
            </div>
          </div>
          <button onClick={() => setLang(lang === 'es' ? 'en' : 'es')}
            className="text-xs text-ink-500 dark:text-ink-400 hover:text-ink-900 dark:hover:text-white border border-ink-200 dark:border-navy-700 rounded-md px-2 py-1 shrink-0">
            {lang === 'es' ? 'EN' : 'ES'}
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-5">
        {error && (
          <div className="mb-4 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs text-red-500">{error}</div>
        )}

        {openGame ? (
          <>
            <button onClick={() => { setOpenGame(null); setSigning(null) }}
              className="text-xs text-ink-500 dark:text-ink-400 hover:underline mb-3">
              ← {t('Volver a los partidos', 'Back to games')}
            </button>

            <div className={`${card} p-4 mb-4`}>
              <div className="text-base font-semibold">
                {[openGame.game.team_a_code || openGame.game.team_a,
                  openGame.game.team_b_code || openGame.game.team_b].filter(Boolean).join('  vs  ')}
              </div>
              <div className="text-xs text-ink-500 dark:text-ink-400">
                {[shortDate(openGame.game.date, lang), openGame.game.time?.slice(0, 5),
                  openGame.game.venue, openGame.game.city].filter(Boolean).join(' · ')}
              </div>
            </div>

            {signing ? (
              <div className={`${card} p-4 mb-4`}>
                <h2 className="text-sm font-semibold mb-1">{signing.name}</h2>
                <p className="text-xs text-ink-500 dark:text-ink-400 mb-3">
                  {t('¿Quién hace el control? Queda firmado en el registro del partido.',
                     'Who is running the check? It is signed onto the game record.')}
                </p>
                {signingRoster.length > 0 && (
                  <select className="fiba-input mb-2" value={who.personnel_id}
                    onChange={e => setWho({ personnel_id: e.target.value, signed_name: '' })}>
                    <option value="">{t('Elige tu nombre...', 'Pick your name...')}</option>
                    {signingRoster.map(p => (
                      <option key={p.id} value={p.id}>{p.name}{p.role ? ` — ${p.role}` : ''}</option>
                    ))}
                  </select>
                )}
                {!who.personnel_id && (
                  <input className="fiba-input mb-2" value={who.signed_name}
                    onChange={e => setWho({ personnel_id: '', signed_name: e.target.value })}
                    placeholder={t('...o escribe tu nombre', '...or type your name')} />
                )}
                <div className="flex justify-end gap-2">
                  <button onClick={() => setSigning(null)} className="btn-fiba-ghost text-xs">{t('Cancelar', 'Cancel')}</button>
                  <button onClick={confirmStart} className="btn-fiba text-xs">{t('Empezar', 'Start')}</button>
                </div>
              </div>
            ) : null}

            <ChecklistRunner
              t={t}
              runs={openGame.checklists}
              templates={overview.templates}
              canEdit
              startLabel={t('Empezar un control:', 'Start a check:')}
              onStart={tpl => { setWho({ personnel_id: '', signed_name: '' }); setSigning(tpl) }}
              onSetItem={(item, patch) => guard(() => updatePublicChecklistItem(token, item.id, patch))}
              onSubmit={run => guard(() => submitPublicChecklist(token, run.id))}
            />
          </>
        ) : (
          <>
            {overview.dates?.length > 1 && (
              <div className="flex gap-1.5 overflow-x-auto pb-3 -mx-1 px-1">
                {overview.dates.map(d => (
                  <button key={d} onClick={() => setDate(d)}
                    className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      date === d
                        ? 'border-basketball-500 bg-basketball-500/10 text-basketball-500'
                        : 'border-ink-200 dark:border-navy-800 text-ink-500 dark:text-ink-400'
                    }`}>
                    {shortDate(d, lang)}
                  </button>
                ))}
              </div>
            )}

            {games.length === 0 ? (
              <p className="text-sm text-ink-500 dark:text-ink-400 py-8 text-center">
                {t('No hay partidos en esta fecha.', 'No games on this date.')}
              </p>
            ) : (
              <div className="space-y-2">
                {games.map(g => (
                  <button key={g.id} onClick={() => openGameDetail(g)} disabled={busy}
                    className={`${card} w-full text-left p-3 flex items-center gap-3 active:scale-[0.99] transition-transform`}>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold truncate">
                        {[g.team_a_code || g.team_a, g.team_b_code || g.team_b].filter(Boolean).join('  vs  ')}
                      </div>
                      <div className="text-[11px] text-ink-500 dark:text-ink-400 truncate">
                        {[g.time?.slice(0, 5), g.venue, g.city].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                    <ChecklistBadges t={t} checklists={g.checklists} />
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}


function ChecklistBadges({ t, checklists }) {
  if (!checklists?.length) {
    return (
      <span className="shrink-0 text-[10px] uppercase tracking-wider text-ink-400 dark:text-ink-500">
        {t('sin control', 'no check')}
      </span>
    )
  }
  return (
    <div className="shrink-0 flex flex-wrap gap-1 justify-end max-w-[45%]">
      {checklists.map(c => {
        const tone = runTone(c)
        const cls = tone === 'fail'
          ? 'border-red-500/50 text-red-500'
          : tone === 'done'
            ? 'border-emerald-500/50 text-emerald-500'
            : 'border-ink-300 dark:border-navy-700 text-ink-500 dark:text-ink-400'
        return (
          <span key={c.id} className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold ${cls}`}>
            {c.done}/{c.total}
          </span>
        )
      })}
    </div>
  )
}
