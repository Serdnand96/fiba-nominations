import axios from 'axios'
import { supabase } from '../lib/supabase'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
})

// Attach Supabase JWT to every request
api.interceptors.request.use(async (config) => {
  const { data: { session } } = await supabase.auth.getSession()
  if (session?.access_token) {
    config.headers.Authorization = `Bearer ${session.access_token}`
  }
  return config
})

// Personnel
export const getPersonnel = (params) => api.get('/personnel', { params }).then(r => r.data)
export const createPersonnel = (data) => api.post('/personnel', data).then(r => r.data)
export const getPersonnelById = (id) => api.get(`/personnel/${id}`).then(r => r.data)
export const getPersonnelWorkload = (id, months = 12) => api.get(`/personnel/${id}/workload`, { params: { months } }).then(r => r.data)
export const uploadPersonnelPhoto = (id, file) => {
  const fd = new FormData()
  fd.append('photo', file)
  return api.post(`/personnel/${id}/photo`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data)
}
export const updatePersonnel = (id, data) => api.put(`/personnel/${id}`, data).then(r => r.data)
export const deletePersonnel = (id, force = false) => api.delete(`/personnel/${id}`, { params: { force } }).then(r => r.data)
export const importPersonnel = (file) => {
  const form = new FormData()
  form.append('file', file)
  return api.post('/personnel/import', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }).then(r => r.data)
}

// Competitions
export const getCompetitions = () => api.get('/competitions').then(r => r.data)
export const createCompetition = (data) => api.post('/competitions', data).then(r => r.data)
export const updateCompetition = (id, data) => api.put(`/competitions/${id}`, data).then(r => r.data)
export const deleteCompetition = (id, force = false) => api.delete(`/competitions/${id}`, { params: { force } }).then(r => r.data)

// Nominations
export const getNominations = () => api.get('/nominations').then(r => r.data)
export const createNomination = (data) => api.post('/nominations', data).then(r => r.data)
export const createBulkNominations = (data) => api.post('/nominations/bulk', data).then(r => r.data)
export const bulkGenerateNominations = (ids) => api.post('/nominations/bulk-generate', ids, { timeout: 300000 }).then(r => r.data)
export const getNominationById = (id) => api.get(`/nominations/${id}`).then(r => r.data)
export const deleteNomination = (id) => api.delete(`/nominations/${id}`).then(r => r.data)
export const bulkDeleteNominations = (ids) => api.delete('/nominations/bulk/delete', { data: ids }).then(r => r.data)
export const generateNomination = (id) => api.post(`/nominations/${id}/generate`).then(r => r.data)
export const updateNominationConfirmation = (id, status, notes = null) =>
  api.patch(`/nominations/${id}/confirmation`, { status, notes }).then(r => r.data)
export const updateNominationApproval = (id, approved) =>
  api.patch(`/nominations/${id}/approval`, { approved }).then(r => r.data)

// Authenticated file download — fetches with JWT, returns a Blob the caller
// turns into an object URL to trigger the browser save dialog. Replaces the
// previous <a href={url}> pattern, which exposed the file without auth.
export const downloadNominationBlob = async (id, filename) => {
  const params = filename ? `?filename=${encodeURIComponent(filename)}` : ''
  const resp = await api.get(`/nominations/${id}/download${params}`, {
    responseType: 'blob',
  })
  return resp.data
}

// Payments
export const getPaymentBudgets = () => api.get('/payments/budgets').then(r => r.data)
export const getPaymentNominees = (competitionId) =>
  api.get('/payments/nominees', { params: { competition_id: competitionId } }).then(r => r.data)
export const getPayments = (params) => api.get('/payments', { params }).then(r => r.data)
export const getPaymentsSummary = (competitionId, budget) =>
  api.get('/payments/summary', { params: { competition_id: competitionId, ...(budget ? { budget } : {}) } }).then(r => r.data)
