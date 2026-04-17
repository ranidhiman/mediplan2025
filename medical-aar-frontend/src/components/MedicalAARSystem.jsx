import { useState, useEffect, useRef } from 'react';
import { Send, FileText, Map, MessageSquare, Search, Download, Filter, Upload, File, X, LogOut, Eye, Trash2 } from 'lucide-react';
import { reportService } from '../services/api';
import mgrs from 'mgrs';

const MedicalAARSystem = ({ user, onLogout }) => {
  const [activeTab, setActiveTab] = useState('chatbot');
  const [messages, setMessages] = useState([
    { type: 'bot', text: 'Hello! I can help you with information about medical operations, AARs, and incident reports. What would you like to know?' }
  ]);
  const [inputMessage, setInputMessage] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [dragActive, setDragActive] = useState(false);
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const gridMarkerRef = useRef(null);
  const reportMarkersRef = useRef([]);
  const locationMarkersRef = useRef([]);
  // Geocode cache persisted to localStorage so Nominatim is never hit twice for the same string
  const geocodeCacheRef = useRef(null);
  if (!geocodeCacheRef.current) {
    try { geocodeCacheRef.current = JSON.parse(localStorage.getItem('geocodeCache') || '{}'); }
    catch { geocodeCacheRef.current = {}; }
  }
  const extractionCacheRef = useRef({});   // reportId → extraction JSON (in-session)
  const lastReportIdsRef = useRef('');     // serialised report IDs — skip redraw when unchanged
  const fileInputRef = useRef(null);
  const rafCursorRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);

  const [reports, setReports] = useState([]);
  const [loadingReports, setLoadingReports] = useState(true);
  const [uploadForm, setUploadForm] = useState({
    title: '',
    date: '',
    location: '',
    type: 'After Action Report',
    casualty: '',
    injury: '',
    status: 'Pending Review'
  });
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [jsonPanel, setJsonPanel] = useState(null); // { reportId, content, saving, error }
  const [viewPanel, setViewPanel] = useState(null); // { reportId, url }
  const [aarModal, setAarModal] = useState(null);

  const [incidents] = useState([]);
  const [selectedMarkerInfo, setSelectedMarkerInfo] = useState(null);
  const [mgrsInput, setMgrsInput] = useState('');
  const [mgrsError, setMgrsError] = useState('');
  const [cursorMgrs, setCursorMgrs] = useState('');
  const [selectedMgrs, setSelectedMgrs] = useState('');

  const buildMarkerIcon = (color) => {
    if (!window.L) return null;
    return window.L.divIcon({
      className: 'custom-marker',
      html: `<div style="background-color: ${color}; width: 30px; height: 30px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.3);"></div>`,
      iconSize: [30, 30],
      iconAnchor: [15, 15]
    });
  };

  const formatMgrs = (lat, lng) => {
    try {
      return mgrs.forward([lng, lat], 5);
    } catch (error) {
      return null;
    }
  };

  // Fetch reports on mount, then refresh every 30 s so newly uploaded docs appear
  useEffect(() => {
    const fetchReports = async (initial = false) => {
      try {
        if (initial) setLoadingReports(true);
        const data = await reportService.getAllReports();
        setReports(prev => {
          // Skip re-render when nothing changed
          const prevIds = prev.map(r => r._id).sort().join(',');
          const nextIds = data.map(r => r._id).sort().join(',');
          return prevIds === nextIds ? prev : data;
        });
      } catch (error) {
        console.error('Error fetching reports:', error);
      } finally {
        if (initial) setLoadingReports(false);
      }
    };

    fetchReports(true);
    const interval = setInterval(() => fetchReports(false), 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (activeTab === 'map' && mapRef.current && !mapInstanceRef.current) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);

      const script = document.createElement('script');
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.async = true;
      script.onload = () => {
        initializeMap();
      };
      document.head.appendChild(script);
    }
  }, [activeTab]);

  // Derive a broad location type from Nominatim's addresstype / class fields.
  const _nominatimLocType = (result) => {
    const at = (result.addresstype || '').toLowerCase();
    const cl = (result.class || '').toLowerCase();
    const ty = (result.type || '').toLowerCase();
    if (at === 'country' || ty === 'country') return 'country';
    if (['state', 'county', 'region', 'province', 'territory'].includes(at)) return 'region';
    return 'specific'; // city, town, hospital, military, aerodrome, etc.
  };

  // Geocode via Nominatim. Results (including locationType) are stored in both
  // the in-memory ref AND localStorage so they survive page reloads.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const geocodeLocation = async (locationText) => {
    if (!locationText || locationText === 'Unknown') return null;
    const key = locationText.trim().toLowerCase();

    // Already cached — return instantly, no network call, no delay
    if (key in geocodeCacheRef.current) return geocodeCacheRef.current[key];

    // Rate-limit ONLY uncached requests (Nominatim: max 1 req/s)
    await new Promise(r => setTimeout(r, 1100));
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(locationText)}&format=json&limit=1`;
      const resp = await fetch(url, { headers: { 'Accept-Language': 'en' } });
      const results = await resp.json();
      const coords = results.length > 0
        ? { lat: parseFloat(results[0].lat), lng: parseFloat(results[0].lon), locationType: _nominatimLocType(results[0]) }
        : null;
      geocodeCacheRef.current[key] = coords;
      try { localStorage.setItem('geocodeCache', JSON.stringify(geocodeCacheRef.current)); } catch {}
      return coords;
    } catch {
      geocodeCacheRef.current[key] = null;
      return null;
    }
  };

  // Unified marker plotter — collects all points from all sources, groups by
  // coordinate (±0.001° ≈ 100m), then plots ONE merged marker per location.
  // Clicking a marker populates the right sidebar via setSelectedMarkerInfo.
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current || !window.L) return;

    reportMarkersRef.current.forEach(m => m.remove());
    reportMarkersRef.current = [];
    locationMarkersRef.current.forEach(m => m.remove());
    locationMarkersRef.current = [];

    const plotAllMarkers = async () => {
      // Skip redraw when the report list hasn't changed
      const currentIds = reports.map(r => r._id).sort().join(',');
      if (currentIds === lastReportIdsRef.current) return;
      lastReportIdsRef.current = currentIds;

      // ── Step 1: gather all (lat, lng, type, report, locationName) tuples ──
      const pointItems = []; // { lat, lng, type:'report'|'mention', report, locationName }

      // Primary report locations
      for (const report of reports) {
        let lat = null, lng = null;
        if (report.latitude != null && report.longitude != null) {
          lat = report.latitude; lng = report.longitude;
        } else if (report.mgrsGrid) {
          try {
            const pt = mgrs.toPoint(report.mgrsGrid.replace(/\s+/g, ''));
            lng = pt[0]; lat = pt[1];
          } catch {}
        }
        if (lat == null) {
          const locText = report.location && report.location !== report.mgrsGrid ? report.location : null;
          if (locText) {
            const coords = await geocodeLocation(locText);
            if (coords) { lat = coords.lat; lng = coords.lng; }
          }
        }
        if (lat != null) {
          pointItems.push({ lat, lng, locationType: 'specific', type: 'report', report, locationName: report.location || report.fileName || 'Unknown' });
        }
      }

      // Mentioned locations — use in-session extraction cache to avoid repeated fetches
      const extractionResults = await Promise.all(
        reports.map(async (report) => {
          if (extractionCacheRef.current[report._id]) {
            return { report, extraction: extractionCacheRef.current[report._id] };
          }
          try {
            const extraction = await reportService.getExtraction(report._id);
            extractionCacheRef.current[report._id] = extraction;
            return { report, extraction };
          } catch {
            extractionCacheRef.current[report._id] = null;
            return { report, extraction: null };
          }
        })
      );

      const locationGroups = {};
      for (const { report, extraction } of extractionResults) {
        if (!extraction) continue;
        const locVal = extraction?.fields?.locations?.value;
        const locs = Array.isArray(locVal) ? locVal : [];
        for (const loc of locs) {
          if (!loc || typeof loc !== 'string' || loc.trim().length < 3) continue;
          const key = loc.trim().toLowerCase();
          if (!locationGroups[key]) locationGroups[key] = { display: loc.trim(), mentioningReports: [] };
          locationGroups[key].mentioningReports.push(report);
        }
      }

      // Geocode — delay only for uncached entries; carry locationType from Nominatim
      for (const { display, mentioningReports } of Object.values(locationGroups)) {
        const coords = await geocodeLocation(display);
        if (coords) {
          for (const report of mentioningReports) {
            pointItems.push({
              lat: coords.lat, lng: coords.lng,
              locationType: coords.locationType || 'specific',
              type: 'mention', report, locationName: display,
            });
          }
        }
      }

      // ── Step 2: group by rounded coordinate (±0.001° ≈ 100 m) ──
      const coordGroups = {};
      for (const item of pointItems) {
        const key = `${item.lat.toFixed(3)},${item.lng.toFixed(3)}`;
        if (!coordGroups[key]) coordGroups[key] = { lat: item.lat, lng: item.lng, items: [] };
        coordGroups[key].items.push(item);
      }

      // ── Step 3: one marker per coordinate group ──
      for (const group of Object.values(coordGroups)) {
        if (!mapInstanceRef.current || !window.L) break;

        const hasReport   = group.items.some(i => i.type === 'report');
        const hasMention  = group.items.some(i => i.type === 'mention');
        const isCountry   = group.items.some(i => i.locationType === 'country');
        const isRegion    = !isCountry && group.items.some(i => i.locationType === 'region');

        // Color priority: overlap > report > country > region > specific mention
        const color = hasReport && hasMention ? '#10b981'   // green  — primary + mentioned
                    : hasReport               ? '#3b82f6'   // blue   — primary location
                    : isCountry               ? '#8b5cf6'   // purple — country mention
                    : isRegion                ? '#ec4899'   // pink   — state/region mention
                    :                           '#f59e0b';  // amber  — specific location mention

        // Deduplicate items by (reportId + locationName)
        const seen = new Set();
        const uniqueItems = group.items.filter(item => {
          const k = `${item.report._id}|${item.locationName}`;
          if (seen.has(k)) return false;
          seen.add(k); return true;
        });

        // Group unique items by document for popup + sidebar
        const byDoc = {};
        for (const item of uniqueItems) {
          const dk = item.report._id;
          if (!byDoc[dk]) byDoc[dk] = { report: item.report, locationNames: [], types: new Set() };
          byDoc[dk].locationNames.push(item.locationName);
          byDoc[dk].types.add(item.type);
        }
        const docList = Object.values(byDoc);
        const primaryName = uniqueItems[0].locationName;

        // Compact popup (full detail is in sidebar)
        const popupHtml = docList.map(({ report, locationNames, types }) => `
          <div style="margin-bottom:6px;padding-bottom:6px;border-bottom:1px solid #e5e7eb;">
            <p style="font-weight:600;font-size:12px;margin:0 0 1px;">${report.fileName || report.title}</p>
            ${report.documentId ? `<p style="font-size:10px;color:#9ca3af;font-family:monospace;margin:0 0 1px;">${report.documentId}</p>` : ''}
            <p style="font-size:10px;color:#6b7280;margin:0;">${[...types].join(' + ')} · ${locationNames.join(', ')}</p>
          </div>`
        ).join('');

        const icon = buildMarkerIcon(color);
        const marker = window.L.marker([group.lat, group.lng], icon ? { icon } : undefined)
          .addTo(mapInstanceRef.current);

        marker.bindPopup(`
          <div style="color:#1f2937;min-width:220px;max-width:300px;font-family:sans-serif;">
            <h3 style="font-weight:bold;margin:0 0 8px;font-size:13px;color:#374151;">
              ${primaryName}${docList.length > 1 ? ` <span style="color:#9ca3af;font-weight:normal;">(${docList.length} docs)</span>` : ''}
            </h3>
            ${popupHtml}
            <p style="margin:6px 0 0;font-size:10px;color:#9ca3af;">Click marker to see full details →</p>
          </div>
        `);

        marker.on('click', () => setSelectedMarkerInfo({ primaryName, docList, color, isCountry, isRegion }));
        reportMarkersRef.current.push(marker);
      }
    };

    plotAllMarkers();
  }, [reports, mapReady]);

  const initializeMap = () => {
    if (window.L && mapRef.current && !mapInstanceRef.current) {
      const map = window.L.map(mapRef.current).setView([49.6917, 11.9428], 11);

      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19
      }).addTo(map);

      incidents.forEach(incident => {
        let markerColor;
        switch(incident.severity) {
          case 'Moderate':
            markerColor = '#f59e0b';
            break;
          case 'Severe':
            markerColor = '#ef4444';
            break;
          default:
            markerColor = '#10b981';
        }

        const icon = buildMarkerIcon(markerColor);
        const marker = window.L.marker([incident.lat, incident.lng], icon ? { icon } : undefined).addTo(map);

        marker.bindPopup(`
          <div style="color: #1f2937; min-width: 200px;">
            <h3 style="font-weight: bold; margin-bottom: 8px; color: #059669;">${incident.title}</h3>
            <p style="margin: 4px 0;"><strong>Type:</strong> ${incident.type}</p>
            <p style="margin: 4px 0;"><strong>Date:</strong> ${incident.date}</p>
            <p style="margin: 4px 0;"><strong>Severity:</strong> ${incident.severity}</p>
            <p style="margin: 4px 0; font-size: 12px;">${incident.description}</p>
          </div>
        `);
      });

      mapInstanceRef.current = map;
      setMapReady(true);

      const updateCursorMgrs = (latlng) => {
        if (rafCursorRef.current) cancelAnimationFrame(rafCursorRef.current);
        rafCursorRef.current = requestAnimationFrame(() => {
          try {
            const grid = mgrs.forward([latlng.lng, latlng.lat], 5);
            setCursorMgrs(grid);
          } catch (error) {
            setCursorMgrs('');
          }
        });
      };

      map.on('mousemove', (event) => updateCursorMgrs(event.latlng));
      map.on('click', (event) => {
        try {
          const grid = mgrs.forward([event.latlng.lng, event.latlng.lat], 5);
          setSelectedMgrs(grid);
        } catch (error) {
          setSelectedMgrs('');
        }
      });

      setTimeout(() => {
        map.invalidateSize();
      }, 100);
    }
  };

  const handleMgrsGo = () => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const cleaned = mgrsInput.trim().toUpperCase();
    if (!cleaned) return;

    try {
      const [lng, lat] = mgrs.toPoint(cleaned);
      map.setView([lat, lng], 15);

      if (gridMarkerRef.current) {
        gridMarkerRef.current.remove();
      }
      const icon = buildMarkerIcon('#3b82f6');
      gridMarkerRef.current = window.L.marker([lat, lng], icon ? { icon } : undefined).addTo(map);
      setMgrsError('');
    } catch (error) {
      setMgrsError('Invalid MGRS coordinate. Example: 32U ND 12345 67890');
    }
  };

  const handleSendMessage = async () => {
  if (inputMessage.trim()) {
    const userMessage = inputMessage;
    
    setMessages(prev => [...prev, 
      { type: 'user', text: userMessage },
      { type: 'bot', text: 'Thinking...', loading: true }
    ]);
    setInputMessage('');
    
    try {
      const response = await fetch('http://localhost:5002/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMessage })
      });
      
      const data = await response.json();
      
      setMessages(prev => {
        const filtered = prev.filter(msg => !msg.loading);
        return [...filtered, { type: 'bot', text: data.response }];
      });
      
    } catch (error) {
      console.error('Chat error:', error);
      setMessages(prev => {
        const filtered = prev.filter(msg => !msg.loading);
        return [...filtered, { 
          type: 'bot', 
          text: 'Sorry, I encountered an error. Please make sure the RAG API is running on port 5002.' 
        }];
      });
    }
  }
};

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const handleFileInput = (e) => {
    if (e.target.files && e.target.files[0]) {
      handleFiles(e.target.files);
    }
  };

  const handleFiles = (files) => {
    if (files[0]) {
      setSelectedFile(files[0]);
      setUploadedFiles([{
        id: Date.now(),
        name: files[0].name,
        size: files[0].size,
        type: files[0].type,
        file: files[0],
        uploadDate: new Date().toISOString()
      }]);
    }
  };

  const removeFile = () => {
    setUploadedFiles([]);
    setSelectedFile(null);
  };

  const handleUploadSubmit = async () => {
    if (!selectedFile) {
      alert('Please select a file to upload');
      return;
    }

    setUploading(true);
    setUploadProgress({ percent: 0, stage: 'uploading', message: 'Uploading file...', log: [] });

    try {
      const formData = {};
      const { jobId } = await reportService.uploadFile(selectedFile, formData);

      const token = localStorage.getItem('token');
      const sse = new EventSource(`http://localhost:5003/api/reports/progress/${jobId}?token=${token}`);

      sse.onmessage = (e) => {
        const event = JSON.parse(e.data);
        setUploadProgress(prev => ({
          percent: event.percent,
          stage: event.stage,
          message: event.message,
          log: [...(prev?.log || []), event],
        }));

        if (event.stage === 'complete') {
          sse.close();
          setTimeout(() => {
            setUploading(false);
            setUploadProgress(null);
            reportService.getAllReports().then(data => setReports(data));
            setSelectedFile(null);
            setUploadedFiles([]);
            setUploadForm({ title: '', date: '', location: '', type: 'After Action Report', casualty: '', injury: '', status: 'Pending Review' });
            setActiveTab('reports');
          }, 800); // brief pause so user sees 100%
        }

        if (event.stage === 'error') {
          sse.close();
          setUploading(false);
          setUploadProgress(null);
          alert('Upload failed: ' + event.message);
        }
      };

      sse.onerror = () => {
        sse.close();
        setUploading(false);
        setUploadProgress(null);
        alert('Lost connection to server during upload.');
      };
    } catch (error) {
      console.error('Upload error:', error);
      setUploading(false);
      setUploadProgress(null);
      alert('Upload failed. Please try again.');
    }
  };

  const handleDownload = async (report) => {
    try {
      const blob = await reportService.downloadReport(report._id);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = report.fileName || 'download';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Download error:', error);
      alert('Download failed. The file may not exist.');
    }
  };

  const handleDeleteReport = async (report) => {
    if (!window.confirm(`Delete "${report.title}"? This cannot be undone.`)) return;
    try {
      await reportService.deleteReport(report._id);
      setReports(prev => prev.filter(r => r._id !== report._id));
    } catch (error) {
      console.error('Delete error:', error);
      alert('Failed to delete report.');
    }
  };

  const handleToggleJsonPanel = async (report) => {
    // Toggle off if already open for this report
    if (jsonPanel && jsonPanel.reportId === report._id) {
      setJsonPanel(null);
      return;
    }
    setJsonPanel({ reportId: report._id, content: null, saving: false, error: null });
    try {
      const data = await reportService.getExtraction(report._id);
      setJsonPanel({ reportId: report._id, content: JSON.stringify(data, null, 2), saving: false, error: null });
    } catch {
      setJsonPanel({ reportId: report._id, content: '// No extraction data available for this report.', saving: false, error: null });
    }
  };

  const handleSaveJson = async () => {
    let parsed;
    try { parsed = JSON.parse(jsonPanel.content); } catch {
      setJsonPanel(prev => ({ ...prev, error: 'Invalid JSON — fix syntax errors before saving.' }));
      return;
    }
    setJsonPanel(prev => ({ ...prev, saving: true, error: null }));
    try {
      await reportService.updateExtraction(jsonPanel.reportId, parsed);
      // Re-index in ChromaDB so chatbot reflects corrections
      try { await reportService.reindex(jsonPanel.reportId); } catch {}
      setJsonPanel(prev => ({ ...prev, saving: false, error: null }));
    } catch {
      setJsonPanel(prev => ({ ...prev, saving: false, error: 'Save failed. Please try again.' }));
    }
  };

  const handleSyncToReport = async () => {
    let parsed;
    try { parsed = JSON.parse(jsonPanel.content); } catch {
      setJsonPanel(prev => ({ ...prev, error: 'Invalid JSON — fix syntax errors before syncing.' }));
      return;
    }
    const f = parsed.fields || {};
    const getValue = (key) => f[key]?.value ?? null;

    const rawDate = getValue('date');
    const dateVal = rawDate && !isNaN(new Date(rawDate).getTime()) ? rawDate : null;

    const updates = {};
    if (getValue('title'))    updates.title    = getValue('title');
    if (dateVal)              updates.date     = dateVal;
    if (getValue('mgrsGrid')) { updates.mgrsGrid = getValue('mgrsGrid'); updates.location = getValue('mgrsGrid'); }
    else if (getValue('location')) updates.location = getValue('location');
    if (getValue('casualty')) updates.casualty = getValue('casualty');
    if (getValue('injury'))   updates.injury   = getValue('injury');
    if (getValue('type'))     updates.type     = getValue('type');
    if (getValue('status'))   updates.status   = getValue('status');

    if (Object.keys(updates).length === 0) {
      setJsonPanel(prev => ({ ...prev, error: 'No recognized fields found in JSON to sync.' }));
      return;
    }

    setJsonPanel(prev => ({ ...prev, syncing: true, error: null }));
    try {
      const updated = await reportService.updateReport(jsonPanel.reportId, updates);
      setReports(prev => prev.map(r => r._id === updated._id ? updated : r));
      setJsonPanel(prev => ({ ...prev, syncing: false, error: null, syncSuccess: true }));
      setTimeout(() => setJsonPanel(prev => prev ? { ...prev, syncSuccess: false } : prev), 2000);
    } catch {
      setJsonPanel(prev => ({ ...prev, syncing: false, error: 'Sync failed. Please try again.' }));
    }
  };

  const handleOpenAarModal = (report) => {
    setAarModal({
      report,
      form: {
        title:    report.title    || '',
        date:     report.date ? new Date(report.date).toISOString().split('T')[0] : '',
        location: report.mgrsGrid || report.location || '',
        type:     report.type     || 'After Action Report',
        casualty: report.casualty || '',
        injury:   report.injury   || '',
        status:   report.status   || 'Pending Review',
      },
      saving: false,
      error: null,
    });
  };

  const handleSaveAar = async () => {
    setAarModal(prev => ({ ...prev, saving: true, error: null }));
    try {
      const updated = await reportService.updateReport(aarModal.report._id, {
        ...aarModal.form,
        mgrsGrid: aarModal.form.location,
      });
      setReports(prev => prev.map(r => r._id === updated._id ? updated : r));
      setAarModal(null);
    } catch {
      setAarModal(prev => ({ ...prev, saving: false, error: 'Save failed. Please try again.' }));
    }
  };

  const handleToggleViewPanel = (report) => {
    if (viewPanel && viewPanel.reportId === report._id) {
      setViewPanel(null);
      return;
    }
    if (!report.filePath) {
      alert('No file attached to this report');
      return;
    }
    const token = localStorage.getItem('token');
    setViewPanel({
      reportId: report._id,
      url: `http://localhost:5003/api/reports/${report._id}/view?token=${token}`,
    });
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const filteredReports = reports.filter(report => {
    const q = searchTerm.toLowerCase();
    return (
      (report.fileName || '').toLowerCase().includes(q) ||
      (report.documentId || '').toLowerCase().includes(q) ||
      (report.title || '').toLowerCase().includes(q) ||
      (report.location || '').toLowerCase().includes(q) ||
      (report.casualty || '').toLowerCase().includes(q)
    );
  });

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString();
  };

  const STAGE_LABELS = {
    received: 'File received',
    reading: 'Reading document',
    extracting_text: 'Extracting text from PDF',
    regex: 'Running pattern matching',
    regex_done: 'Pattern matching complete',
    llm: 'Sending to AI',
    llm_done: 'AI extraction complete',
    llm_skip: 'All fields matched',
    llm_error: 'AI extraction failed',
    schema: 'Building adaptive schema',
    saving: 'Saving to database',
    complete: 'Complete',
    error: 'Error',
  };

  return (
    <div className="h-screen bg-gray-900 text-gray-100 flex flex-col">

      {/* ── Upload progress modal ── */}
      {uploadProgress && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-8 w-full max-w-lg shadow-2xl">
            <h3 className="text-lg font-bold text-green-400 mb-1">Processing Report</h3>
            <p className="text-gray-400 text-sm mb-6">Do not close this window</p>

            {/* Bar */}
            <div className="mb-2 flex justify-between items-center">
              <span className="text-sm text-gray-300 truncate pr-4">{uploadProgress.message}</span>
              <span className="text-green-400 font-mono text-sm shrink-0">{uploadProgress.percent}%</span>
            </div>
            <div className="w-full bg-gray-700 rounded-full h-3 mb-6 overflow-hidden">
              <div
                className="h-3 rounded-full transition-all duration-500"
                style={{
                  width: `${uploadProgress.percent}%`,
                  background: uploadProgress.stage === 'error'
                    ? '#ef4444'
                    : uploadProgress.stage === 'complete'
                    ? '#10b981'
                    : 'linear-gradient(90deg, #059669, #34d399)',
                }}
              />
            </div>

            {/* Stage log */}
            <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
              {uploadProgress.log.map((event, i) => {
                const isLast = i === uploadProgress.log.length - 1;
                const isDone = event.stage === 'complete';
                const isErr  = event.stage === 'error';
                return (
                  <div key={i} className="flex items-start gap-3 text-sm">
                    <span className={`mt-0.5 shrink-0 text-base ${
                      isErr ? 'text-red-400' : isDone ? 'text-green-400' : isLast ? 'text-yellow-400' : 'text-green-600'
                    }`}>
                      {isErr ? '✗' : isDone ? '✓' : isLast ? '⟳' : '✓'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <span className={`font-medium ${
                        isErr ? 'text-red-300' : isDone ? 'text-green-300' : isLast ? 'text-yellow-200' : 'text-gray-400'
                      }`}>
                        {STAGE_LABELS[event.stage] || event.stage}
                      </span>
                      {event.message !== STAGE_LABELS[event.stage] && (
                        <p className="text-gray-500 text-xs mt-0.5 truncate">{event.message}</p>
                      )}
                    </div>
                    <span className="text-gray-600 text-xs shrink-0">{event.percent}%</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}


      {/* ── AAR info edit modal ── */}
      {aarModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{backdropFilter:'blur(4px)', background:'rgba(0,0,0,0.7)'}}>
          <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-lg flex flex-col" style={{maxHeight:'85vh'}}>
            <div className="flex justify-between items-center p-5 border-b border-gray-700">
              <h3 className="text-lg font-bold text-green-400">Edit AAR Information</h3>
              <button onClick={() => setAarModal(null)} className="text-gray-500 hover:text-gray-200 text-2xl leading-none">&times;</button>
            </div>
            <div className="overflow-y-auto p-5 space-y-4">
              {[
                { label: 'Title',      key: 'title',    type: 'text',   placeholder: 'Report title' },
                { label: 'Date',       key: 'date',     type: 'date',   placeholder: '' },
                { label: 'MGRS Grid',  key: 'location', type: 'text',   placeholder: 'e.g. 38T MN 12345 67890' },
                { label: 'Casualty',   key: 'casualty', type: 'text',   placeholder: 'e.g. CAx3' },
                { label: 'Injury',     key: 'injury',   type: 'text',   placeholder: 'Injury type' },
              ].map(({ label, key, type, placeholder }) => (
                <div key={key}>
                  <label className="block text-gray-400 text-sm mb-1">{label}</label>
                  <input
                    type={type}
                    value={aarModal.form[key]}
                    onChange={e => setAarModal(prev => ({ ...prev, form: { ...prev.form, [key]: e.target.value } }))}
                    placeholder={placeholder}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-gray-100 focus:outline-none focus:border-green-400"
                  />
                </div>
              ))}
              <div>
                <label className="block text-gray-400 text-sm mb-1">Type</label>
                <select
                  value={aarModal.form.type}
                  onChange={e => setAarModal(prev => ({ ...prev, form: { ...prev.form, type: e.target.value } }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-gray-100 focus:outline-none focus:border-green-400"
                >
                  <option>After Action Report</option>
                  <option>Operations Order</option>
                  <option>Incident Report</option>
                  <option>Medical Report</option>
                </select>
              </div>
              <div>
                <label className="block text-gray-400 text-sm mb-1">Status</label>
                <select
                  value={aarModal.form.status}
                  onChange={e => setAarModal(prev => ({ ...prev, form: { ...prev.form, status: e.target.value } }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-gray-100 focus:outline-none focus:border-green-400"
                >
                  <option>Pending Review</option>
                  <option>In Review</option>
                  <option>Completed</option>
                </select>
              </div>
            </div>
            {aarModal.error && <p className="text-red-400 text-sm px-5 pb-2">{aarModal.error}</p>}
            <div className="flex gap-3 p-5 border-t border-gray-700">
              <button
                onClick={handleSaveAar}
                disabled={aarModal.saving}
                className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-lg px-4 py-2 font-semibold transition-colors"
              >
                {aarModal.saving ? 'Saving...' : 'Save Changes'}
              </button>
              <button onClick={() => setAarModal(null)} className="bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg px-4 py-2 font-semibold transition-colors">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-gray-800 border-b border-gray-700 p-4 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-green-400">MEDIPLAN</h1>
          <p className="text-sm text-gray-400">Tactical Medical Data System</p>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-gray-400">Welcome, {user.username}</span>
          <button
            onClick={onLogout}
            className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg transition-colors"
          >
            <LogOut size={18} />
            Logout
          </button>
        </div>
      </div>

      <div className="bg-gray-800 border-b border-gray-700 flex">
        <button
          onClick={() => setActiveTab('chatbot')}
          className={`flex items-center gap-2 px-6 py-3 font-semibold transition-colors ${
            activeTab === 'chatbot' 
              ? 'bg-gray-900 text-green-400 border-b-2 border-green-400' 
              : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          <MessageSquare size={20} />
          AI Assistant
        </button>
        <button
          onClick={() => setActiveTab('reports')}
          className={`flex items-center gap-2 px-6 py-3 font-semibold transition-colors ${
            activeTab === 'reports' 
              ? 'bg-gray-900 text-green-400 border-b-2 border-green-400' 
              : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          <FileText size={20} />
          Reports
        </button>
        <button
          onClick={() => setActiveTab('upload')}
          className={`flex items-center gap-2 px-6 py-3 font-semibold transition-colors ${
            activeTab === 'upload' 
              ? 'bg-gray-900 text-green-400 border-b-2 border-green-400' 
              : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          <Upload size={20} />
          Upload
        </button>
        <button
          onClick={() => setActiveTab('map')}
          className={`flex items-center gap-2 px-6 py-3 font-semibold transition-colors ${
            activeTab === 'map' 
              ? 'bg-gray-900 text-green-400 border-b-2 border-green-400' 
              : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          <Map size={20} />
          Incident Map
        </button>
      </div>

      <div className="flex-1 overflow-hidden">
        {activeTab === 'chatbot' && (
          <div className="h-full flex flex-col">
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {messages.map((msg, idx) => (
                <div key={idx} className={`flex ${msg.type === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-2xl rounded-lg p-4 ${
                    msg.type === 'user' 
                      ? 'bg-green-600 text-white' 
                      : 'bg-gray-800 text-gray-100'
                  }`}>
                    <p>{msg.text}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="bg-gray-800 border-t border-gray-700 p-4">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                  placeholder="Ask about medical operations, AARs, evacuation procedures..."
                  className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-gray-100 placeholder-gray-500 focus:outline-none focus:border-green-400"
                />
                <button
                  onClick={handleSendMessage}
                  className="bg-green-600 hover:bg-green-700 text-white rounded-lg px-6 py-3 font-semibold flex items-center gap-2 transition-colors"
                >
                  <Send size={20} />
                  Send
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'reports' && (
          <div className="h-full overflow-y-auto p-6">
            <div className="mb-6">
              <div className="flex gap-4 items-center">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-3 text-gray-500" size={20} />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search reports by title, location, or casualty..."
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-10 pr-4 py-3 text-gray-100 placeholder-gray-500 focus:outline-none focus:border-green-400"
                  />
                </div>
                <button className="bg-gray-800 hover:bg-gray-700 text-gray-100 rounded-lg px-4 py-3 flex items-center gap-2 border border-gray-700 transition-colors">
                  <Filter size={20} />
                  Filter
                </button>
              </div>
            </div>

            <div className="grid gap-4">
              {loadingReports ? (
                <div className="text-center py-12 text-gray-400">Loading reports...</div>
              ) : filteredReports.length === 0 ? (
                <div className="text-center py-12">
                  <FileText size={48} className="mx-auto mb-4 text-gray-600" />
                  <p className="text-gray-400">No reports found. Upload your first report to get started.</p>
                </div>
              ) : filteredReports.map(report => (
                <div key={report._id} className="bg-gray-800 border border-gray-700 rounded-lg hover:border-green-400 transition-colors">
                  <div className="p-6">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <h3 className="text-xl font-bold text-green-400 mb-2">
                          <span className="text-gray-500 font-mono text-sm mr-2">{report.documentId}</span>
                          {report.fileName || report.title}
                        </h3>
                        <p className="text-gray-400 text-sm">Grid: {report.mgrsGrid || report.location}</p>
                      </div>
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                        report.status === 'Completed' ? 'bg-green-900 text-green-300' : 'bg-blue-900 text-blue-300'
                      }`}>
                        {report.status}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-4 mb-4">
                      <div>
                        <p className="text-gray-500 text-sm">Date</p>
                        <p className="text-gray-200">{formatDate(report.date)}</p>
                      </div>
                      <div>
                        <p className="text-gray-500 text-sm">Type</p>
                        <p className="text-gray-200">{report.type || 'N/A'}</p>
                      </div>
                      <div>
                        <p className="text-gray-500 text-sm">Casualty</p>
                        <p className="text-gray-200">{report.casualty || 'N/A'}</p>
                      </div>
                      <div>
                        <p className="text-gray-500 text-sm">Injury Type</p>
                        <p className="text-gray-200">{report.injury || 'N/A'}</p>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={() => handleToggleViewPanel(report)}
                        className={`flex-1 rounded-lg px-4 py-2 font-semibold transition-colors flex items-center justify-center gap-2 ${
                          viewPanel?.reportId === report._id
                            ? 'bg-green-800 text-green-200'
                            : 'bg-green-600 hover:bg-green-700 text-white'
                        }`}
                      >
                        <Eye size={18} />
                        View
                      </button>
                      <button
                        onClick={() => handleOpenAarModal(report)}
                        className="bg-gray-700 hover:bg-gray-600 text-gray-100 rounded-lg px-4 py-2 font-semibold transition-colors flex items-center gap-2"
                      >
                        <FileText size={18} />
                        Edit
                      </button>
                      <button
                        onClick={() => handleToggleJsonPanel(report)}
                        className={`rounded-lg px-4 py-2 font-semibold transition-colors flex items-center gap-2 ${
                          jsonPanel?.reportId === report._id
                            ? 'bg-yellow-600 text-white'
                            : 'bg-gray-700 hover:bg-gray-600 text-yellow-300'
                        }`}
                      >
                        {'{ }'}
                      </button>
                      <button
                        onClick={() => handleDownload(report)}
                        className="bg-gray-700 hover:bg-gray-600 text-gray-100 rounded-lg px-4 py-2 transition-colors"
                      >
                        <Download size={18} />
                      </button>
                      <button
                        onClick={() => handleDeleteReport(report)}
                        className="bg-red-600 hover:bg-red-700 text-white rounded-lg px-4 py-2 transition-colors"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </div>

                  {/* ── Inline file view panel ── */}
                  {viewPanel && viewPanel.reportId === report._id && (
                    <div className="border-t border-gray-700 bg-gray-950 rounded-b-lg">
                      <div className="flex justify-between items-center px-5 py-3 border-b border-gray-800">
                        <span className="text-green-400 font-mono text-sm font-bold">{report.fileName || 'Document'}</span>
                        <button
                          onClick={() => setViewPanel(null)}
                          className="text-gray-500 hover:text-gray-200 text-xl leading-none px-1"
                        >
                          &times;
                        </button>
                      </div>
                      <iframe
                        src={viewPanel.url}
                        title={report.fileName || 'Document'}
                        className="w-full"
                        style={{ height: '700px', border: 'none' }}
                      />
                    </div>
                  )}

                  {/* ── Inline JSON panel ── */}
                  {jsonPanel && jsonPanel.reportId === report._id && (
                    <div className="border-t border-gray-700 bg-gray-950 rounded-b-lg">
                      <div className="flex justify-between items-center px-5 py-3 border-b border-gray-800">
                        <span className="text-yellow-400 font-mono text-sm font-bold">extraction.json</span>
                        <div className="flex gap-2 items-center">
                          <button
                            onClick={handleSaveJson}
                            disabled={jsonPanel.saving || jsonPanel.syncing || jsonPanel.content === null}
                            className="bg-yellow-600 hover:bg-yellow-700 disabled:opacity-50 text-white rounded px-3 py-1 text-sm font-semibold transition-colors"
                          >
                            {jsonPanel.saving ? 'Saving...' : 'Save'}
                          </button>
                          <button
                            onClick={handleSyncToReport}
                            disabled={jsonPanel.saving || jsonPanel.syncing || jsonPanel.content === null}
                            className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded px-3 py-1 text-sm font-semibold transition-colors"
                            title="Push JSON field values back to the report card"
                          >
                            {jsonPanel.syncing ? 'Syncing...' : jsonPanel.syncSuccess ? 'Synced!' : 'Sync to Report'}
                          </button>
                          <button
                            onClick={() => setJsonPanel(null)}
                            className="text-gray-500 hover:text-gray-200 text-xl leading-none px-1"
                          >
                            &times;
                          </button>
                        </div>
                      </div>
                      {jsonPanel.content === null ? (
                        <p className="text-gray-500 text-sm p-5">Loading...</p>
                      ) : (
                        <textarea
                          value={jsonPanel.content}
                          onChange={e => setJsonPanel(prev => ({ ...prev, content: e.target.value, error: null }))}
                          className="w-full bg-gray-950 text-green-300 font-mono text-sm p-5 focus:outline-none resize-none"
                          style={{ minHeight: '320px', height: `${(jsonPanel.content.split('\n').length + 2) * 20}px`, maxHeight: '600px' }}
                          spellCheck={false}
                        />
                      )}
                      {jsonPanel.error && (
                        <p className="text-red-400 text-sm px-5 pb-3">{jsonPanel.error}</p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'upload' && (
          <div className="h-full overflow-y-auto p-6">
            <div className="max-w-4xl mx-auto">
              <h2 className="text-2xl font-bold text-green-400 mb-6">Upload New Reports</h2>
              
              <div
                className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
                  dragActive 
                    ? 'border-green-400 bg-green-900/20' 
                    : 'border-gray-700 bg-gray-800'
                }`}
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
              >
                <Upload size={64} className="mx-auto mb-4 text-gray-500" />
                <h3 className="text-xl font-semibold text-gray-200 mb-2">
                  Drag and drop files here
                </h3>
                <p className="text-gray-400 mb-4">
                  or click to browse
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  onChange={handleFileInput}
                  className="hidden"
                  accept=".pdf,.doc,.docx,.txt"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="bg-green-600 hover:bg-green-700 text-white rounded-lg px-6 py-3 font-semibold transition-colors"
                >
                  Select Files
                </button>
                <p className="text-gray-500 text-sm mt-4">
                  Supported formats: PDF, DOC, DOCX, TXT
                </p>
              </div>

              {uploadedFiles.length > 0 && (
                <div className="mt-8">
                  <h3 className="text-xl font-bold text-gray-200 mb-4">Selected File</h3>
                  <div className="space-y-3">
                    {uploadedFiles.map(file => (
                      <div key={file.id} className="bg-gray-800 border border-gray-700 rounded-lg p-4 flex items-center justify-between hover:border-green-400 transition-colors">
                        <div className="flex items-center gap-4 flex-1">
                          <File size={40} className="text-green-400" />
                          <div className="flex-1">
                            <h4 className="font-semibold text-gray-200">{file.name}</h4>
                            <p className="text-gray-400 text-sm">
                              {formatFileSize(file.size)}
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={removeFile}
                          className="text-red-400 hover:text-red-300 transition-colors p-2"
                        >
                          <X size={20} />
                        </button>
                      </div>
                    ))}
                  </div>

                  <p className="mt-4 text-gray-500 text-sm">Title, date, grid, casualty, and injury will be extracted automatically from the document.</p>

                  <div className="mt-6 flex gap-3">
                    <button
                      onClick={handleUploadSubmit}
                      disabled={uploading}
                      className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-green-800 text-white rounded-lg px-6 py-3 font-semibold transition-colors"
                    >
                      {uploading ? 'Uploading...' : 'Upload Report'}
                    </button>
                    <button
                      onClick={removeFile}
                      className="bg-gray-700 hover:bg-gray-600 text-gray-100 rounded-lg px-6 py-3 font-semibold transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'map' && (
          <div className="h-full p-6">
            <div className="bg-gray-800 border border-gray-700 rounded-lg h-full flex flex-col">
              <div className="bg-gray-900 border-b border-gray-700 p-4 rounded-t-lg">
                <h2 className="text-xl font-bold text-green-400 mb-2">Incident Locations</h2>
                <p className="text-gray-400 text-sm">Grafenwöhr Training Area, Germany</p>
              </div>

              <div className="flex-1 relative rounded-b-lg overflow-hidden">
                <div ref={mapRef} className="w-full h-full"></div>

                <div className="absolute left-4 top-4 bg-gray-900 border border-gray-700 rounded-lg p-4 w-80" style={{zIndex: 1001}}>
                  <h3 className="text-sm font-bold text-green-400 mb-3">Military Grid</h3>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={mgrsInput}
                      onChange={(e) => setMgrsInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleMgrsGo();
                        }
                      }}
                      className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-100 text-sm focus:outline-none focus:border-green-400"
                      placeholder="Enter MGRS (e.g., 32U ND 12345 67890)"
                    />
                    <button
                      onClick={handleMgrsGo}
                      className="bg-green-600 hover:bg-green-700 text-white rounded-lg px-3 py-2 text-sm font-semibold transition-colors"
                    >
                      Go
                    </button>
                  </div>
                  {mgrsError && (
                    <p className="text-xs text-red-400 mt-2">{mgrsError}</p>
                  )}
                  <div className="mt-3 text-xs text-gray-400 space-y-1">
                    <div className="flex items-center justify-between">
                      <span>Cursor</span>
                      <span className="text-gray-200">{cursorMgrs || '—'}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Selected</span>
                      <span className="text-gray-200">{selectedMgrs || '—'}</span>
                    </div>
                  </div>
                </div>

                <div className="absolute right-4 top-4 bg-gray-900 border border-gray-700 rounded-lg p-4 w-80 max-h-[70vh] overflow-y-auto" style={{zIndex: 1001}}>
                  {selectedMarkerInfo ? (
                    <>
                      <div className="flex justify-between items-start mb-3">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: selectedMarkerInfo.color }} />
                          <h3 className="text-sm font-bold text-gray-100 leading-tight">{selectedMarkerInfo.primaryName}</h3>
                        </div>
                        <button onClick={() => setSelectedMarkerInfo(null)} className="text-gray-500 hover:text-gray-200 text-lg leading-none ml-2 shrink-0">&times;</button>
                      </div>
                      <p className="text-xs text-gray-500 mb-3">{selectedMarkerInfo.docList.length} document{selectedMarkerInfo.docList.length !== 1 ? 's' : ''} reference this location</p>
                      <div className="space-y-3">
                        {selectedMarkerInfo.docList.map(({ report, locationNames, types }) => (
                          <div key={report._id} className="bg-gray-800 border border-gray-700 rounded-lg p-3">
                            <p className="font-semibold text-gray-100 text-sm leading-tight mb-1">{report.fileName || report.title}</p>
                            {report.documentId && (
                              <p className="font-mono text-xs text-green-400 mb-1">{report.documentId}</p>
                            )}
                            <div className="flex flex-wrap gap-1 mb-1">
                              {[...types].map(t => (
                                <span key={t} className={`text-xs px-1.5 py-0.5 rounded ${
                                  t === 'report'                         ? 'bg-blue-900 text-blue-300'
                                  : selectedMarkerInfo.isCountry         ? 'bg-purple-900 text-purple-300'
                                  : selectedMarkerInfo.isRegion          ? 'bg-pink-900 text-pink-300'
                                  :                                        'bg-yellow-900 text-yellow-300'
                                }`}>
                                  {t === 'report' ? 'Primary location'
                                    : selectedMarkerInfo.isCountry ? 'Country'
                                    : selectedMarkerInfo.isRegion  ? 'Region'
                                    : 'Mentioned'}
                                </span>
                              ))}
                            </div>
                            {locationNames.length > 1 && (
                              <p className="text-xs text-gray-500 mt-1">Also: {locationNames.slice(1).join(', ')}</p>
                            )}
                            {report.date && <p className="text-xs text-gray-500 mt-1">Date: {new Date(report.date).toLocaleDateString()}</p>}
                            {report.casualty && <p className="text-xs text-gray-500">Casualty: {report.casualty}</p>}
                            {report.mgrsGrid && <p className="text-xs text-gray-600 mt-1 font-mono">Grid: {report.mgrsGrid}</p>}
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <>
                      <h3 className="text-sm font-bold text-green-400 mb-2">Location Details</h3>
                      <p className="text-xs text-gray-500">Click any marker on the map to see all documents that reference that location.</p>
                    </>
                  )}
                </div>

                <div className="absolute left-4 bottom-4 bg-gray-900 border border-gray-700 rounded-lg p-3" style={{zIndex: 1001}}>
                  <h4 className="text-sm font-bold text-green-400 mb-2">Legend</h4>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 rounded-full bg-blue-500"></div>
                      <span className="text-xs text-gray-300">Primary report location</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 rounded-full bg-yellow-400"></div>
                      <span className="text-xs text-gray-300">Specific location mentioned</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 rounded-full" style={{backgroundColor:'#8b5cf6'}}></div>
                      <span className="text-xs text-gray-300">Country mentioned</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 rounded-full" style={{backgroundColor:'#ec4899'}}></div>
                      <span className="text-xs text-gray-300">Region / state mentioned</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 rounded-full bg-green-500"></div>
                      <span className="text-xs text-gray-300">Primary + mentioned</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default MedicalAARSystem;
