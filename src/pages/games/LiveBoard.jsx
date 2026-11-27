import { useEffect, useState } from 'react'
import { getLiveGames } from '../../api/client'
import { useLanguage } from '../../i18n/LanguageContext'
import { warRoomTime, formatWarRoom } from '../../lib/warRoom'

// Pestaña "En vivo" de Partidos: lo que se juega hoy en todas las competencias.
//
// El servidor arma los tres grupos (en juego, por jugar, finalizados) y le pide
// a FIBA el marcador, el cuarto y el reloj de lo que está en juego; acá solo se
// dibuja y se vuelve a pedir cada 30 segundos. Con la pestaña del navegador
// oculta no se pide nada: cada pedido puede costar una llamada a FIBA.
//
// "Hoy" es el día de Miami, igual que la hora MIA de cada tarjeta.

const REFRESH_MS = 30000

const SECTIONS = [
  { bucket: 'live', label: 'games.liveNow' },
  { bucket: 'upcoming', label: 'games.liveUpcoming' },
  { bucket: 'finished', label: 'games.liveFinished' },
]

export default function LiveBoard({ onOpen, phaseLabel }) {
  const { t, lang } = useLanguage()
  const [board, setBoard] = useState(null)
  const [failed, setFailed] = useState(false)
  const [loadedAt, setLoadedAt] = useState(null)

  useEffect(() => {
    let alive = true
    const load = () => {
      if (document.hidden) return
      getLiveGames()
        .then(data => { if (alive) { setBoard(data); setFailed(false); setLoadedAt(new Date()) } })
        .catch(() => { if (alive) setFailed(true) })
    }
    load()
    const id = setInterval(load, REFRESH_MS)
    const onVisible = () => { if (!document.hidden) load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  const locale = lang === 'en' ? 'en-US' : 'es'
  const dayLabel = iso => new Date(`${iso}T12:00:00`).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })

  if (!board) {
    return (
      <div className="py-12 text-center text-sm text-fiba-muted">
        {failed ? t('games.liveLoadError') : t('common.loading')}
      </div>
    )
  }

  const games = board.games || []
  const next = board.next_game

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-4 text-xs text-fiba-muted">
        <span>{t('games.liveDayHint', { day: dayLabel(board.day) })}</span>
        {loadedAt && (
          <span className="tabular-nums">
            {t('games.liveUpdated', { time: loadedAt.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' }) })}
          </span>
        )}
        {board.fiba_checked && !board.fiba_error && <span>{t('games.liveFromFiba')}</span>}
      </div>

      {(board.fiba_error || failed) && (
        <div role="status" className="rounded-lg bg-amber-100 dark:bg-amber-500/10 px-3 py-2 mb-4 text-xs text-amber-800 dark:text-amber-400">
          {failed ? t('games.liveLoadError') : t('games.liveFibaDown')}
        </div>
      )}

      {games.length === 0 && (
        <div className="py-10 text-center text-sm text-fiba-muted">{t('games.liveEmpty')}</div>
      )}

      {SECTIONS.map(({ bucket, label }) => {
        const list = games.filter(g => g.bucket === bucket)
        if (list.length === 0) return null
        return (
          <section key={bucket} className="mb-8">
            <h3 className="text-sm font-bold text-fiba-muted uppercase tracking-wider mb-3 px-1">
              {t(label)} <span className="tabular-nums font-medium">({list.length})</span>
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {list.map(g => (
                <LiveCard key={g.id} game={g} t={t} lang={lang} phaseLabel={phaseLabel} onOpen={onOpen} />
              ))}
            </div>
          </section>
        )
      })}

      {next && (
        <div className="rounded-lg border border-fiba-border bg-fiba-card px-4 py-3 text-sm">
          <span className="text-fiba-muted">{t('games.liveNext')}: </span>
          <button type="button" onClick={() => onOpen(next.competition_id)}
            className="font-medium text-ink-900 dark:text-white hover:text-fiba-accent text-left">
            {dayLabel(next.date)}
            {next.time && next.time !== '00:00' ? `, ${next.time}` : ''}
            {' · '}{next.team_a_code || next.team_a} vs {next.team_b_code || next.team_b}
            {next.competition_name ? ` · ${next.competition_name}` : ''}
          </button>
        </div>
      )}
    </div>
  )
}

function LiveCard({ game, t, lang, phaseLabel, onOpen }) {
  const isLive = game.bucket === 'live'
  const isFinished = game.bucket === 'finished'
  // '00:00' es el relleno de FIBA cuando todavía no fijó el horario.
  const localTime = game.time && game.time !== '00:00' ? game.time : null
  const warRoom = formatWarRoom(warRoomTime(game.datetime_utc, game.date))
  const round = game.group_label
    ? `${t('games.group')} ${game.group_label}`
    : (game.phase ? phaseLabel(game.phase, lang) : '')
  const showScore = isLive || isFinished
  const aWon = isFinished && game.score_a > game.score_b
  const bWon = isFinished && game.score_b > game.score_a
  const teamClass = won => `text-base font-bold truncate ${won || isLive ? 'text-ink-900 dark:text-white' : 'text-ink-700 dark:text-gray-300'}`

  return (
    <button type="button" onClick={() => onOpen(game.competition_id)} title={t('games.liveOpen')}
      className={`w-full text-left bg-fiba-card rounded-lg border p-3 hover:shadow-sm transition-shadow ${
        isLive ? 'border-red-500/50 ring-1 ring-red-500/20' : 'border-fiba-border dark:border-navy-600'
      }`}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="min-w-0 truncate text-[11px] font-semibold text-fiba-muted">
          {game.competition_name}{round ? ` · ${round}` : ''}
        </span>
        {isLive && (
          <span className="flex-shrink-0 flex items-center gap-1.5 text-[10px] font-bold text-red-500 uppercase tracking-wider">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" aria-hidden="true" />
            {t('games.live')}
            {(game.period || game.clock) && (
              <span className="tabular-nums normal-case tracking-normal">
                {[game.period, game.clock].filter(Boolean).join(' ')}
              </span>
            )}
          </span>
        )}
        {isFinished && (
          <span className="flex-shrink-0 text-[10px] font-semibold text-emerald-600/80 dark:text-emerald-400/80 uppercase tracking-wider">
            {t('games.liveFinal')}
          </span>
        )}
      </div>

      <div className="flex items-center justify-between gap-3" title={`${game.team_a} vs ${game.team_b}`}>
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex items-center justify-between gap-2">
            <span className={teamClass(aWon)}>{game.team_a_code || game.team_a}</span>
            {showScore && <span className={`tabular-nums ${teamClass(aWon)}`}>{game.score_a ?? '-'}</span>}
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className={teamClass(bWon)}>{game.team_b_code || game.team_b}</span>
            {showScore && <span className={`tabular-nums ${teamClass(bWon)}`}>{game.score_b ?? '-'}</span>}
          </div>
        </div>
        {!showScore && (
          <span className="flex-shrink-0 text-right" title={localTime ? t('games.venueTimeHint') : undefined}>
            {localTime && (
              <span className="block text-[10px] font-medium leading-none text-fiba-muted">{t('games.venue')}</span>
            )}
            <span className="text-lg font-bold tabular-nums text-ink-900 dark:text-white">{localTime || '--:--'}</span>
          </span>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-2 text-[11px] text-fiba-muted tabular-nums">
        {showScore && localTime && <span title={t('games.venueTimeHint')}>{t('games.venue')} {localTime}</span>}
        {warRoom && <span>{warRoom}</span>}
        {game.city && <span className="truncate">{[game.city, game.country].filter(Boolean).join(', ')}</span>}
      </div>
    </button>
  )
}