export const createPayment = (data) => api.post('/payments', data).then(r => r.data)
export const updatePayment = (id, data) => api.put(`/payments/${id}`, data).then(r => r.data)
export const deletePayment = (id) => api.delete(`/payments/${id}`).then(r => r.data)
export const getPaymentAttachments = (paymentId) => api.get(`/payments/${paymentId}/attachments`).then(r => r.data)
export const uploadPaymentAttachment = (paymentId, file, kind) => {
  const fd = new FormData()
  fd.append('file', file)
  if (kind) fd.append('kind', kind)
  return api.post(`/payments/${paymentId}/attachments`, fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }).then(r => r.data)
}
export const deletePaymentAttachment = (attId) => api.delete(`/payments/attachments/${attId}`).then(r => r.data)
// Authenticated download — private bucket, returns a Blob (same pattern as
// downloadNominationBlob). Never build a public URL for these files.
export const downloadPaymentAttachment = async (attId, filename) => {
  const params = filename ? `?filename=${encodeURIComponent(filename)}` : ''
  const resp = await api.get(`/payments/attachments/${attId}/download${params}`, { responseType: 'blob' })
  return resp.data
}

// Competition reports
export const getReportTypes = () => api.get('/reports/types').then(r => r.data)
export const getReportFacets = () => api.get('/reports/facets').then(r => r.data)
export const getReports = (params) => api.get('/reports', { params }).then(r => r.data)
export const createReport = (data) => api.post('/reports', data).then(r => r.data)
export const updateReport = (id, data) => api.put(`/reports/${id}`, data).then(r => r.data)
export const deleteReport = (id) => api.delete(`/reports/${id}`).then(r => r.data)
export const getReportFiles = (reportId) => api.get(`/reports/${reportId}/files`).then(r => r.data)
export const uploadReportFile = (reportId, file) => {
  const fd = new FormData()
  fd.append('file', file)
  return api.post(`/reports/${reportId}/files`, fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }).then(r => r.data)
}
export const deleteReportFile = (fileId) => api.delete(`/reports/files/${fileId}`).then(r => r.data)
// Authenticated download — private bucket, returns a Blob.
export const downloadReportFile = async (fileId, filename) => {
  const params = filename ? `?filename=${encodeURIComponent(filename)}` : ''
  const resp = await api.get(`/reports/files/${fileId}/download${params}`, { responseType: 'blob' })
  return resp.data
}

// External staff evaluations
export const getEvaluationCriteria = () => api.get('/evaluations/criteria').then(r => r.data)
export const getEvaluationNominees = (competitionId) =>
  api.get('/evaluations/nominees', { params: { competition_id: competitionId } }).then(r => r.data)
export const getEvaluations = (params) => api.get('/evaluations', { params }).then(r => r.data)
export const getPersonnelEvaluations = (personnelId) =>
  api.get(`/evaluations/personnel/${personnelId}`).then(r => r.data)
export const createEvaluation = (data) => api.post('/evaluations', data).then(r => r.data)
export const updateEvaluation = (id, data) => api.put(`/evaluations/${id}`, data).then(r => r.data)
export const deleteEvaluation = (id) => api.delete(`/evaluations/${id}`).then(r => r.data)

// Calendar
export const getCalendarCompetitions = (params) => api.get('/calendar/competitions', { params }).then(r => r.data)
export const getCalendarCompetition = (id) => api.get(`/calendar/competitions/${id}`).then(r => r.data)
export const createCalendarEvent = (data) => api.post('/calendar/competitions', data).then(r => r.data)
export const updateCalendarEvent = (id, data) => api.put(`/calendar/competitions/${id}`, data).then(r => r.data)
export const deleteCalendarEvent = (id) => api.delete(`/calendar/competitions/${id}`).then(r => r.data)
export const assignStaff = (compId, data) => api.post(`/calendar/competitions/${compId}/assign`, data).then(r => r.data)
export const removeAssignment = (assignmentId) => api.delete(`/calendar/assignments/${assignmentId}`).then(r => r.data)

// Users
export const getUsers = () => api.get('/users').then(r => r.data)
export const createUser = (data) => api.post('/users', data).then(r => r.data)
export const deleteUser = (id) => api.delete(`/users/${id}`).then(r => r.data)
export const updateUserPassword = (id, password) => api.put(`/users/${id}/password`, { password }).then(r => r.data)

