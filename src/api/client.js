import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
})

// Personnel
export const getPersonnel = (params) => api.get('/personnel', { params }).then(r => r.data)
export const createPersonnel = (data) => api.post('/personnel', data).then(r => r.data)
export const getPersonnelById = (id) => api.get(`/personnel/${id}`).then(r => r.data)
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
export const getDownloadUrl = (id) => `${api.defaults.baseURL}/nominations/${id}/download`

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

// Transport
export const getTransportEvents = () => api.get('/transport/events').then(r => r.data)
export const createTransportEvent = (data) => api.post('/transport/events', data).then(r => r.data)
export const getTransportEvent = (id) => api.get(`/transport/events/${id}`).then(r => r.data)
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
export const createTransportTrip = (data) => api.post('/transport/trips', data).then(r => r.data)
export const updateTransportTrip = (id, data) => api.put(`/transport/trips/${id}`, data).then(r => r.data)
export const deleteTransportTrip = (id) => api.delete(`/transport/trips/${id}`).then(r => r.data)
export const getTransportConflicts = (eventId, date) => api.get('/transport/conflicts', { params: { event_id: eventId, date } }).then(r => r.data)
export const getTransportVenues = (eventId) => api.get('/transport/venues', { params: { event_id: eventId } }).then(r => r.data)
export const createTransportVenue = (data) => api.post('/transport/venues', data).then(r => r.data)
export const deleteTransportVenue = (id) => api.delete(`/transport/venues/${id}`).then(r => r.data)
export const getTransportPassengers = (eventId) => api.get('/transport/passengers', { params: { event_id: eventId } }).then(r => r.data)
export const createTransportPassenger = (data) => api.post('/transport/passengers', data).then(r => r.data)
export const bulkCreateTransportPassengers = (passengers) => api.post('/transport/passengers/bulk', passengers).then(r => r.data)
export const deleteTransportPassenger = (id) => api.delete(`/transport/passengers/${id}`).then(r => r.data)

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
export const getTrainingPdfUrl = (type, params) => {
  const base = api.defaults.baseURL
  if (type === 'competition') return `${base}/training/export/pdf/competition/${params.competition_id}`
  if (type === 'daily') return `${base}/training/export/pdf/daily?competition_id=${params.competition_id}&date=${params.date}`
  if (type === 'team') return `${base}/training/export/pdf/team?competition_id=${params.competition_id}&team_label=${encodeURIComponent(params.team_label)}`
  return ''
}

// Availability
export const getPersonnelAvailability = (personnelId) => api.get(`/availability/personnel/${personnelId}`).then(r => r.data)
export const getCompetitionAvailability = (competitionId) => api.get(`/availability/competition/${competitionId}`).then(r => r.data)
export const createAvailability = (data) => api.post('/availability', data).then(r => r.data)
export const updateAvailability = (id, data) => api.put(`/availability/${id}`, data).then(r => r.data)
export const deleteAvailability = (id) => api.delete(`/availability/${id}`).then(r => r.data)
