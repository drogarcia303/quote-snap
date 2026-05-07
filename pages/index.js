import { useState, useRef, useEffect, useCallback } from 'react'
import Head from 'next/head'

const MAX_DIM = 1200
const LABOR_RATE = 95
const TRIP_CHARGE = 75
const STORAGE_KEY = 'quote_snap_history'

const SERVICE_TYPES = [
  'Panel Upgrade',
  'Circuit Addition',
  'Outlet Replacement',
  'Light Fixture Install',
  'GFCI Upgrade',
  'Smoke/CO Detector',
  'Troubleshooting',
  'Rewiring',
  'Generator Install',
  'EV Charger Install',
  'Other',
]

function resizeImage(file, maxDim = MAX_DIM) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = reject
    reader.onload = (e) => {
      const img = new Image()
      img.onerror = reject
      img.onload = () => {
        const { width, height } = img
        const scale = Math.min(1, maxDim / Math.max(width, height))
        const w = Math.round(width * scale)
        const h = Math.round(height * scale)
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, w, h)
        canvas.toBlob(
          (blob) => {
            if (!blob) { reject(new Error('Canvas resize failed')); return }
            resolve({ blob, dataUrl: e.target.result, width: w, height: h })
          },
          'image/jpeg',
          0.85
        )
      }
      img.src = e.target.result
    }
    reader.readAsDataURL(file)
  })
}

async function convertHeic(file) {
  const heic2any = (await import('heic2any')).default
  const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.85 })
  return Array.isArray(converted) ? converted[0] : converted
}