// Transport
export const getTransportEvents = () => api.get('/transport/events').then(r => r.data)
export const createTransportEvent = (data) => api.post('/transport/events', data).then(r => r.data)
export const getTransportEvent = (id) => api.get(`/transport/events/${id}`).then(r => r.data)
export const getTransportEventByCompetition = (competitionId) => api.get(`/transport/events/by-competition/${competitionId}`).then(r => r.data)
export const getTransportVehicles = (eventId) => api.get('/transport/vehicles', { params: { event_id: eventId } }).then(r => r.data)
export const createTransportVehicle = (data) => api.post('/transport/vehicles', data).then(r => r.data)
export const updateTransportVehicle = (id, data) => api.put(`/transport/vehicles/${id}`, data).then(r => r.data)
export const deleteTransportVehicle = (id) => api.delete(`/transport/vehicles/${id}`).then(r => r.data)
export const getTransportDrivers = (eventId) => api.get('/transport/drivers', { params: { event_id: eventId } }).then(r => r.data)
export const createTransportDriver = (data) => api.post('/transport/drivers', data).then(r => r.data)
export const updateTransportDriver = (id, data) => api.put(`/transport/drivers/${id}`, data).then(r => r.data)
export const deleteTransportDriver = (id) => api.delete(`/transport/drivers/${id}`).then(r => r.data)
export const getTransportVehicleDrivers = (eventId, date) => api.get('/transport/vehicle-drivers', { params: { event_id: eventId, date } }).then(r => r.data)
export const assignTransportDriver = (data) => api.post('/transport/vehicle-drivers', data).then(r => r.data)
export const getTransportTrips = (eventId, date) => api.get('/transport/trips', { params: { event_id: eventId, date } }).then(r => r.data)
export const getTransportTripDates = (eventId) => api.get('/transport/trip-dates', { params: { event_id: eventId } }).then(r => r.data)
export const createTransportTrip = (data) => api.post('/transport/trips', data).then(r => r.data)
export const updateTransportTrip = (id, data) => api.put(`/transport/trips/${id}`, data).then(r => r.data)
export const deleteTransportTrip = (id) => api.delete(`/transport/trips/${id}`).then(r => r.data)
export const getTransportConflicts = (eventId, date) => api.get('/transport/conflicts', { params: { event_id: eventId, date } }).then(r => r.data)
export const getTransportVenues = (eventId) => api.get('/transport/venues', { params: { event_id: eventId } }).then(r => r.data)
export const createTransportVenue = (data) => api.post('/transport/venues', data).then(r => r.data)
export const deleteTransportVenue = (id) => api.delete(`/transport/venues/${id}`).then(r => r.data)
// Logística — padrón, manifest, hospedaje y comidas. Transporte (arriba) es la
// otra mitad del mismo módulo y comparte el permiso 'logistics'.
export const getLogisticsParticipants = (competitionId) => api.get('/logistics/participants', { params: { competition_id: competitionId } }).then(r => r.data)
export const createLogisticsParticipant = (data) => api.post('/logistics/participants', data).then(r => r.data)
export const updateLogisticsParticipant = (id, data) => api.put(`/logistics/participants/${id}`, data).then(r => r.data)
export const deleteLogisticsParticipant = (id) => api.delete(`/logistics/participants/${id}`).then(r => r.data)
export const seedLogisticsFromCrew = (competitionId) => api.post('/logistics/participants/from-crew', null, { params: { competition_id: competitionId } }).then(r => r.data)

export const getLogisticsTravelLegs = (competitionId) => api.get('/logistics/travel-legs', { params: { competition_id: competitionId } }).then(r => r.data)
export const createLogisticsTravelLeg = (data) => api.post('/logistics/travel-legs', data).then(r => r.data)
export const updateLogisticsTravelLeg = (id, data) => api.put(`/logistics/travel-legs/${id}`, data).then(r => r.data)
export const deleteLogisticsTravelLeg = (id) => api.delete(`/logistics/travel-legs/${id}`).then(r => r.data)
export const getLogisticsMovements = (competitionId) => api.get('/logistics/movements', { params: { competition_id: competitionId } }).then(r => r.data)

export const getLogisticsHotels = (competitionId) => api.get('/logistics/hotels', { params: { competition_id: competitionId } }).then(r => r.data)
export const createLogisticsHotel = (data) => api.post('/logistics/hotels', data).then(r => r.data)
export const updateLogisticsHotel = (id, data) => api.put(`/logistics/hotels/${id}`, data).then(r => r.data)
export const deleteLogisticsHotel = (id) => api.delete(`/logistics/hotels/${id}`).then(r => r.data)

