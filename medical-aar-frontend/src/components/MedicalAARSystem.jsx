import React, { useState, useEffect, useRef } from 'react';
import { Send, FileText, Map, MessageSquare, Search, Download, Filter, Upload, File, X, LogOut } from 'lucide-react';

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
  const fileInputRef = useRef(null);

  const [reports, setReports] = useState([
    {
      id: 1,
      title: 'Operation IRON SHIELD - AAR',
      date: '2023-03-12',
      location: 'Grafenwöhr Training Area, Germany',
      type: 'After Action Report',
      casualty: 'CPL Maria L. Sanchez',
      injury: 'Rib fractures with pulmonary contusion',
      status: 'Completed',
      fileName: 'iron_shield_aar.pdf'
    },
    {
      id: 2,
      title: 'Health Service Support Appendix',
      date: '2023-03-10',
      location: 'Grafenwöhr Training Area, Germany',
      type: 'Operations Order',
      casualty: 'N/A',
      injury: 'N/A',
      status: 'Active',
      fileName: 'health_support_appendix.pdf'
    }
  ]);

  const incidents = [
    {
      id: 1,
      lat: 49.6917,
      lng: 11.9428,
      title: 'CPL Sanchez Injury',
      date: '2023-03-10',
      type: 'Vehicle Rollover',
      severity: 'Moderate',
      description: 'Rib fractures with pulmonary contusion during convoy training'
    },
    {
      id: 2,
      lat: 49.6950,
      lng: 11.9500,
      title: 'Role 2 Medical Station',
      date: '2023-03-10',
      type: 'Medical Facility',
      severity: 'Info',
      description: 'Brigade Support Medical Company (BSMC)'
    },
    {
      id: 3,
      lat: 49.0134,
      lng: 12.0991,
      title: 'University Hospital Regensburg',
      date: '2023-03-10',
      type: 'Receiving Hospital',
      severity: 'Info',
      description: 'Primary host-nation trauma center'
    }
  ];

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

  const initializeMap = () => {
    if (window.L && mapRef.current && !mapInstanceRef.current) {
      const map = window.L.map(mapRef.current).setView([49.6917, 11.9428], 11);

      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19
      }).addTo(map);

      const createCustomIcon = (color) => {
        return window.L.divIcon({
          className: 'custom-marker',
          html: `<div style="background-color: ${color}; width: 30px; height: 30px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.3);"></div>`,
          iconSize: [30, 30],
          iconAnchor: [15, 15]
        });
      };

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

        const marker = window.L.marker([incident.lat, incident.lng], {
          icon: createCustomIcon(markerColor)
        }).addTo(map);

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

      setTimeout(() => {
        map.invalidateSize();
      }, 100);
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
    const newFiles = Array.from(files).map(file => ({
      id: Date.now() + Math.random(),
      name: file.name,
      size: file.size,
      type: file.type,
      uploadDate: new Date().toISOString()
    }));
    setUploadedFiles([...uploadedFiles, ...newFiles]);
  };

  const removeFile = (fileId) => {
    setUploadedFiles(uploadedFiles.filter(file => file.id !== fileId));
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const filteredReports = reports.filter(report =>
    report.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    report.location.toLowerCase().includes(searchTerm.toLowerCase()) ||
    report.casualty.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="h-screen bg-gray-900 text-gray-100 flex flex-col">
      <div className="bg-gray-800 border-b border-gray-700 p-4 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-green-400">Military Medical AAR System</h1>
          <p className="text-sm text-gray-400">Operation IRON SHIELD - Health Service Support</p>
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
              {filteredReports.map(report => (
                <div key={report.id} className="bg-gray-800 border border-gray-700 rounded-lg p-6 hover:border-green-400 transition-colors">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="text-xl font-bold text-green-400 mb-2">{report.title}</h3>
                      <p className="text-gray-400 text-sm">{report.location}</p>
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
                      <p className="text-gray-200">{report.date}</p>
                    </div>
                    <div>
                      <p className="text-gray-500 text-sm">Type</p>
                      <p className="text-gray-200">{report.type}</p>
                    </div>
                    <div>
                      <p className="text-gray-500 text-sm">Casualty</p>
                      <p className="text-gray-200">{report.casualty}</p>
                    </div>
                    <div>
                      <p className="text-gray-500 text-sm">Injury Type</p>
                      <p className="text-gray-200">{report.injury}</p>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button className="flex-1 bg-green-600 hover:bg-green-700 text-white rounded-lg px-4 py-2 font-semibold transition-colors">
                      View Full Report
                    </button>
                    <button className="bg-gray-700 hover:bg-gray-600 text-gray-100 rounded-lg px-4 py-2 flex items-center gap-2 transition-colors">
                      <Download size={18} />
                      Download
                    </button>
                  </div>
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
                  <h3 className="text-xl font-bold text-gray-200 mb-4">Uploaded Files ({uploadedFiles.length})</h3>
                  <div className="space-y-3">
                    {uploadedFiles.map(file => (
                      <div key={file.id} className="bg-gray-800 border border-gray-700 rounded-lg p-4 flex items-center justify-between hover:border-green-400 transition-colors">
                        <div className="flex items-center gap-4 flex-1">
                          <File size={40} className="text-green-400" />
                          <div className="flex-1">
                            <h4 className="font-semibold text-gray-200">{file.name}</h4>
                            <p className="text-gray-400 text-sm">
                              {formatFileSize(file.size)} • Uploaded {new Date(file.uploadDate).toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => removeFile(file.id)}
                          className="text-red-400 hover:text-red-300 transition-colors p-2"
                        >
                          <X size={20} />
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="mt-6 flex gap-3">
                    <button className="flex-1 bg-green-600 hover:bg-green-700 text-white rounded-lg px-6 py-3 font-semibold transition-colors">
                      Process & Add to Repository
                    </button>
                    <button 
                      onClick={() => setUploadedFiles([])}
                      className="bg-gray-700 hover:bg-gray-600 text-gray-100 rounded-lg px-6 py-3 font-semibold transition-colors"
                    >
                      Clear All
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

                <div className="absolute right-4 top-4 bg-gray-900 border border-gray-700 rounded-lg p-4 w-80 max-h-96 overflow-y-auto">
                  <h3 className="text-lg font-bold text-green-400 mb-4">Incidents</h3>
                  {incidents.map(incident => (
                    <div key={incident.id} className="bg-gray-800 border border-gray-700 rounded-lg p-3 mb-3 hover:border-green-400 transition-colors cursor-pointer">
                      <div className="flex justify-between items-start mb-2">
                        <h4 className="font-semibold text-gray-100">{incident.title}</h4>
                        <span className={`px-2 py-1 rounded text-xs font-semibold ${
                          incident.severity === 'Moderate' ? 'bg-yellow-900 text-yellow-300' : 
                          incident.severity === 'Severe' ? 'bg-red-900 text-red-300' :
                          'bg-green-900 text-green-300'
                        }`}>
                          {incident.severity}
                        </span>
                      </div>
                      <p className="text-gray-400 text-sm">{incident.type}</p>
                      <p className="text-gray-500 text-xs mt-1">{incident.date}</p>
                      <p className="text-gray-400 text-xs mt-2">{incident.description}</p>
                    </div>
                  ))}
                </div>

                <div className="absolute left-4 bottom-4 bg-gray-900 border border-gray-700 rounded-lg p-3">
                  <h4 className="text-sm font-bold text-green-400 mb-2">Legend</h4>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 rounded-full bg-red-500"></div>
                      <span className="text-xs text-gray-300">Severe Incident</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 rounded-full bg-yellow-500"></div>
                      <span className="text-xs text-gray-300">Moderate Incident</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 rounded-full bg-green-500"></div>
                      <span className="text-xs text-gray-300">Medical Facility</span>
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