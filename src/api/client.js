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

// Users
export const getUsers = () => api.get('/users').then(r => r.data)
export const createUser = (data) => api.post('/users', data).then(r => r.data)
export const deleteUser = (id) => api.delete(`/users/${id}`).then(r => r.data)