export const getLogisticsRooming = (competitionId) => api.get('/logistics/rooming', { params: { competition_id: competitionId } }).then(r => r.data)
export const createLogisticsStay = (data) => api.post('/logistics/stays', data).then(r => r.data)
export const updateLogisticsStay = (id, data) => api.put(`/logistics/stays/${id}`, data).then(r => r.data)
export const deleteLogisticsStay = (id) => api.delete(`/logistics/stays/${id}`).then(r => r.data)

export const getLogisticsMeals = (competitionId) => api.get('/logistics/meals', { params: { competition_id: competitionId } }).then(r => r.data)
export const createLogisticsMeal = (data) => api.post('/logistics/meals', data).then(r => r.data)
export const updateLogisticsMeal = (id, data) => api.put(`/logistics/meals/${id}`, data).then(r => r.data)
export const deleteLogisticsMeal = (id) => api.delete(`/logistics/meals/${id}`).then(r => r.data)

// Link público de la competencia. La lectura también pide can_edit en el
// backend: el token es un secreto, no un dato de consulta.
export const getLogisticsLink = (competitionId) => api.get(`/logistics/link/${competitionId}`).then(r => r.data)
export const rotateLogisticsLink = (competitionId) => api.post(`/logistics/link/${competitionId}/rotate`).then(r => r.data)
export const toggleLogisticsLink = (competitionId, enabled) => api.put(`/logistics/link/${competitionId}/toggle`, null, { params: { enabled } }).then(r => r.data)

// El QR sale del backend (bucket privado + JWT), así que se baja como blob y
// se muestra vía object URL — nunca como <img src="/api/...">.
export const getLogisticsLinkQr = async (competitionId) => {
  const resp = await api.get(`/logistics/link/${competitionId}/qr.png`, { responseType: 'blob' })
  return URL.createObjectURL(resp.data)
}

const uploadLogisticsSheet = (path, competitionId, file) => {
  const form = new FormData()
  form.append('file', file)
  return api.post(path, form, {
    params: { competition_id: competitionId },
    headers: { 'Content-Type': 'multipart/form-data' },
  }).then(r => r.data)
}
export const previewLogisticsManifest = (competitionId, file) => uploadLogisticsSheet('/logistics/import/manifest/preview', competitionId, file)
export const commitLogisticsManifest = (competitionId, file) => uploadLogisticsSheet('/logistics/import/manifest/commit', competitionId, file)
export const previewLogisticsRooming = (competitionId, file) => uploadLogisticsSheet('/logistics/import/rooming/preview', competitionId, file)
export const commitLogisticsRooming = (competitionId, file) => uploadLogisticsSheet('/logistics/import/rooming/commit', competitionId, file)

export const downloadLogisticsXlsx = async (kind, competitionId) => {
  const resp = await api.get(`/logistics/export/${kind}.xlsx`, {
    params: { competition_id: competitionId },
    responseType: 'blob',
  })
  const objectUrl = URL.createObjectURL(resp.data)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = kind === 'manifest' ? 'flight-manifest.xlsx' : 'rooming-list.xlsx'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
}

// Vista pública de logística (sin auth, el token es el credencial)
export const getPublicLogistics = (token) => api.get(`/public/logistics/${token}`).then(r => r.data)
export const getPublicLogisticsTransport = (token, date) => api.get(`/public/logistics/${token}/transport`, { params: date ? { date } : {} }).then(r => r.data)
export const getPublicLogisticsManifest = (token) => api.get(`/public/logistics/${token}/manifest`).then(r => r.data)
export const getPublicLogisticsRooming = (token) => api.get(`/public/logistics/${token}/rooming`).then(r => r.data)

// Permissions
export const getUserPermissions = (userId) => api.get(`/permissions/${userId}`).then(r => r.data)
export const updateUserPermissions = (userId, permissions) => api.put(`/permissions/${userId}`, { permissions }).then(r => r.data)

