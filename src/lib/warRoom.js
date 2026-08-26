// La hora del war room.
//
// El seguimiento de la competencia se hace desde Miami: quien mira el
// calendario necesita saber a qué hora tiene que estar mirando ESE partido,
// además de a qué hora arranca en la sede. Las dos horas son útiles y ninguna
// reemplaza a la otra — la local es la del TD y el VGO que están en el
// gimnasio, la de Miami es la de la mesa que sigue seis partidos a la vez.
//
// Se calcula del instante UTC que manda FIBA (game_schedule.datetime_utc), no
// de sumarle un offset a la hora local: en esta competencia conviven zonas que
// cambian de horario de verano en fechas distintas, y algunas no cambian. El
// navegador ya sabe resolver eso; una tabla de offsets a mano se vuelve mentira
// dos veces al año.

// Zona del war room. Miami es America/New_York (Eastern). Si el seguimiento se
// mudara, se cambia acá y nada más.
export const WAR_ROOM_TZ = 'America/New_York'
export const WAR_ROOM_LABEL = 'MIA'

const hhmm = new Intl.DateTimeFormat('en-GB', {
  timeZone: WAR_ROOM_TZ, hour: '2-digit', minute: '2-digit', hour12: false,
})
// en-CA da 'YYYY-MM-DD', que es el mismo formato que game_schedule.date y se
// puede comparar como string.
const isoDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: WAR_ROOM_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
})

/**
 * @param {string|null} datetimeUtc  instante ISO del partido (columna datetime_utc)
 * @param {string|null} localDate    fecha local de la sede ('YYYY-MM-DD'), para detectar
 *                                   si en Miami el partido cae otro día
 * @returns {{time: string, dayShift: number}|null}
 */
export function warRoomTime(datetimeUtc, localDate) {
  if (!datetimeUtc) return null
  const d = new Date(datetimeUtc)
  if (Number.isNaN(d.getTime())) return null

  const time = hhmm.format(d)
  let dayShift = 0
  if (localDate) {
    // Diferencia en días naturales. Se compara a mediodía UTC para que el
    // cálculo no dependa de la hora ni del huso del navegador.
    const inMiami = new Date(`${isoDate.format(d)}T12:00:00Z`)
    const atVenue = new Date(`${localDate.slice(0, 10)}T12:00:00Z`)
    if (!Number.isNaN(inMiami.getTime()) && !Number.isNaN(atVenue.getTime())) {
      dayShift = Math.round((inMiami - atVenue) / 86400000)
    }
  }
  return { time, dayShift }
}

/** "MIA 22:10" o "MIA 00:40 +1" cuando en Miami el partido cae otro día. */
export function formatWarRoom(wr) {
  if (!wr) return null
  const shift = wr.dayShift ? ` ${wr.dayShift > 0 ? '+' : ''}${wr.dayShift}` : ''
  return `${WAR_ROOM_LABEL} ${wr.time}${shift}`
}