export default function QuoteSnap() {
  // Steps: upload | details | analyzing | quote | history
  const [step, setStep] = useState('upload')
  const [imageData, setImageData] = useState(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState(null)

  // Job details
  const [customerName, setCustomerName] = useState('')
  const [customerAddress, setCustomerAddress] = useState('')
  const [serviceType, setServiceType] = useState('')
  const [notes, setNotes] = useState('')

  // AI Quote result
  const [quoteResult, setQuoteResult] = useState(null)

  // Quote history
  const [quoteHistory, setQuoteHistory] = useState([])

  // Viewing a saved quote (restores state from history entry)
  const [viewingHistoryId, setViewingHistoryId] = useState(null)

  // UI state
  const [activeTab, setActiveTab] = useState('preview') // preview | quote
  const [pinchScale, setPinchScale] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [touchStart, setTouchStart] = useState(null)

  const fileInputRef = useRef(null)

  // ─── Load history from localStorage ───────────────────────────────────────
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) setQuoteHistory(JSON.parse(saved))
    } catch {}
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(quoteHistory))
    } catch {}
  }, [quoteHistory])

  // ─── Image Upload ───────────────────────────────────────────────────────────
  const processFile = useCallback(async (file) => {
    if (!file || !file.type.startsWith('image/')) {
      setError('Please select an image file.')
      return
    }
    setIsProcessing(true)
    setError(null)
    try {
      let blob = file
      const isHeic = file.type === 'image/heic' ||
        file.name.toLowerCase().endsWith('.heic') ||
        (file.type === 'image/jpeg' && file.name.toLowerCase().endsWith('.heic'))
      if (isHeic || file.type === 'image/heic') {
        try { blob = await convertHeic(file) } catch {}
      }
      const { dataUrl, width, height } = await resizeImage(blob)
      const filename = file.name.replace(/\.[^.]+$/, '') || 'photo'
      setImageData({ dataUrl, width, height, filename })
      setStep('details')
    } catch {
      setError('Failed to process image. Try another one.')
    } finally {
      setIsProcessing(false)
    }
  }, [])

  const handleFileInput = (e) => {
    const file = e.target.files?.[0]
    if (file) processFile(file)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (file) processFile(file)
  }

  // ─── Pinch-to-Zoom ──────────────────────────────────────────────────────────
  const getTouchDist = (touches) => {
    const dx = touches[0].clientX - touches[1].clientX
    const dx2 = touches[0].clientY - touches[1].clientY
    return Math.sqrt(dx * dx + dx2 * dx2)
  }

  const handleTouchStart = (e) => {
    if (e.touches.length === 2) {
      e.preventDefault()
      setTouchStart(getTouchDist(e.touches))
    } else if (e.touches.length === 1 && pinchScale > 1) {
      setTouchStart({ x: e.touches[0].clientX - pan.x, y: e.touches[0].clientY - pan.y })
    }
  }

  const handleTouchMove = (e) => {
    if (e.touches.length === 2) {
      e.preventDefault()
      const dist = getTouchDist(e.touches)
      if (touchStart) {
        setPinchScale(Math.min(4, Math.max(1, pinchScale * (dist / touchStart))))
      }
    } else if (e.touches.length === 1 && pinchScale > 1) {
      setPan({
        x: e.touches[0].clientX - (touchStart?.x || 0),
        y: e.touches[0].clientY - (touchStart?.y || 0),
      })
    }
  }

  const handleTouchEnd = () => setTouchStart(null)
  const resetZoom = () => { setPinchScale(1); setPan({ x: 0, y: 0 }) }

  // ─── Generate Quote ─────────────────────────────────────────────────────────
  const generateQuote = async () => {
    if (!imageData || !serviceType) return
    setStep('analyzing')
    setError(null)

    try {
      const response = await fetch('/api/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageData: imageData.dataUrl,
          serviceType,
          customerName,
          customerAddress,
          notes,
          laborRate: LABOR_RATE,
          tripCharge: TRIP_CHARGE,
        }),
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Server error' }))
        throw new Error(err.error || 'Quote generation failed')
      }

      const data = await response.json()
      setQuoteResult(data)

      // Save to history
      const entry = {
        id: Date.now().toString(),
        createdAt: new Date().toISOString(),
        customerName,
        customerAddress,
        serviceType,
        notes,
        imageData: imageData.dataUrl,
        imageWidth: imageData.width,
        imageHeight: imageData.height,
        imageFilename: imageData.filename,
        quoteResult: data,
      }
      setQuoteHistory((prev) => [entry, ...prev])

      setStep('quote')
    } catch (err) {
      setError(err.message)
      setStep('details')
    }
  }

  // ─── Copy Quote Text ───────────────────────────────────────────────────────
  const copyQuoteText = () => {
    if (!quoteResult) return
    const lines = [
      `QUOTE — ${customerName || 'Customer'}`,
      `Address: ${customerAddress || 'N/A'}`,
      `Date: ${new Date().toLocaleDateString()}`,
      `Service: ${serviceType}`,
      '',
      ...quoteResult.lineItems.map(
        (item) => `  ${item.qty}x ${item.description} ........ $${item.total.toFixed(2)}`
      ),
      '',
      `Trip Charge: $${TRIP_CHARGE.toFixed(2)}`,
      `Labor (${quoteResult.totalHours}h @ $${LABOR_RATE}/hr): $${(quoteResult.totalHours * LABOR_RATE).toFixed(2)}`,
      '',
      `TOTAL: $${quoteResult.total.toFixed(2)}`,
      '',
      quoteResult.warranties ? `Warranties: ${quoteResult.warranties}` : '',
    ].filter(Boolean)
    navigator.clipboard.writeText(lines.join('\n'))
  }

  // ─── View a saved quote ────────────────────────────────────────────────────
  const openHistoryQuote = (entry) => {
    setImageData({
      dataUrl: entry.imageData,
      width: entry.imageWidth,
      height: entry.imageHeight,
      filename: entry.imageFilename,
    })
    setCustomerName(entry.customerName)
    setCustomerAddress(entry.customerAddress)
    setServiceType(entry.serviceType)
    setNotes(entry.notes)
    setQuoteResult(entry.quoteResult)
    setViewingHistoryId(entry.id)
    setActiveTab('quote')
    setStep('quote')
  }

  const deleteHistoryQuote = (id, e) => {
    e.stopPropagation()
    setQuoteHistory((prev) => prev.filter((q) => q.id !== id))
    if (viewingHistoryId === id) {
      startOver()
    }
  }

  // ─── Reset ─────────────────────────────────────────────────────────────────
  const startOver = () => {
    setStep(quoteHistory.length > 0 ? 'history' : 'upload')
    setImageData(null)
    setQuoteResult(null)
    setError(null)
    setCustomerName('')
    setCustomerAddress('')
    setServiceType('')
    setNotes('')
    setActiveTab('preview')
    setPinchScale(1)
    setPan({ x: 0, y: 0 })
    setViewingHistoryId(null)
  }

  const goToUpload = () => {
    setStep('upload')
    setImageData(null)
    setQuoteResult(null)
    setError(null)
    setCustomerName('')
    setCustomerAddress('')
    setServiceType('')
    setNotes('')
    setActiveTab('preview')
    setPinchScale(1)
    setPan({ x: 0, y: 0 })
    setViewingHistoryId(null)
  }

  // ─── Styles ─────────────────────────────────────────────────────────────────
  const s = {
    app: {
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      minHeight: '100dvh',
      background: '#0a0a0f',
      color: '#f0f0f5',
      display: 'flex',
      flexDirection: 'column',
    },
    header: {
      padding: '16px 20px',
      borderBottom: '1px solid #1e1e2e',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      flexShrink: 0,
    },
    logo: { fontSize: '18px', fontWeight: '800', color: '#f59e0b', letterSpacing: '-0.5px' },
    logoSub: { fontSize: '10px', color: '#6b7280', fontWeight: '400', display: 'block', marginTop: '1px' },
    main: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },

    // Upload
    uploadWrap: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 24px', gap: '24px' },
    uploadIcon: { width: '80px', height: '80px', borderRadius: '20px', background: 'linear-gradient(135deg, #f59e0b22, #f59e0b44)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '36px' },
    uploadTitle: { fontSize: '22px', fontWeight: '700', textAlign: 'center' },
    uploadSub: { fontSize: '14px', color: '#9ca3af', textAlign: 'center', lineHeight: '1.6' },
    dropZone: { border: '2px dashed #2a2a3e', borderRadius: '20px', padding: '40px', width: '100%', maxWidth: '400px', textAlign: 'center', cursor: 'pointer', transition: 'border-color 0.2s', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' },
    uploadInput: { display: 'none' },

    // Details
    detailsWrap: { flex: 1, overflow: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' },
    fieldLabel: { fontSize: '12px', fontWeight: '600', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' },
    input: { width: '100%', background: '#13131f', border: '1px solid #2a2a3e', borderRadius: '12px', padding: '14px 16px', color: '#f0f0f5', fontSize: '16px', outline: 'none', boxSizing: 'border-box', transition: 'border-color 0.2s' },
    select: { width: '100%', background: '#13131f', border: '1px solid #2a2a3e', borderRadius: '12px', padding: '14px 16px', color: '#f0f0f5', fontSize: '16px', outline: 'none', boxSizing: 'border-box', appearance: 'none' },
    textarea: { width: '100%', background: '#13131f', border: '1px solid #2a2a3e', borderRadius: '12px', padding: '14px 16px', color: '#f0f0f5', fontSize: '16px', outline: 'none', resize: 'none', boxSizing: 'border-box', minHeight: '80px', fontFamily: 'inherit' },
    actionBtn: { background: 'linear-gradient(135deg, #f59e0b, #d97706)', color: '#000', fontWeight: '700', fontSize: '16px', padding: '16px', borderRadius: '14px', border: 'none', cursor: 'pointer', width: '100%', marginTop: '8px' },
    backBtn: { background: '#1e1e2e', color: '#9ca3af', fontWeight: '600', fontSize: '14px', padding: '12px', borderRadius: '12px', border: 'none', cursor: 'pointer', width: '100%' },

    // Analyzing
    analyzingWrap: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '20px', padding: '40px' },
    spinner: { width: '60px', height: '60px', border: '4px solid #2a2a3e', borderTopColor: '#f59e0b', borderRadius: '50%', animation: 'spin 0.8s linear infinite' },
    analyzingTitle: { fontSize: '20px', fontWeight: '700' },
    analyzingSub: { fontSize: '14px', color: '#9ca3af', textAlign: 'center', lineHeight: '1.6' },

    // Quote
    quoteWrap: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
    quoteTabs: { display: 'flex', borderBottom: '1px solid #1e1e2e', flexShrink: 0 },
    quoteTab: (active) => ({ flex: 1, padding: '14px', textAlign: 'center', fontSize: '14px', fontWeight: '600', cursor: 'pointer', borderBottom: active ? '2px solid #f59e0b' : '2px solid transparent', color: active ? '#f59e0b' : '#6b7280', transition: 'color 0.2s', userSelect: 'none' }),
    quoteContent: { flex: 1, overflow: 'auto', padding: '20px' },
    quoteCard: { background: '#13131f', borderRadius: '16px', border: '1px solid #2a2a3e', overflow: 'hidden' },
    quoteCardHeader: { background: 'linear-gradient(135deg, #f59e0b22, #f59e0b11)', padding: '16px 20px', borderBottom: '1px solid #2a2a3e' },
    quoteCardTitle: { fontSize: '12px', color: '#f59e0b', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.08em' },
    quoteCardMeta: { fontSize: '13px', color: '#9ca3af', marginTop: '4px' },
    lineItem: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '14px 20px', borderBottom: '1px solid #1e1e2e', gap: '12px' },
    lineItemDesc: { flex: 1 },
    lineItemName: { fontSize: '15px', fontWeight: '600', marginBottom: '2px' },
    lineItemDetail: { fontSize: '12px', color: '#6b7280' },
    lineItemPrice: { fontSize: '15px', fontWeight: '700', color: '#f59e0b', whiteSpace: 'nowrap' },
    subtotalRow: { display: 'flex', justifyContent: 'space-between', padding: '14px 20px', fontSize: '14px', color: '#9ca3af', borderBottom: '1px solid #1e1e2e' },
    totalRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', background: 'linear-gradient(135deg, #f59e0b22, #f59e0b11)', borderTop: '1px solid #2a2a3e' },
    totalLabel: { fontSize: '16px', fontWeight: '700' },
    totalAmount: { fontSize: '24px', fontWeight: '800', color: '#f59e0b' },
    warrantyNote: { fontSize: '12px', color: '#6b7280', padding: '12px 20px', borderTop: '1px solid #1e1e2e', lineHeight: '1.5' },
    quoteActions: { padding: '16px 20px', display: 'flex', gap: '12px', flexShrink: 0 },
    quoteActionBtn: (primary) => ({ flex: 1, padding: '14px', borderRadius: '12px', fontWeight: '700', fontSize: '15px', cursor: 'pointer', border: primary ? 'none' : '1px solid #2a2a3e', background: primary ? 'linear-gradient(135deg, #f59e0b, #d97706)' : '#13131f', color: primary ? '#000' : '#f0f0f5', transition: 'opacity 0.2s' }),
    jobInfoBar: { background: '#13131f', borderBottom: '1px solid #1e1e2e', padding: '12px 20px', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px', color: '#9ca3af', flexShrink: 0 },
    jobInfoTag: { background: '#f59e0b22', color: '#f59e0b', padding: '3px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: '700', textTransform: 'uppercase' },
    imageThumb: { width: '48px', height: '48px', borderRadius: '10px', objectFit: 'cover', border: '1px solid #2a2a3e', flexShrink: 0 },
    error: { background: '#ff3b3022', border: '1px solid #ff3b3055', borderRadius: '12px', padding: '12px 16px', fontSize: '14px', color: '#ff6b5b' },

    // History
    historyWrap: { flex: 1, overflow: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' },
    historyTitle: { fontSize: '16px', fontWeight: '700', color: '#9ca3af', marginBottom: '4px' },
    historyEmpty: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px', padding: '40px', textAlign: 'center' },
    historyCard: { background: '#13131f', borderRadius: '14px', border: '1px solid #2a2a3e', overflow: 'hidden', cursor: 'pointer', transition: 'border-color 0.2s' },
    historyCardInner: { display: 'flex', gap: '12px', padding: '14px' },
    historyCardImg: { width: '56px', height: '56px', borderRadius: '10px', objectFit: 'cover', flexShrink: 0, border: '1px solid #2a2a3e' },
    historyCardBody: { flex: 1, minWidth: 0 },
    historyCardName: { fontSize: '15px', fontWeight: '600', marginBottom: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
    historyCardMeta: { fontSize: '12px', color: '#6b7280', marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
    historyCardAmount: { fontSize: '16px', fontWeight: '800', color: '#f59e0b' },
    historyCardFooter: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderTop: '1px solid #1e1e2e' },
    historyCardDate: { fontSize: '12px', color: '#4b5563' },
    historyCardDel: { background: 'none', border: 'none', color: '#ef4444', fontSize: '13px', cursor: 'pointer', padding: '4px 8px', borderRadius: '6px' },
    historyHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 20px 12px' },
    historyHeaderTitle: { fontSize: '18px', fontWeight: '800' },
    historyCount: { fontSize: '12px', color: '#6b7280', fontWeight: '400' },
  }

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={s.app}>
      <Head>
        <title>Quote Snap — Mallard Electric</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
        <style>{`
          @keyframes spin { to { transform: rotate(360deg); } }
          * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
          body { margin: 0; background: #0a0a0f; }
          input, select, textarea { font-size: 16px !important; }
          input:focus, select:focus, textarea:focus { border-color: #f59e0b !important; }
          select option { background: #13131f; }
          .drop-zone:hover { border-color: #f59e0b66 !important; }
          .action-btn:hover { opacity: 0.9; }
          .quote-action-btn:hover { opacity: 0.85; }
          .back-btn:hover { background: #252535 !important; }
          .history-card:hover { border-color: #f59e0b66 !important; }
          .del-btn:hover { background: #ff3b3011 !important; }
        `}</style>
      </Head>

      {/* Header */}
      <header style={s.header}>
        <div>
          <span style={s.logo}>⚡ Quote Snap</span>
          <span style={s.logoSub}>Mallard Electric LLC</span>
        </div>
        {step !== 'upload' && (
          <div style={{ display: 'flex', gap: '8px' }}>
            {step !== 'history' && (
              <button
                onClick={() => setStep('history')}
                style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: '13px', cursor: 'pointer', padding: '4px 8px' }}
              >
                📋 History
              </button>
            )}
            <button
              onClick={goToUpload}
              style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: '14px', cursor: 'pointer', padding: '4px 8px' }}
            >
              ✕
            </button>
          </div>
        )}
        {step === 'upload' && quoteHistory.length > 0 && (
          <button
            onClick={() => setStep('history')}
            style={{ background: '#1e1e2e', border: 'none', color: '#9ca3af', fontSize: '13px', fontWeight: '600', cursor: 'pointer', padding: '8px 14px', borderRadius: '10px' }}
          >
            📋 {quoteHistory.length}
          </button>
        )}
      </header>

      <main style={s.main}>

        {/* ── UPLOAD ──────────────────────────────────────────────────────── */}
        {step === 'upload' && (
          <div style={s.uploadWrap} onDrop={handleDrop} onDragOver={(e) => e.preventDefault()}>
            <div style={s.uploadIcon}>📷</div>
            <div style={{ maxWidth: '360px' }}>
              <h1 style={s.uploadTitle}>Snap a Photo.<br />Get a Quote.</h1>
              <p style={s.uploadSub}>
                Take a picture of the electrical panel, wiring, or issue.<br />
                AI analyzes it and builds a detailed quote instantly.
              </p>
            </div>

            {error && <div style={s.error}>{error}</div>}

            <label className="drop-zone" style={s.dropZone}>
              <span style={{ fontSize: '40px' }}>📁</span>
              <span style={{ color: '#9ca3af', fontSize: '14px' }}>Tap to choose photo or drag & drop</span>
              <input ref={fileInputRef} type="file" accept="image/*,.heic,.HEIC" style={s.uploadInput} onChange={handleFileInput} />
            </label>

            {isProcessing && (
              <div style={{ textAlign: 'center' }}>
                <div style={s.spinner} />
                <p style={{ color: '#9ca3af', fontSize: '14px', marginTop: '12px' }}>Processing image…</p>
              </div>
            )}

            <p style={{ fontSize: '12px', color: '#4b5563', textAlign: 'center' }}>
              Supports HEIC, JPG, PNG from iPhone or Android
            </p>
          </div>
        )}

        {/* ── DETAILS ─────────────────────────────────────────────────────── */}
        {step === 'details' && imageData && (
          <>
            <div style={s.jobInfoBar}>
              <img src={imageData.dataUrl} style={s.imageThumb} alt="job" />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{imageData.filename}</span>
              <span style={s.jobInfoTag}>{imageData.width}×{imageData.height}</span>
            </div>

            <div style={s.detailsWrap}>
              <div>
                <div style={s.fieldLabel}>Customer Name</div>
                <input style={s.input} type="text" placeholder="e.g. John Smith" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
              </div>
              <div>
                <div style={s.fieldLabel}>Service Address</div>
                <input style={s.input} type="text" placeholder="123 Main St, Denver, CO" value={customerAddress} onChange={(e) => setCustomerAddress(e.target.value)} />
              </div>
              <div>
                <div style={s.fieldLabel}>Service Type *</div>
                <select style={s.select} value={serviceType} onChange={(e) => setServiceType(e.target.value)}>
                  <option value="">Select service…</option>
                  {SERVICE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <div style={s.fieldLabel}>Additional Notes</div>
                <textarea style={s.textarea} placeholder="Describe the issue, access notes, special requirements…" value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center', fontSize: '13px', color: '#6b7280', padding: '4px 0' }}>
                <span>Labor: ${LABOR_RATE}/hr</span>
                <span>·</span>
                <span>Trip charge: ${TRIP_CHARGE}</span>
              </div>

              {error && <div style={s.error}>{error}</div>}

              <button className="back-btn" style={s.backBtn} onClick={goToUpload}>← Choose Different Photo</button>
              <button className="action-btn" style={s.actionBtn} onClick={generateQuote} disabled={!serviceType || isProcessing}>
                {!serviceType ? 'Select a Service Type' : '⚡ Generate AI Quote →'}
              </button>
            </div>
          </>
        )}

        {/* ── ANALYZING ───────────────────────────────────────────────────── */}
        {step === 'analyzing' && (
          <div style={s.analyzingWrap}>
            <div style={s.spinner} />
            <div style={s.analyzingTitle}>Analyzing photo…</div>
            <p style={s.analyzingSub}>AI is reading the image and building your quote.<br />This takes about 10–20 seconds.</p>
          </div>
        )}

        {/* ── QUOTE ────────────────────────────────────────────────────────── */}
        {step === 'quote' && quoteResult && (
          <div style={s.quoteWrap}>
            <div style={s.quoteTabs}>
              <div style={s.quoteTab(activeTab === 'preview')} onClick={() => setActiveTab('preview')}>📷 Photo</div>
              <div style={s.quoteTab(activeTab === 'quote')} onClick={() => setActiveTab('quote')}>📋 Quote</div>
            </div>

            {activeTab === 'preview' ? (
              <div
                style={{ flex: 1, overflow: 'hidden', position: 'relative', touchAction: 'none', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
              >
                {pinchScale > 1 && (
                  <button
                    onClick={resetZoom}
                    style={{ position: 'absolute', top: 12, right: 12, zIndex: 10, background: '#13131fcc', color: '#fff', border: 'none', borderRadius: '8px', padding: '8px 12px', fontSize: '13px', cursor: 'pointer', backdropFilter: 'blur(8px)' }}
                  >
                    Reset zoom
                  </button>
                )}
                <img
                  src={imageData?.dataUrl}
                  style={{
                    maxWidth: '100%',
                    maxHeight: '100%',
                    objectFit: 'contain',
                    transform: `scale(${pinchScale}) translate(${pan.x / pinchScale}px, ${pan.y / pinchScale}px)`,
                    transformOrigin: 'center',
                    pointerEvents: 'none',
                    userSelect: 'none',
                    touchAction: 'none',
                  }}
                  alt="Job"
                  draggable={false}
                />
              </div>
            ) : (
              <div style={s.quoteContent}>
                <div style={s.quoteCard}>
                  <div style={s.quoteCardHeader}>
                    <div style={s.quoteCardTitle}>⚡ Electrical Quote</div>
                    <div style={s.quoteCardMeta}>{customerName || 'Customer'} · {serviceType}{customerAddress ? ` · ${customerAddress}` : ''}</div>
                    <div style={{ ...s.quoteCardMeta, marginTop: '2px' }}>{new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</div>
                  </div>

                  {quoteResult.summary && (
                    <div style={{ padding: '14px 20px', borderBottom: '1px solid #1e1e2e', fontSize: '14px', color: '#9ca3af', lineHeight: '1.6' }}>
                      {quoteResult.summary}
                    </div>
                  )}

                  {quoteResult.lineItems?.map((item, i) => (
                    <div key={i} style={s.lineItem}>
                      <div style={s.lineItemDesc}>
                        <div style={s.lineItemName}>{item.description}</div>
                        <div style={s.lineItemDetail}>
                          {item.qty > 1 ? `${item.qty}× ` : ''}{item.laborHrs ? `${item.laborHrs}h labor · ` : ''}{item.materials || ''}
                        </div>
                      </div>
                      <div style={s.lineItemPrice}>${item.total.toFixed(2)}</div>
                    </div>
                  ))}

                  <div style={s.subtotalRow}><span>Trip Charge</span><span>${TRIP_CHARGE.toFixed(2)}</span></div>
                  <div style={s.subtotalRow}><span>Labor ({quoteResult.totalHours}h @ ${LABOR_RATE}/hr)</span><span>${(quoteResult.totalHours * LABOR_RATE).toFixed(2)}</span></div>
                  <div style={s.subtotalRow}><span>Materials</span><span>${(quoteResult.materialsTotal || 0).toFixed(2)}</span></div>

                  <div style={s.totalRow}>
                    <span style={s.totalLabel}>TOTAL ESTIMATE</span>
                    <span style={s.totalAmount}>${quoteResult.total.toFixed(2)}</span>
                  </div>

                  {quoteResult.warranties && (
                    <div style={s.warrantyNote}><strong style={{ color: '#9ca3af' }}>Warranty:</strong> {quoteResult.warranties}</div>
                  )}
                </div>

                <p style={{ fontSize: '12px', color: '#4b5563', marginTop: '16px', lineHeight: '1.6' }}>
                  This is an estimate. Final price may vary based on actual conditions found on-site. Valid for 30 days.
                </p>
              </div>
            )}

            <div style={s.quoteActions}>
              <button className="quote-action-btn" style={s.quoteActionBtn(false)} onClick={copyQuoteText}>📋 Copy Text</button>
              <button className="quote-action-btn" style={s.quoteActionBtn(true)} onClick={startOver}>✏️ New Quote</button>
            </div>
          </div>
        )}

        {/* ── HISTORY ──────────────────────────────────────────────────────── */}
        {step === 'history' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={s.historyHeader}>
              <div>
                <div style={s.historyHeaderTitle}>Quote History</div>
                <div style={s.historyCount}>{quoteHistory.length} quote{quoteHistory.length !== 1 ? 's' : ''} saved</div>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={goToUpload}
                  style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)', color: '#000', fontWeight: '700', fontSize: '14px', padding: '10px 18px', borderRadius: '12px', border: 'none', cursor: 'pointer' }}
                >
                  + New Quote
                </button>
              </div>
            </div>

            {quoteHistory.length === 0 ? (
              <div style={s.historyEmpty}>
                <span style={{ fontSize: '48px' }}>📋</span>
                <div>
                  <div style={{ fontSize: '16px', fontWeight: '700', marginBottom: '4px' }}>No quotes yet</div>
                  <div style={{ fontSize: '14px', color: '#6b7280' }}>Your generated quotes will appear here</div>
                </div>
                <button
                  onClick={goToUpload}
                  style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)', color: '#000', fontWeight: '700', fontSize: '15px', padding: '14px 28px', borderRadius: '12px', border: 'none', cursor: 'pointer', marginTop: '8px' }}
                >
                  Create your first quote →
                </button>
              </div>
            ) : (
              <div style={s.historyWrap}>
                {quoteHistory.map((entry) => {
                  const date = new Date(entry.createdAt)
                  const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                  const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
                  return (
                    <div
                      key={entry.id}
                      className="history-card"
                      style={s.historyCard}
                      onClick={() => openHistoryQuote(entry)}
                    >
                      <div style={s.historyCardInner}>
                        <img src={entry.imageData} style={s.historyCardImg} alt={entry.customerName} />
                        <div style={s.historyCardBody}>
                          <div style={s.historyCardName}>{entry.customerName || 'Unknown Customer'}</div>
                          <div style={s.historyCardMeta}>{entry.serviceType}{entry.customerAddress ? ` · ${entry.customerAddress}` : ''}</div>
                          <div style={s.historyCardAmount}>${entry.quoteResult?.total?.toFixed(2) || '—'}</div>
                        </div>
                      </div>
                      <div style={s.historyCardFooter}>
                        <span style={s.historyCardDate}>{dateStr} at {timeStr}</span>
                        <button
                          className="del-btn"
                          style={s.historyCardDel}
                          onClick={(e) => deleteHistoryQuote(entry.id, e)}
                        >
                          🗑 Delete
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </main>

      {(step === 'quote' || step === 'history') && (
        <footer style={{ padding: '12px 20px', borderTop: '1px solid #1e1e2e', fontSize: '12px', color: '#4b5563', textAlign: 'center', flexShrink: 0 }}>
          Mallard Electric LLC · Quote Snap v1.1
        </footer>
      )}
    </div>
  )
}