// Training
export const getTrainingSlots = (competitionId) => api.get('/training/slots', { params: { competition_id: competitionId } }).then(r => r.data)
export const getTrainingSlotsByTeam = (competitionId, teamLabel) => api.get('/training/slots/by-team', { params: { competition_id: competitionId, team_label: teamLabel } }).then(r => r.data)
export const getTrainingSlotsByDate = (competitionId, date) => api.get('/training/slots/by-date', { params: { competition_id: competitionId, date } }).then(r => r.data)
export const getTrainingSlotsByPersonnel = (personnelId, competitionId) => api.get('/training/slots/by-personnel', { params: { personnel_id: personnelId, competition_id: competitionId } }).then(r => r.data)
export const createTrainingSlot = (data) => api.post('/training/slots', data).then(r => r.data)
export const updateTrainingSlot = (id, data) => api.put(`/training/slots/${id}`, data).then(r => r.data)
export const deleteTrainingSlot = (id) => api.delete(`/training/slots/${id}`).then(r => r.data)
export const bulkCreateTrainingSlots = (data) => api.post('/training/slots/bulk', data).then(r => r.data)
export const createTrainingAssignment = (data) => api.post('/training/assignments', data).then(r => r.data)
export const deleteTrainingAssignment = (id) => api.delete(`/training/assignments/${id}`).then(r => r.data)
export const checkTrainingConflicts = (personnelId, slotId) => api.get('/training/conflicts', { params: { personnel_id: personnelId, slot_id: slotId } }).then(r => r.data)
export const importTrainingExcel = (file, competitionId, sport = 'Basketball') => {
  const form = new FormData()
  form.append('file', file)
  form.append('competition_id', competitionId)
  form.append('sport', sport)
  return api.post('/training/import/excel', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120000,
  }).then(r => r.data)
}
export const previewTrainingExcel = (file, competitionId, sport = 'Basketball') => {
  const form = new FormData()
  form.append('file', file)
  form.append('competition_id', competitionId)
  form.append('sport', sport)
  return api.post('/training/import/preview', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }).then(r => r.data)
}
// Training PDF export — fetches authenticated and triggers a browser download
// of the resulting blob. Replaces the previous URL-based <a href> pattern that
// served PDFs without auth (pen-test N1).
export const downloadTrainingPdf = async (type, params) => {
  let url
  if (type === 'competition') url = `/training/export/pdf/competition/${params.competition_id}`
  else if (type === 'daily') url = `/training/export/pdf/daily?competition_id=${params.competition_id}&date=${params.date}`
  else if (type === 'team') url = `/training/export/pdf/team?competition_id=${params.competition_id}&team_label=${encodeURIComponent(params.team_label)}`
  else throw new Error(`Unknown training PDF type: ${type}`)

  const resp = await api.get(url, { responseType: 'blob' })
  const filename = `training-${type}-${Date.now()}.pdf`
  const objectUrl = URL.createObjectURL(resp.data)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
}
// Game & Practice Schedule (official FIBA layout) as .xlsx — same
// authenticated blob pattern as downloadTrainingPdf. `mainVenue`/`trainingVenue`
// are optional overrides for the document header; omitted (or blank) values
// are left out of the request so the backend falls back to its own
// inference (main venue from games) / "TBC" (training venue) defaults.
export const downloadTrainingScheduleXlsx = async (competitionId, lang = 'es', { mainVenue, trainingVenue } = {}) => {
  let resp
  try {
    const params = { competition_id: competitionId, lang }
    if (mainVenue) params.main_venue = mainVenue
    if (trainingVenue) params.training_venue = trainingVenue
    resp = await api.get('/training/export/schedule-xlsx', {
      params,
      responseType: 'blob',
    })
  } catch (err) {
    // With responseType blob the JSON error body arrives as a Blob and the
    // backend detail gets lost — recover it so callers can show the reason.
    const blob = err?.response?.data
    if (blob instanceof Blob) {
      try { err.detail = JSON.parse(await blob.text())?.detail } catch { /* keep generic message */ }
    }
    throw err
  }
  const objectUrl = URL.createObjectURL(resp.data)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = `game-practice-schedule-${Date.now()}.xlsx`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
}

// Games
export const getGames = (competitionId) => api.get('/games', { params: { competition_id: competitionId } }).then(r => r.data)
export const getGamesByDate = (competitionId, date) => api.get('/games/by-date', { params: { competition_id: competitionId, date } }).then(r => r.data)
export const getGameTeams = (competitionId) => api.get('/games/teams', { params: { competition_id: competitionId } }).then(r => r.data)
export const getGameDates = (competitionId) => api.get('/games/dates', { params: { competition_id: competitionId } }).then(r => r.data)
export const getGame = (id) => api.get(`/games/${id}`).then(r => r.data)
export const createGame = (data) => api.post('/games', data).then(r => r.data)
export const bulkCreateGames = (data) => api.post('/games/bulk', data).then(r => r.data)
export const updateGame = (id, data) => api.put(`/games/${id}`, data).then(r => r.data)
export const deleteGame = (id) => api.delete(`/games/${id}`).then(r => r.data)
export const syncGameResults = (competitionId) => api.post('/games/sync-results', null, { params: { competition_id: competitionId }, timeout: 60000 }).then(r => r.data)
export const importGamesExcel = (file, competitionId) => {
  const form = new FormData()
  form.append('file', file)
  form.append('competition_id', competitionId)
  return api.post('/games/import/excel', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120000,
  }).then(r => r.data)
}

