import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Html5Qrcode } from 'html5-qrcode'
import { useLanguage } from '../i18n/LanguageContext'

export default function Scan() {
  const { t } = useLanguage()
  const navigate = useNavigate()
  const containerId = 'qr-scanner-container'
  const scannerRef = useRef(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let stopped = false

    async function start() {
      try {
        const Html5QrcodeScanner = (await import('html5-qrcode')).Html5Qrcode
        const scanner = new Html5QrcodeScanner(containerId, false)
        scannerRef.current = scanner

        const cameras = await Html5QrcodeScanner.getCameras()
        if (!cameras?.length) {
          setError(t('scan.noCamera'))
          return
        }
        const cameraId = cameras[cameras.length - 1].id  // prefer back camera

        await scanner.start(
          cameraId,
          { fps: 10, qrbox: { width: 250, height: 250 } },
          (decoded) => {
            if (stopped) return
            stopped = true
            scanner.stop().then(() => scanner.clear()).catch(() => {})
            handleScanned(decoded)
          },
          () => {}
        )
      } catch (err) {
        console.error('Scanner error:', err)
        setError(err?.message || String(err))
      }
    }

    start()
    return () => {
      stopped = true
      if (scannerRef.current) {
        scannerRef.current.stop().then(() => scannerRef.current.clear()).catch(() => {})
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleScanned(text) {
    // Accept any URL that ends with /asset/<uuid> or /scan/<uuid>, or just a uuid
    const m = text.match(/(?:asset|scan)\/([0-9a-f-]{36})/i)
    if (m) return navigate(`/inventory/${m[1]}`)
    if (/^[0-9a-f-]{36}$/i.test(text)) return navigate(`/inventory/${text}`)
    setError(`${t('scan.invalidQr')}: ${text}`)
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-white mb-6">{t('scan.title')}</h2>
      <p className="text-sm text-fiba-muted mb-4">{t('scan.instructions')}</p>

      <div id={containerId} style={{ maxWidth: 500 }} className="bg-fiba-surface rounded-xl overflow-hidden" />

      {error && (
        <div className="mt-4 px-3 py-2 rounded-lg bg-red-500/20 text-red-400 text-sm">{error}</div>
      )}
    </div>
  )
}
