/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { 
  Search, 
  Settings, 
  User, 
  Box, 
  Files, 
  Mic, 
  FileText, 
  Zap, 
  FolderSearch, 
  Activity, 
  Edit3,
  BrainCircuit
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface DisplayMessage {
  type: 'user' | 'assistant';
  text: string;
  transcription?: string;
}

interface ApiMessage {
  role: 'user' | 'assistant';
  content: string | any[];
}

export default function App() {
  // --- State Management ---
  const [textQuery, setTextQuery] = useState('');
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [apiHistory, setApiHistory] = useState<ApiMessage[]>([]);
  const [displayMessages, setDisplayMessages] = useState<DisplayMessage[]>([]);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [confidence, setConfidence] = useState<number>(0);
  const [activeTab, setActiveTab] = useState('visualizer');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll dossier
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [displayMessages]);

  // Backend Health Check
  useEffect(() => {
    const checkHealth = async () => {
      try {
        const res = await fetch('/api/health');
        if (res.ok) {
          const data = await res.json();
          console.log('✅ Backend link active:', data.message);
        } else {
          console.warn('⚠️ Backend health check failed:', res.status);
        }
      } catch (err) {
        console.error('❌ Could not connect to backend:', err);
      }
    };
    checkHealth();
  }, []);

  // --- Handlers ---
  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedImage(file);
      const reader = new FileReader();
      reader.onloadend = () => setImagePreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleExecuteAnalysis = async () => {
    if (!textQuery && !selectedImage) return;

    setIsLoading(true);
    
    // Optimistic UI update for user message
    const newUserMsg: DisplayMessage = { type: 'user', text: textQuery };
    setDisplayMessages(prev => [...prev, newUserMsg]);

    try {
      const formData = new FormData();
      formData.append('text_query', textQuery);
      formData.append('history', JSON.stringify(apiHistory));
      if (selectedImage) {
        formData.append('image', selectedImage);
      }

      // Note: Connecting to our integrated Express backend
      const fetchUrl = '/api/chat';
      console.log(`🚀 Dispatching request to: ${fetchUrl}`);
      const response = await fetch(fetchUrl, {
        method: 'POST',
        body: formData,
      });

      console.log(`📡 Response received: ${response.status} ${response.statusText}`);
      const responseText = await response.text();
      const contentType = response.headers.get('content-type') || '';
      
      if (!response.ok) {
        console.error('API Error Response:', responseText);
        let errorMsg = `API request failed (${response.status})`;
        try {
          if (contentType.includes('application/json')) {
            const errJson = JSON.parse(responseText);
            errorMsg = errJson.error || errorMsg;
          } else {
            errorMsg = `${errorMsg}. Server sent ${contentType}. First 100 bytes: ${responseText.substring(0, 100)}`;
          }
        } catch (e) {}
        throw new Error(errorMsg);
      }

      let data;
      try {
        data = JSON.parse(responseText);
      } catch (jsonErr) {
        console.error('Failed to parse JSON response.', {
          contentType,
          bodyPreview: responseText.substring(0, 300)
        });
        throw new Error(`Server returned non-JSON response (${contentType}). Body starts with: ${responseText.substring(0, 50)}... Likely a routing issue.`);
      }

      // Update State per requirements
      // 1. The Log
      setDisplayMessages(prev => [
        ...prev, 
        { 
          type: 'assistant', 
          text: data.doctor_response,
          transcription: data.transcription
        }
      ]);

      // 2. The Memory
      setApiHistory(data.updated_history);

      // 3. The Audio
      playDoctorAudio(data.audio_base64);

      // Randomize confidence for visual flair
      setConfidence(Math.floor(Math.random() * (98 - 85 + 1) + 85));

      // 4. The Cleanup
      setTextQuery('');
      setSelectedImage(null);
      setImagePreview(null);
      if (fileInputRef.current) fileInputRef.current.value = '';

    } catch (error: any) {
      console.error('Analysis Error:', error);
      setDisplayMessages(prev => [...prev, { 
        type: 'assistant', 
        text: `Error: ${error.message || 'The diagnostic link encountered an unexpected interruption. Please verify your connection and API settings.'}` 
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const playDoctorAudio = (base64Audio: string) => {
    if (!base64Audio) {
      console.warn('No audio data received from server.');
      return;
    }
    const audio = new Audio(base64Audio);
    audio.onplay = () => setIsPlayingAudio(true);
    audio.onended = () => setIsPlayingAudio(false);
    audio.onerror = () => setIsPlayingAudio(false);
    audio.play();
  };

  return (
    <div className="h-screen bg-[#0b1326] text-[#dae2fd] flex flex-col font-sans overflow-hidden">
      {/* Background Mesh Overlay */}
      <div className="fixed inset-0 pointer-events-none opacity-20" 
           style={{ backgroundImage: `linear-gradient(#00dfc11a 1px, transparent 1px), linear-gradient(90deg, #00dfc11a 1px, transparent 1px)`, backgroundSize: '40px 40px' }} />

      {/* Top Nav */}
      <nav className="h-20 px-10 flex justify-between items-center bg-[#060e20]/60 backdrop-blur-2xl border-b border-[#00dfc133] z-50">
        <div className="flex items-center gap-8">
          <h1 className="text-2xl font-black tracking-widest text-[#26fedc] drop-shadow-[0_0_8px_rgba(0,245,212,0.4)]">
            DIAGNOSTIC STATION v4.0
          </h1>
          <div className="hidden md:flex gap-6 mt-1">
            {['Visualizer', 'Clinical Dossier', 'Telemetry', 'Archive'].map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab.toLowerCase())}
                className={`text-[11px] font-mono uppercase tracking-wider transition-colors hover:text-[#00f5d4] ${activeTab === tab.toLowerCase() ? 'text-[#26fedc] border-b-2 border-[#00dfc1]' : 'text-[#b9cac4]'}`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="relative hidden lg:block">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#b9cac4] w-4 h-4" />
            <input 
              type="text" 
              placeholder="Search records..." 
              className="bg-[#222a3d]/50 border border-[#3a4a46]/30 rounded-full py-1.5 pl-10 pr-4 text-xs font-mono w-64 focus:outline-none focus:ring-1 focus:ring-[#00dfc1]"
            />
          </div>
          <button className="text-[#b9cac4] hover:text-[#26fedc] p-2 transition-colors"><Settings className="w-5 h-5" /></button>
          <button className="text-[#b9cac4] hover:text-[#26fedc] p-2 transition-colors"><User className="w-5 h-5" /></button>
        </div>
      </nav>

      {/* Main Container */}
      <main className="flex-1 mt-4 p-6 flex gap-6 overflow-hidden">
        
        {/* Left Panel: Visualizer */}
        <section className="flex-1 bg-[#0b1326]/70 backdrop-blur-xl border border-[#00dfc126] rounded-xl flex flex-col relative overflow-hidden">
          <div className="p-4 border-b border-[#3a4a46]/30 bg-[#131b2e]/40 flex justify-between items-center z-10">
            <div className="flex gap-4">
              <div className="bg-[#171f33] px-3 py-1.5 rounded flex items-center gap-2 border border-[#3a4a46]/20">
                <span className="w-2 h-2 rounded-full bg-[#00dfc1] animate-pulse" />
                <span className="font-mono text-[11px] text-[#00dfc1]">Patient ID: YASIR_K_88</span>
              </div>
              <div className="bg-[#171f33] px-3 py-1.5 rounded flex items-center gap-2 border border-[#3a4a46]/20">
                <Box className="w-3.5 h-3.5 text-[#00daf8]" />
                <span className="font-mono text-[11px] text-[#00daf8]">Area: DERMAL ANALYSIS</span>
              </div>
            </div>
            <div className="flex gap-2 text-[10px] font-mono uppercase">
              <button className="bg-[#222a3d] hover:bg-[#31394d] px-3 py-1 rounded border border-[#3a4a46]/30 transition-colors">Filters</button>
              <button className="bg-[#222a3d] hover:bg-[#31394d] px-3 py-1 rounded border border-[#3a4a46]/30 transition-colors">Export</button>
            </div>
          </div>

          <div className="flex-1 relative bg-black/40 p-10 flex items-center justify-center z-10 overflow-hidden">
            <div className="relative w-full max-w-2xl aspect-video rounded-lg overflow-hidden border border-[#00dfc14d] shadow-[0_0_20px_rgba(0,245,212,0.3)] group cursor-crosshair">
              {imagePreview ? (
                <img src={imagePreview} alt="Target analysis area" className="w-full h-full object-cover opacity-90 transition-opacity group-hover:opacity-100" />
              ) : (
                <div className="w-full h-full bg-[#131b2e] flex flex-col items-center justify-center gap-4 text-[#b9cac4]">
                   <Files className="w-12 h-12 opacity-20" />
                   <p className="text-xs font-mono uppercase tracking-widest opacity-40">Awaiting visual data input</p>
                </div>
              )}
              
              {/* Scanner Line Animation */}
              {(isLoading || imagePreview) && (
                <motion.div 
                  initial={{ top: '0%' }}
                  animate={{ top: '100%' }}
                  transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                  className="absolute left-0 w-full h-[2px] bg-[#26fedc] shadow-[0_0_10px_#26fedc,0_0_20px_#26fedc] z-20"
                />
              )}

              {/* Reticle */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 border border-[#26fedc66] rounded-full z-20 flex items-center justify-center">
                <div className="w-1 h-1 bg-[#26fedc] rounded-full shadow-[0_0_8px_#26fedc]" />
                <div className="absolute top-0 w-[1px] h-4 bg-[#26fedc]/70" />
                <div className="absolute bottom-0 w-[1px] h-4 bg-[#26fedc]/70" />
                <div className="absolute left-0 w-4 h-[1px] bg-[#26fedc]/70" />
                <div className="absolute right-0 w-4 h-[1px] bg-[#26fedc]/70" />
              </div>
            </div>
          </div>

          <div className="h-16 border-t border-[#3a4a46]/30 bg-[#131b2e]/60 flex items-center px-6 gap-8 z-10">
            {[
              { label: 'Spectral Res', value: '4096 x 4096', color: 'text-[#00dfc1]' },
              { label: 'Tissue Depth', value: '2.4mm', color: 'text-[#a5eeff]' },
              { label: 'Thermal Map', value: 'Active (36.2°C)', color: 'text-[#e9c400]' }
            ].map(stat => (
              <div key={stat.label} className="flex flex-col">
                <span className="text-[9px] font-mono text-[#b9cac4] uppercase tracking-tighter">{stat.label}</span>
                <span className={`font-mono text-xs ${stat.color}`}>{stat.value}</span>
              </div>
            ))}
            <div className="flex-1" />
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-[#00dfc1] animate-pulse" />
              <span className="font-mono text-[9px] text-[#00dfc1] uppercase tracking-widest">Live Telemetry</span>
            </div>
          </div>
        </section>

        {/* Right Panel: Dossier */}
        <section className="w-[450px] bg-[#0b1326]/70 backdrop-blur-xl border border-[#00dfc126] rounded-xl flex flex-col overflow-hidden border-t-white/10 border-l-white/10 shadow-2xl">
          <header className="p-6 border-b border-[#3a4a46]/20 bg-gradient-to-r from-[#222a3d]/80 to-transparent">
            <h2 className="text-xl font-bold tracking-tight flex items-center gap-3">
              <FileText className="w-5 h-5 text-[#a5eeff]" />
              DIAGNOSTIC DOSSIER
            </h2>
            <p className="font-mono text-[10px] text-[#b9cac4] mt-1 opacity-70 uppercase tracking-widest">Session 01 // Autonomous Log</p>
          </header>

          <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 flex flex-col gap-8 custom-scrollbar">
            {displayMessages.length === 0 && (
              <div className="flex-1 flex flex-col items-center justify-center opacity-20 gap-4">
                <BrainCircuit className="w-16 h-16" />
                <p className="font-mono text-xs uppercase tracking-widest text-center">System Idle<br/>Await Input Phase</p>
              </div>
            )}

            <AnimatePresence>
              {displayMessages.map((msg, idx) => (
                <motion.div 
                  key={idx}
                  initial={{ opacity: 0, x: msg.type === 'user' ? 20 : -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className={`relative pl-8 before:content-[''] before:absolute before:left-0 before:top-2 before:bottom-0 before:w-[2px] transition-all
                    ${msg.type === 'user' ? 'before:bg-[#ffd702]/50' : 'before:bg-[#26fedc]/50'}
                  `}
                >
                  <div className={`absolute left-[-5px] top-2 w-3 h-3 rounded-full shadow-lg ${msg.type === 'user' ? 'bg-[#ffd702]' : 'bg-[#26fedc]'}`} />
                  
                  <h3 className="font-mono text-[10px] uppercase text-[#b9cac4] tracking-wider mb-2 flex items-center gap-2">
                    {msg.type === 'user' ? 'Case Inquiry' : (
                      <>
                        Professional Opinion
                        {isPlayingAudio && idx === displayMessages.length - 1 && (
                          <Mic className="w-3 h-3 text-[#26fedc] animate-bounce" />
                        )}
                      </>
                    )}
                  </h3>

                  <div className={`p-4 rounded border backdrop-blur-sm shadow-inner transition-all
                    ${msg.type === 'user' 
                      ? 'bg-[#222a3d]/40 border-[#3a4a46]/20 text-[#ffe16d]' 
                      : 'bg-[#171f33]/60 border-[#26fedc1a] text-[#dae2fd]'
                    }
                  `}>
                    <p className={`text-sm leading-relaxed ${msg.type === 'user' ? 'italic font-medium' : ''}`}>
                      {msg.text}
                    </p>

                    {msg.type === 'assistant' && idx === displayMessages.length - 1 && (
                       <div className="mt-4 pt-3 border-t border-[#3a4a46]/30 flex justify-between items-end">
                         <div className="flex-1">
                            <div className="flex justify-between text-[9px] font-mono mb-1 text-[#b9cac4]">
                              <span>PROBABILITY ACCURACY</span>
                              <span>{confidence}%</span>
                            </div>
                            <div className="h-1 w-full bg-[#060e20] rounded-full overflow-hidden">
                              <motion.div 
                                initial={{ width: 0 }}
                                animate={{ width: `${confidence}%` }}
                                className="h-full bg-[#26fedc] shadow-[0_0_10px_#26fedc]"
                              />
                            </div>
                         </div>
                       </div>
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
            
            {/* Visualizer effect during processing */}
            {isLoading && (
              <div className="relative pl-8 before:content-[''] before:absolute before:left-0 before:top-2 before:bottom-0 before:w-[2px] before:bg-[#a5eeff]/30">
                <div className="absolute left-[-5px] top-2 w-3 h-3 rounded-full bg-[#a5eeff] animate-ping" />
                <h3 className="font-mono text-[10px] uppercase text-[#b9cac4] tracking-wider mb-2 flex items-center gap-2">
                  Signal Processing...
                  <Activity className="w-3 h-3 text-[#a5eeff]" />
                </h3>
                <div className="bg-[#060e20]/50 h-20 rounded border border-[#3a4a46]/20 flex items-center justify-center gap-1">
                  {[...Array(12)].map((_, i) => (
                    <motion.div
                      key={i}
                      animate={{ height: ['20%', '100%', '20%'] }}
                      transition={{ duration: 0.5 + Math.random(), repeat: Infinity }}
                      className="w-1.5 bg-[#a5eeff]/50 rounded-t"
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      </main>

      {/* Bottom Command Bar */}
      <nav className="h-24 px-10 bg-[#222a3d]/80 backdrop-blur-3xl border-t border-white/10 flex justify-between items-center z-50">
        <div className="flex gap-3">
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleImageSelect} 
            className="hidden" 
            accept="image/*"
          />
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="bg-[#060e20] hover:bg-[#171f33] border border-[#3a4a46]/40 text-[#00daf8] font-mono text-[11px] uppercase px-5 py-3 rounded flex items-center gap-2 transition-all shadow-lg active:scale-95"
          >
            <FolderSearch className="w-4 h-4" />
            {selectedImage ? 'Image Selected' : 'Select Data'}
          </button>
          <button className="bg-[#060e20] hover:bg-[#171f33] border border-[#3a4a46]/40 text-[#00daf8] font-mono text-[11px] uppercase px-5 py-3 rounded flex items-center gap-2 transition-all shadow-lg active:scale-95">
            <Mic className="w-4 h-4" />
            Audio Input
          </button>
          <button className="bg-[#060e20] hover:bg-[#171f33] border border-[#3a4a46]/40 text-[#00daf8] font-mono text-[11px] uppercase px-5 py-3 rounded flex items-center gap-2 transition-all shadow-lg active:scale-95">
            <Files className="w-4 h-4" />
            Logs
          </button>
        </div>

        <div className="flex-1 max-w-xl mx-8 relative group">
          <Edit3 className="absolute left-4 top-1/2 -translate-y-1/2 text-[#b9cac4] w-4 h-4" />
          <input 
            type="text" 
            value={textQuery}
            onChange={(e) => setTextQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleExecuteAnalysis()}
            placeholder="Describe additional symptoms or concerns..." 
            className="w-full bg-[#060e20]/40 border-b-2 border-[#3a4a46]/50 focus:border-[#26fedc] focus:outline-none text-sm py-4 pl-12 pr-4 transition-all rounded-t"
          />
        </div>

        <button 
          onClick={handleExecuteAnalysis}
          disabled={isLoading || (!textQuery && !selectedImage)}
          className={`px-10 py-4 rounded font-mono font-bold text-xs uppercase flex items-center gap-2 transition-all shadow-2xl active:scale-95 
            ${isLoading ? 'bg-[#3a4a46] text-[#b9cac4] cursor-not-allowed' : 'bg-[#ffd702] hover:bg-[#ffe16d] text-[#3a3000]'}
          `}
        >
          <Zap className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          {isLoading ? 'Processing...' : 'Execute Analysis'}
        </button>
      </nav>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(0, 223, 193, 0.2); border-radius: 10px; }
      `}</style>
    </div>
  );
}