// Tournament crew: competition-level roster. On fee_type='tournament' it
// covers every game and training slot; per-game rows are only an override.
export const getCompetitionCrew = (competitionId) =>
  api.get('/games/crew/by-competition', { params: { competition_id: competitionId } }).then(r => r.data)
export const addCrewMember = (competitionId, personnelId, role = null) =>
  api.post('/games/crew', { competition_id: competitionId, personnel_id: personnelId, ...(role ? { role } : {}) }).then(r => r.data)
export const removeCrewMember = (assignmentId) =>
  api.delete(`/games/crew/${assignmentId}`).then(r => r.data)
export const getTrainingCrew = (competitionId) =>
  api.get('/training/crew', { params: { competition_id: competitionId } }).then(r => r.data)

// Staffing plan — empleados FIBA designados a la competencia. No se nominan:
// van por su propia tabla, aparte del crew (ver migración 029).
export const getStaffing = (competitionId) =>
  api.get('/staffing/by-competition', { params: { competition_id: competitionId } }).then(r => r.data)
export const getStaffingCandidates = (search = '') =>
  api.get('/staffing/candidates', { params: search ? { search } : {} }).then(r => r.data)
export const addStaffing = (payload) =>
  api.post('/staffing', payload).then(r => r.data)
export const updateStaffing = (id, payload) =>
  api.put(`/staffing/${id}`, payload).then(r => r.data)
export const removeStaffing = (id) =>
  api.delete(`/staffing/${id}`).then(r => r.data)

// Per-game TD/VGO/referee assignments (WCQ / BCLA / LSB)
export const getGameAssignments = (competitionId) =>
  api.get('/games/assignments/by-competition', { params: { competition_id: competitionId } }).then(r => r.data)
// Club country per team (referee neutrality on club competitions)
export const setTeamCountries = (competitionId, countries) =>
  api.post('/games/team-countries', { competition_id: competitionId, countries }).then(r => r.data)
export const setGameAssignment = (gameId, personnelId, role) =>
  api.post('/games/assignments', { game_id: gameId, personnel_id: personnelId, role }).then(r => r.data)
export const deleteGameAssignment = (assignmentId) =>
  api.delete(`/games/assignments/${assignmentId}`).then(r => r.data)
// overwriteTravel=true re-derives venue/location/arrival/departure per person
// and overwrites them on existing nominations (the "recalculate travel" button).
// role filters by personnel role (TD/VGO/REF/...) — only those people sync.
export const syncAssignmentsToNominations = (competitionId, overwriteTravel = false, role = null) =>
  api.post('/games/assignments/sync-nominations', null, {
    params: {
      competition_id: competitionId,
      ...(overwriteTravel ? { overwrite_travel: true } : {}),
      ...(role ? { role } : {}),
    },
  }).then(r => r.data)
// Flight-purchase check (per person per competition)
export const getCompetitionFlights = (competitionId) =>
  api.get('/games/flights/by-competition', { params: { competition_id: competitionId } }).then(r => r.data)
export const setFlightBooked = (competitionId, personnelId, flightBooked) =>
  api.post('/games/flights', { competition_id: competitionId, personnel_id: personnelId, flight_booked: flightBooked }).then(r => r.data)
export const generateAssignmentPDFs = (competitionId) =>
  api.post('/games/assignments/generate-pdfs', null, { params: { competition_id: competitionId }, timeout: 120000 }).then(r => r.data)

// Availability
export const getPersonnelAvailability = (personnelId) => api.get(`/availability/personnel/${personnelId}`).then(r => r.data)
export const getCompetitionAvailability = (competitionId, role = 'TD') => api.get(`/availability/competition/${competitionId}`, { params: { role } }).then(r => r.data)
export const createAvailability = (data) => api.post('/availability', data).then(r => r.data)
export const updateAvailability = (id, data) => api.put(`/availability/${id}`, data).then(r => r.data)
export const deleteAvailability = (id) => api.delete(`/availability/${id}`).then(r => r.data)

// Availability self-service links (admin side)
export const getAvailabilityLinks = () => api.get('/availability/links').then(r => r.data)
export const rotateAvailabilityLink = (role) => api.post(`/availability/links/${role}/rotate`).then(r => r.data)

// Availability self-service form (public, token-authenticated)
export const getPublicAvailabilityForm = (token) => api.get(`/public/availability/${token}`).then(r => r.data)
export const getPublicAvailabilityPerson = (token, personnelId) => api.get(`/public/availability/${token}/personnel/${personnelId}`).then(r => r.data)
export const submitPublicAvailability = (token, personnelId, data) => api.put(`/public/availability/${token}/personnel/${personnelId}`, data).then(r => r.data)

// Inventory: Assets
export const getAssets = (params) => api.get('/assets', { params }).then(r => r.data)
export const getAsset = (id) => api.get(`/assets/${id}`).then(r => r.data)
export const createAsset = (data) => api.post('/assets', data).then(r => r.data)
export const updateAsset = (id, data) => api.put(`/assets/${id}`, data).then(r => r.data)
export const retireAsset = (id) => api.delete(`/assets/${id}`).then(r => r.data)
export const getAssetQR = (id) => api.get(`/assets/${id}/qr`).then(r => r.data)
export const uploadAssetPhoto = (id, file) => {
  const fd = new FormData()
  fd.append('photo', file)
  return api.post(`/assets/${id}/photo`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data)
}

// Inventory: Loans
export const getLoans = (params) => api.get('/loans', { params }).then(r => r.data)
export const createLoan = (data) => api.post('/loans', data).then(r => r.data)
export const returnLoan = (id) => api.put(`/loans/${id}/return`).then(r => r.data)
export const deleteLoan = (id) => api.delete(`/loans/${id}`).then(r => r.data)

// Letter templates
export const getTemplates = () => api.get('/templates').then(r => r.data)
// Returns { blob, isPdf } — the server falls back to .docx if LibreOffice is down.
// `staged` renders the pending upload instead of the active template.
export const previewTemplate = async (key, staged = false) => {
  const resp = await api.get(`/templates/${key}/preview`, {
    params: staged ? { staged: true } : undefined,
    responseType: 'blob',
  })
  const type = resp.headers['content-type'] || ''
  return { blob: resp.data, isPdf: type.includes('pdf') }
}
export const uploadTemplate = (key, file) => {
  const fd = new FormData()
  fd.append('file', file)
  return api.post(`/templates/${key}/upload`, fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }).then(r => r.data)
}
// The .docx to open in Word. For a type with no file yet this returns the
// starter for its shape, so the user has the placeholders to design around.
export const downloadTemplateFile = async (key) => {
  const resp = await api.get(`/templates/${key}/file`, { responseType: 'blob' })
  return resp.data
}
export const createTemplateType = (data) => api.post('/templates', data).then(r => r.data)
export const deleteTemplateType = (key) => api.delete(`/templates/${key}`).then(r => r.data)
export const activateTemplate = (key) => api.post(`/templates/${key}/activate`).then(r => r.data)
export const discardStagedTemplate = (key) => api.delete(`/templates/${key}/staged`).then(r => r.data)
export const revertTemplate = (key) => api.delete(`/templates/${key}/custom`).then(r => r.data)

// Public asset (no auth)
export const getPublicAsset = (id) => api.get(`/public/asset/${id}`).then(r => r.data)

// Activity log (audit trail, superadmin only)
export const getActivityLog = (params) => api.get('/activity', { params }).then(r => r.data)

// Employees (internal staff for inventory loans)
export const getEmployees = (params) => api.get('/employees', { params }).then(r => r.data)
export const getEmployee = (id) => api.get(`/employees/${id}`).then(r => r.data)
export const createEmployee = (data) => api.post('/employees', data).then(r => r.data)
export const updateEmployee = (id, data) => api.put(`/employees/${id}`, data).then(r => r.data)
export const deleteEmployee = (id) => api.delete(`/employees/${id}`).then(r => r.data)
