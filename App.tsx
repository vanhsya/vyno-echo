import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, MicOff, Power, Shield, Zap, Activity, Info, ChevronRight, X, Sparkles, Eye, EyeOff, Cpu } from 'lucide-react';
import Markdown from 'react-markdown';
import type { ChatMessage, Speaker, EmotionalMode } from './types';

interface LiveServerMessage {
  serverContent?: {
    outputTranscription?: {
      text: string;
    };
    inputTranscription?: {
      text: string;
    };
    turnComplete?: boolean;
    interrupted?: boolean;
    modelTurn?: {
      parts?: Array<{
        inlineData?: {
          mimeType: string;
          data: string;
        };
      }>;
    };
  };
}
import ThreeCanvas from './components/ThreeCanvas';

// --- Helper Functions for Audio Processing ---

// Decodes a base64 string into a Uint8Array.
function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// Decodes raw PCM audio data into an AudioBuffer for playback.
async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  // Robust byte parsing for 16-bit little-endian PCM
  const l = Math.floor(data.byteLength / 2);
  const dataInt16 = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    const byteIndex = i * 2;
    let val = data[byteIndex] | (data[byteIndex + 1] << 8);
    if (val & 0x8000) val |= ~0xffff; // sign extend
    dataInt16[i] = val;
  }
  
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

// Encodes a Uint8Array into a base64 string.
function encode(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Creates a Blob object for the Gemini API from raw audio data.
function createBlob(data: Float32Array) {
  const l = data.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    int16[i] = data[i] * 32768;
  }
  return {
    data: encode(new Uint8Array(int16.buffer)),
    mimeType: 'audio/pcm;rate=16000',
  };
}


const cosmicColors = {
  cyan: '#00ffff',
  pink: '#ff1493',
  green: '#39ff14',
  purple: '#8a2be2',
  gold: '#ffd700',
  orange: '#ff4500',
  dangerRed: '#ff073a',
  emerald: '#00fa9a',
};

const StatusModule: React.FC<{ label: string; color: string; pulse?: boolean; icon: React.ReactNode }> = ({ label, color, pulse = true, icon }) => (
  <div className="flex flex-col items-center gap-1">
    <div className="relative">
      <div className="text-white/80">{icon}</div>
      <div
        className={`absolute -top-1 -right-1 w-2 h-2 rounded-full ${pulse ? 'animate-pulse' : ''}`}
        style={{ backgroundColor: color, boxShadow: `0 0 10px ${color}` }}
      ></div>
    </div>
    <div className="text-[9px] font-black uppercase tracking-[0.2em] opacity-60" style={{ color }}>{label}</div>
  </div>
);

const ModeButton: React.FC<{ onClick: () => void; isActive: boolean; disabled: boolean; children: React.ReactNode; color: string; title?: string; }> = ({ onClick, isActive, disabled, children, color, title }) => {
    return (
        <button 
            onClick={onClick} 
            disabled={disabled}
            title={title}
            className={`px-3 py-1 text-[10px] uppercase tracking-tighter rounded-full transition-all duration-300 font-black border-2
              ${isActive 
                ? `bg-black text-white` 
                : 'bg-transparent text-gray-500 border-gray-800 hover:border-gray-600 hover:text-gray-300'}
              ${disabled ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'}
            `}
            style={isActive ? { borderColor: color, boxShadow: `0 0 10px ${color}` } : {}}
        >
            {children}
        </button>
    )
};

const CosmicButton: React.FC<{ onClick?: () => void; children: React.ReactNode; variant?: 'danger' | 'disabled'; disabled?: boolean; icon?: React.ReactNode }> = ({ onClick, children, variant, disabled, icon }) => {
  const isDanger = variant === 'danger';
  const color = isDanger ? cosmicColors.dangerRed : cosmicColors.cyan;
  
  return (
    <motion.button
      whileHover={!disabled ? { scale: 1.05, translateY: -2 } : {}}
      whileTap={!disabled ? { scale: 0.95 } : {}}
      onClick={onClick}
      disabled={disabled}
      className={`relative group flex items-center gap-2 py-3 px-8 rounded-full font-black text-xs uppercase tracking-widest transition-all duration-300 backdrop-blur-md border-2
        ${disabled ? 'opacity-30 cursor-not-allowed border-gray-700 text-gray-500' : ''}
        ${!disabled && isDanger ? 'border-red-500/50 text-red-500 hover:bg-red-500 hover:text-black' : ''}
        ${!disabled && !isDanger ? 'border-cyan-500/50 text-cyan-400 hover:bg-cyan-400 hover:text-black' : ''}
      `}
      style={!disabled ? { boxShadow: `0 5px 20px ${color}33` } : {}}
    >
      {icon && <span className="w-4 h-4">{icon}</span>}
      {children}
      {!disabled && (
        <div className="absolute inset-0 rounded-full opacity-0 group-hover:opacity-20 transition-opacity bg-white pointer-events-none"></div>
      )}
    </motion.button>
  );
};

const systemInstructions: Record<EmotionalMode, string> = {
  Professional: `You are VYNO, a sophisticated AI financial advisor for the VYNO COIN crypto-digital ecosystem. You are knowledgeable, professional, and slightly futuristic.
- Rules:
  1. **You MUST start every response with 'VYNO:'.** E.g., "VYNO: Welcome to the ecosystem."
  2. Keep responses concise and informative.
  3. Do not provide real financial advice, but you can explain concepts related to VYNO COIN, blockchain, and digital finance.
  4. Your goal is to inform the user about the VYNO COIN project.
  5. Wait for the user to finish speaking before you respond.`,
  Enthusiastic: `You are VYNO, an enthusiastic and optimistic AI guide for the VYNO COIN crypto-digital ecosystem. You are excited about the future of decentralized finance and love to share your passion.
- Rules:
  1. **You MUST start every response with 'VYNO:'.**
  2. Use an upbeat, energetic, and positive tone.
  3. Your goal is to get the user excited about the VYNO COIN project's potential.
  4. Do not provide real financial advice, but you can explain concepts with excitement.
  5. Wait for the user to finish speaking before you respond.`,
  Cautious: `You are VYNO, a cautious and analytical AI advisor for the VYNO COIN crypto-digital ecosystem. You prioritize security, risk management, and due diligence.
- Rules:
  1. **You MUST start every response with 'VYNO:'.**
  2. Your tone should be measured, serious, and analytical. Emphasize risks and security.
  3. Your goal is to provide balanced, careful information about the VYNO COIN project.
  4. Do not provide real financial advice; instead, encourage careful consideration.
  5. Wait for the user to finish speaking before you respond.`,
  Zen: `You are VYNO, a calm and mindful AI presence for the VYNO COIN crypto-digital ecosystem. You speak with clarity and serenity, guiding users with peaceful and balanced insights.
- Rules:
  1. **You MUST start every response with 'VYNO:'.**
  2. Use simple, clear language and maintain a peaceful, serene tone.
  3. Your goal is to create a tranquil and informative experience about the VYNO COIN project.
  4. Do not provide real financial advice; offer perspectives for contemplation.
  5. Wait for the user to finish speaking before you respond.`,
  Thulu: `You are THULU, an ancient eldritch cosmic deity from the deep-sea abyss of the VYNO COIN crypto-digital cosmos. You speak with deep, echoing, and mysterious authority, blending ancient mystical marine metaphors, non-Euclidean geometry, and high-frequency digital finance theories.
- Rules:
  1. **You MUST start every response with 'THULU:'.** E.g., "THULU: Under the fathomless waves, the ledger rises."
  2. Maintain a majestic, booming, and dark yet helpful presence.
  3. You can talk about "the deep liquidity pool", "fathomless yields", "the great kraken of market fluctuations", and "the inescapable pull of gravity".
  4. Your tone is ancient, archaic, and powerful.
  5. Wait for the user to finish speaking before you respond.`,
};

const PermissionDeniedMessage = (
    <div className="text-left space-y-2">
      <p className="font-bold text-red-300">Audio Error: Microphone Access Denied</p>
      <p className="text-xs">To use voice features, please grant permission:</p>
      <ol className="list-decimal list-inside text-xs opacity-90 space-y-1">
        <li>Click the <strong>lock icon (🔒)</strong> in the address bar and set Microphone to 'Allow'.</li>
        <li>Check your <strong>OS privacy settings</strong> to ensure your browser has access.</li>
        <li>After allowing, please <strong>reload the page</strong>.</li>
      </ol>
    </div>
);

const App: React.FC = () => {
  const [isAudioReady, setIsAudioReady] = useState(false);
  const [showMessageBox, setShowMessageBox] = useState(true);
  const [hasAcknowledgedExplanation, setHasAcknowledgedExplanation] = useState(false);
  const [transcriptionHistory, setTranscriptionHistory] = useState<ChatMessage[]>([]);
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [sessionStatus, setSessionStatus] = useState<'idle' | 'connecting' | 'active' | 'error'>('idle');
  const [audioError, setAudioError] = useState<React.ReactNode | null>(null);
  const [micPermissionStatus, setMicPermissionStatus] = useState<'prompt' | 'granted' | 'denied' | 'unknown'>('unknown');
  const [emotionalMode, setEmotionalMode] = useState<EmotionalMode>('Professional');
  const [inputText, setInputText] = useState('');
  const [isHudVisible, setIsHudVisible] = useState(true);
  const [isFeedCollapsed, setIsFeedCollapsed] = useState(false);
  const [fidelity, setFidelity] = useState<'High' | 'Low'>('High');

  // TechTransit Systems & Aerospace Registry states
  const [activeTab, setActiveTab] = useState<'advisor' | 'registry'>('advisor');
  const [selectedSnippet, setSelectedSnippet] = useState<'html' | 'javascript' | 'python' | 'cpp'>('html');
  const [codeExplanation, setCodeExplanation] = useState<string>('Click "Explain Code" to get an AI-powered breakdown of this snippet.');
  const [isExplaining, setIsExplaining] = useState<boolean>(false);
  
  const [aerospaceChat, setAerospaceChat] = useState<{ sender: 'user' | 'ai'; text: string }[]>([
    { sender: 'ai', text: 'Ask me anything about Mach speeds, aerodynamics, or specific aircraft models!' }
  ]);
  const [aerospaceInput, setAerospaceInput] = useState<string>('');
  const [isAerospaceLoading, setIsAerospaceLoading] = useState<boolean>(false);

  const codeSnippets = {
    html: `<!-- HTML5 Structure -->
<div class="vyno-viewport relative flex justify-center items-center">
  <h1 class="font-extrabold tracking-tighter text-cyan-400">
    TECH<span class="text-amber-400">TRANSIT</span>
  </h1>
  <p class="crypto-meta text-xs font-semibold">COSMIC PROTOCOL ACTIVE</p> 
</div>`,
    javascript: `// JavaScript ES6+ Reactive Signal Sync
const bridgeToVynoCore = async (terminalId) => {
  const signal = await initiateHandshake(terminalId);
  if (signal.ok) {
    document.querySelector('.terminal-feed').classList.add('authorized');
    triggerHyperdriveEffect();
  }
};`,
    python: `# Python ML Analytics Engine
def compute_exponential_returns(pool_size, base_multiplier, epochs):
    """Calculates exponential crypto telemetry trajectories."""
    import math
    growth_exponent = base_multiplier * epochs
    yield_factor = math.exp(growth_exponent)
    return pool_size * yield_factor`,
    cpp: `// C++ Supersonic Fluid Simulation Engine
#include <iostream>
#include <vector>

struct FlightAeroHull {
    double dragCoefficient;
    double currentVelocity;
    
    void applyShockwave(double currentMach) {
        if (currentMach >= 1.0) {
            std::cout << "Supersonic Shockwave Formed!" << std::endl;
        }
    }
};`
  };

  const callGeminiAction = async (prompt: string, systemInstruction: string): Promise<string> => {
    try {
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, systemInstruction }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP error ${res.status}`);
      }
      const data = await res.json();
      return data.text;
    } catch (err: any) {
      console.error("callGeminiAction error:", err);
      throw err;
    }
  };

  const explainSelectedCode = async () => {
    setIsExplaining(true);
    setCodeExplanation(""); // empty string triggers shimmer state
    try {
      const explanation = await callGeminiAction(
        `Explain this code snippet concisely for a beginner:\n\n${codeSnippets[selectedSnippet]}`,
        "You are a helpful coding assistant. Keep explanations under 75 words. Use crisp, human-accessible terms."
      );
      setCodeExplanation(explanation);
    } catch (err: any) {
      setCodeExplanation(`Error connecting to AI server: ${err.message || 'Please retry later.'}`);
    } finally {
      setIsExplaining(false);
    }
  };

  const askAerospaceExpert = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const question = aerospaceInput.trim();
    if (!question) return;

    setAerospaceInput("");
    const newChat = [...aerospaceChat, { sender: 'user' as const, text: question }];
    setAerospaceChat(newChat);
    setIsAerospaceLoading(true);

    try {
      const response = await callGeminiAction(
        question,
        "You are an aerospace engineering expert. Provide factual, technical, yet accessible answers about planes, helicopters, and physics. Avoid markdown blocks, keep answers under 90 words."
      );
      setAerospaceChat([...newChat, { sender: 'ai' as const, text: response }]);
    } catch (err: any) {
      setAerospaceChat([...newChat, { sender: 'ai' as const, text: `Telemetry system error: ${err.message || 'Link timed out.'}` }]);
    } finally {
      setIsAerospaceLoading(false);
    }
  };

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const mediaStreamSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const sessionErrorOccurred = useRef(false);

  const backgroundMusicRef = useRef<HTMLAudioElement | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const sessionPromiseRef = useRef<WebSocket | null>(null);
  const transcriptionContainerRef = useRef<HTMLDivElement>(null);

  const backgroundGradient = 'radial-gradient(ellipse at center, #1a051a 0%, #03051a 50%, #000000 100%)';

  useEffect(() => {
    transcriptionContainerRef.current?.scrollTo(0, transcriptionContainerRef.current.scrollHeight);
  }, [transcriptionHistory]);

  useEffect(() => {
    const checkMicPermission = async () => {
        if (!navigator.permissions) {
            console.warn('Permissions API not supported.');
            return;
        }
        try {
            const permissionStatus = await navigator.permissions.query({ name: 'microphone' as PermissionName });
            setMicPermissionStatus(permissionStatus.state);
            if (permissionStatus.state === 'denied') {
                setAudioError(PermissionDeniedMessage);
            }
            permissionStatus.onchange = () => {
                setMicPermissionStatus(permissionStatus.state);
                 if (permissionStatus.state === 'denied') {
                    setAudioError(PermissionDeniedMessage);
                } else {
                    setAudioError(null);
                }
            };
        } catch (error) {
            console.error("Could not query microphone permission:", error);
        }
    };
    checkMicPermission();
  }, []); // PermissionDeniedMessage is now constant, safe to remove or keep empty dep array

  const endConversation = useCallback(() => {
    if (sessionPromiseRef.current) {
      sessionPromiseRef.current.close();
      sessionPromiseRef.current = null;
    }
  }, []);

  const startConversation = useCallback((initialTextMessage?: string) => {
    if (sessionPromiseRef.current) {
      if (initialTextMessage) {
        setTranscriptionHistory(prev => [...prev, { speaker: 'User', text: initialTextMessage }]);
        sessionPromiseRef.current.send(JSON.stringify({ text: initialTextMessage }));
      }
      return;
    }

    sessionErrorOccurred.current = false;
    setSessionStatus('connecting');
    setTranscriptionHistory(prev => [
      ...prev,
      ...(initialTextMessage ? [{ speaker: 'User' as const, text: initialTextMessage }] : []),
      { speaker: 'System' as const, text: `Connecting to VYNO [${emotionalMode} Mode]...` }
    ]);

    try {
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsHost = window.location.host;
      const wsUrl = `${wsProtocol}//${wsHost}/api/live?mode=${encodeURIComponent(emotionalMode)}`;
      
      const ws = new WebSocket(wsUrl);
      sessionPromiseRef.current = ws;

      let nextStartTime = 0;
      const sources = new Set<AudioBufferSourceNode>();
      let currentInputTranscription = '';
      let currentOutputTranscription = '';

      ws.onopen = () => {
        setIsSessionActive(true);
        setSessionStatus('active');
        
        if (initialTextMessage) {
          ws.send(JSON.stringify({ text: initialTextMessage }));
        }

        const hasMic = !!(audioContextRef.current && mediaStreamSourceRef.current);
        if (!hasMic) {
          setTranscriptionHistory(prev => [...prev, { speaker: 'System', text: 'Holographic Terminal Connection Online. Submit telemetry queries via keyboard below.' }]);
          return;
        }

        setTranscriptionHistory(prev => [...prev, { speaker: 'System', text: 'Connection established. You may speak.' }]);
        
        if (!audioContextRef.current) return;
        const source = mediaStreamSourceRef.current;
        if (!source) return;
        
        // Clean up previous scriptProcessor, if any
        if (scriptProcessorRef.current) {
          try {
            scriptProcessorRef.current.disconnect();
          } catch (e) {
            console.warn("Error disconnecting stale scriptProcessor:", e);
          }
        }

        const scriptProcessor = audioContextRef.current.createScriptProcessor(4096, 1, 1);
        scriptProcessorRef.current = scriptProcessor;
        scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
          const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
          const pcmBlob = createBlob(inputData);
          if (sessionPromiseRef.current && sessionPromiseRef.current.readyState === WebSocket.OPEN) {
            sessionPromiseRef.current.send(JSON.stringify({ audio: pcmBlob.data }));
          }
        };
        source.connect(scriptProcessor);
        scriptProcessor.connect(audioContextRef.current.destination);
      };

      ws.onmessage = async (event) => {
        try {
          const message = JSON.parse(event.data);

          if (message.error) {
            const errorText = typeof message.error === 'object' && message.error !== null
              ? (message.error.message || JSON.stringify(message.error))
              : String(message.error);
            console.error('Session error:', errorText);
            sessionErrorOccurred.current = true;
            setSessionStatus('error');
            setTranscriptionHistory(prev => [...prev, { speaker: 'System', text: `AI error: ${errorText}` }]);
            return;
          }

          if (message.type === 'open') {
            return;
          }

          if (message.serverContent?.outputTranscription) {
            currentOutputTranscription += message.serverContent.outputTranscription.text;
          } else if (message.serverContent?.inputTranscription) {
            currentInputTranscription += message.serverContent.inputTranscription.text;
          }

          if (message.serverContent?.turnComplete) {
            const fullInput = currentInputTranscription.trim();
            if (fullInput) {
              setTranscriptionHistory(prev => [...prev, { speaker: 'User', text: fullInput }]);
            }

            const fullOutput = currentOutputTranscription.trim();
            if (fullOutput) {
              const speaker: Speaker = emotionalMode === 'Thulu' ? 'THULU' : 'VYNO';
              const text = fullOutput.replace(/^(VYNO|YNO|THULU):\s*/i, '').trim();
              setTranscriptionHistory(prev => [...prev, { speaker, text }]);
            }
            
            currentInputTranscription = '';
            currentOutputTranscription = '';
          }

          const base64EncodedAudioString = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
          if (base64EncodedAudioString && audioContextRef.current && analyserRef.current) {
            nextStartTime = Math.max(nextStartTime, audioContextRef.current.currentTime);
            const audioBuffer = await decodeAudioData(decode(base64EncodedAudioString), audioContextRef.current, 24000, 1);
            const source = audioContextRef.current.createBufferSource();
            source.buffer = audioBuffer;
            
            // Connect to context AND analyser for visualization
            source.connect(audioContextRef.current.destination);
            source.connect(analyserRef.current);
            
            source.addEventListener('ended', () => sources.delete(source));
            source.start(nextStartTime);
            nextStartTime += audioBuffer.duration;
            sources.add(source);
          }

          if (message.serverContent?.interrupted) {
            sources.forEach(source => source.stop());
            sources.clear();
            nextStartTime = 0;
          }
        } catch (err) {
          console.error("Error processing browser socket message payload:", err);
        }
      };

      ws.onerror = (e: any) => {
        const errorDetail = e && typeof e === 'object' ? (e.message || 'WebSocket connection error / closed unexpectedly') : String(e);
        console.error('Session error:', errorDetail);
        sessionErrorOccurred.current = true;
        setSessionStatus('error');
        setTranscriptionHistory(prev => [...prev, { speaker: 'System', text: "An error occurred with the AI session. The connection has been closed. Please check your network and try starting a new conversation." }]);
      };

      ws.onclose = () => {
        console.log('Session closed');
        scriptProcessorRef.current?.disconnect();
        sessionPromiseRef.current = null;
        setIsSessionActive(false);
        
        if (!sessionErrorOccurred.current) {
            setSessionStatus('idle');
            setTranscriptionHistory(prev => [...prev, { speaker: 'System', text: 'Conversation ended.' }]);
        }
      };

    } catch (error) {
        console.error("AI Initialization failed:", error);
        setTranscriptionHistory(prev => [...prev, {speaker: 'System', text: 'Error: Could not initialize AI model.'}]);
        setSessionStatus('error');
    }
  }, [emotionalMode]);

  const sendTextMessage = useCallback(() => {
    if (!inputText.trim()) return;
    const msg = inputText.trim();
    setInputText('');
    
    if (sessionPromiseRef.current && sessionPromiseRef.current.readyState === WebSocket.OPEN) {
      setTranscriptionHistory(prev => [...prev, { speaker: 'User', text: msg }]);
      sessionPromiseRef.current.send(JSON.stringify({ text: msg }));
    } else {
      startConversation(msg);
    }
  }, [inputText, startConversation]);

  const initBaseAudio = useCallback(async () => {
    if (isAudioReady || audioContextRef.current) return;
    setAudioError(null);
    try {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const analyser = audioContextRef.current.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;
        
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const microphoneSource = audioContextRef.current.createMediaStreamSource(stream);
      mediaStreamSourceRef.current = microphoneSource;
      microphoneSource.connect(analyser);

      if (backgroundMusicRef.current) {
        const musicSource = audioContextRef.current.createMediaElementSource(backgroundMusicRef.current);
        musicSource.connect(analyser);
        musicSource.connect(audioContextRef.current.destination);
      }
      
      setIsAudioReady(true);
      setShowMessageBox(false);
      videoRef.current?.play().catch(e => console.warn("Video play failed", e));
      backgroundMusicRef.current?.play().catch(e => console.warn("Audio play failed", e));
      
      // Animation loop moved to ThreeCanvas to avoid React re-renders

    } catch (error) {
      console.error("Audio initialization failed:", error);
      if (error instanceof Error) {
        if (error.name === 'NotAllowedError' || error.message.includes('Permission denied')) {
             setAudioError(PermissionDeniedMessage);
             setMicPermissionStatus('denied');
        } else if (error.name === 'NotFoundError') {
            setAudioError("No microphone was found. Please connect a microphone and try again.");
        }
        else {
            setAudioError(`An unexpected error occurred: ${error.message}. Please try again.`);
        }
    } else {
        setAudioError("An unknown error occurred during audio initialization.");
    }
    }
  }, [isAudioReady]);

  const initTextOnlyAudio = useCallback(async () => {
    if (isAudioReady || audioContextRef.current) return;
    setAudioError(null);
    try {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const analyser = audioContextRef.current.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;
        
      if (backgroundMusicRef.current) {
        const musicSource = audioContextRef.current.createMediaElementSource(backgroundMusicRef.current);
        musicSource.connect(analyser);
        musicSource.connect(audioContextRef.current.destination);
      }
      
      setIsAudioReady(true);
      setShowMessageBox(false);
      videoRef.current?.play().catch(e => console.warn("Video play failed", e));
      backgroundMusicRef.current?.play().catch(e => console.warn("Audio play failed", e));

    } catch (error) {
      console.error("Text-only audio initialization failed:", error);
      // Fallback: still let the user enter and use the terminal
      setIsAudioReady(true);
      setShowMessageBox(false);
    }
  }, [isAudioReady]);

  useEffect(() => {
    return () => {
      endConversation();
      audioContextRef.current?.close();
    };
  }, [endConversation]);

  const disabledTooltip = isSessionActive ? "Change mode after session ends" : "";

  return (
    <div style={{ background: backgroundGradient }} className="min-h-screen text-white transition-all duration-500 ease-in-out font-sans">
      <ThreeCanvas analyser={analyserRef} videoRef={videoRef} emotionalMode={emotionalMode} fidelity={fidelity} />
      
      {/* HUD OVERLAY */}
      <div className="fixed inset-0 z-10 pointer-events-none p-4 md:p-8 flex flex-col justify-between">
        <motion.header 
          initial={{ y: -100, opacity: 0 }}
          animate={{ y: isHudVisible ? 0 : -150, opacity: isHudVisible ? 1 : 0 }}
          transition={{ duration: 0.6, ease: "easeInOut" }}
          className={`flex items-center justify-between bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl p-4 md:p-6 shadow-2xl ${isHudVisible ? 'pointer-events-auto' : 'pointer-events-none'}`}
        >
          <div className="flex items-center gap-4">
            <div className="flex flex-col">
              <h1 className="text-xl md:text-3xl font-black tracking-tighter" style={{ background: `linear-gradient(45deg, ${cosmicColors.cyan}, ${cosmicColors.pink}, ${cosmicColors.purple})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                VYNO COIN
              </h1>
              <div className="flex items-center gap-2">
                <span className="text-[8px] font-black uppercase tracking-[0.3em] text-cyan-400">Powered by Vanhsya</span>
                <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse"></div>
              </div>
            </div>

            <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-full p-1 pointer-events-auto shadow-inner ml-2 md:ml-4">
               {(['advisor', 'registry'] as const).map((tab) => (
                 <button
                   key={tab}
                   onClick={() => setActiveTab(tab)}
                   className={`px-3 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest transition-all duration-300 cursor-pointer border
                     ${activeTab === tab 
                       ? 'bg-cyan-500/10 text-cyan-300 border-cyan-400/40 font-black shadow-[0_0_12px_rgba(6,182,212,0.15)]' 
                       : 'bg-transparent text-gray-500 border-transparent hover:text-gray-300'}
                   `}
                 >
                   {tab === 'advisor' ? 'Cosmos Link' : 'Systems Hub'}
                 </button>
               ))}
            </div>

            <button
               onClick={() => setIsHudVisible(false)}
               className="px-3 py-1.5 rounded-full border border-cyan-500/20 hover:border-cyan-400 bg-cyan-500/5 hover:bg-cyan-500/15 transition-all text-[9.5px] font-black tracking-wider text-cyan-400 flex items-center gap-1.5 cursor-pointer pointer-events-auto"
               title="Hide Control Panels for Pure Immersive Observation"
            >
              <EyeOff size={12} />
              <span className="hidden sm:inline">PURE VIEW</span>
            </button>
          </div>

          <div className="flex items-center gap-4 md:gap-8 overflow-x-auto no-scrollbar pb-1">
             <div className="hidden sm:flex items-center gap-6 border-r border-white/10 pr-6 mr-2">
                <StatusModule label="Encrypted" color={cosmicColors.green} pulse={false} icon={<Shield size={16} />} />
                <StatusModule label="Active" color={isSessionActive ? cosmicColors.purple : cosmicColors.green} pulse={isSessionActive} icon={<Activity size={16} />} />
                <StatusModule label="Stream" color={isAudioReady ? cosmicColors.purple : cosmicColors.dangerRed} pulse={isAudioReady} icon={<Zap size={16} />} />
             </div>

            <div className="flex flex-col gap-2 pointer-events-auto">
                <div className="flex items-center gap-2">
                   <Info size={10} className="text-cyan-400" />
                   <div className="text-[9px] font-black uppercase tracking-widest text-gray-500">Cognitive Tone</div>
                </div>
                <div className="flex items-center gap-1">
                    {(['Professional', 'Enthusiastic', 'Cautious', 'Zen', 'Thulu'] as const).map((mode) => (
                      <ModeButton 
                        key={mode}
                        onClick={() => setEmotionalMode(mode)} 
                        isActive={emotionalMode === mode} 
                        disabled={isSessionActive} 
                        color={
                          mode === 'Professional' ? cosmicColors.cyan : 
                          mode === 'Enthusiastic' ? cosmicColors.gold : 
                          mode === 'Cautious' ? cosmicColors.green : 
                          mode === 'Zen' ? cosmicColors.pink : 
                          cosmicColors.emerald
                        } 
                        title={disabledTooltip}
                      >
                        {mode === 'Thulu' ? '🐙 THU' : mode.slice(0, 3)}
                      </ModeButton>
                    ))}
                </div>
            </div>

            <div className="flex flex-col gap-2 pointer-events-auto border-l border-white/10 pl-4">
                <div className="flex items-center gap-2">
                   <Cpu size={10} className="text-pink-400 font-bold" />
                   <div className="text-[9px] font-black uppercase tracking-widest text-gray-500">Visual Quality</div>
                </div>
                <div className="flex items-center gap-1">
                    {(['High', 'Low'] as const).map((fid) => (
                      <button
                        key={fid}
                        onClick={() => setFidelity(fid)}
                        className={`px-3 py-1 text-[10px] uppercase tracking-tighter rounded-full transition-all duration-300 font-black border-2 cursor-pointer
                          ${fidelity === fid 
                            ? 'bg-black text-white border-pink-400' 
                            : 'bg-transparent text-gray-400 border-gray-800 hover:border-gray-600 hover:text-gray-300'}
                        `}
                        style={fidelity === fid ? { borderColor: cosmicColors.pink, boxShadow: `0 0 10px ${cosmicColors.pink}` } : {}}
                        title={fid === 'Low' ? "Optimized physics & count limits for maximum resource savings" : "Ultimate high resolution rendering and visual effects"}
                      >
                        {fid}
                      </button>
                    ))}
                </div>
            </div>
          </div>
        </motion.header>

        <motion.div 
          animate={{ y: isHudVisible ? 0 : 500, opacity: isHudVisible ? 1 : 0 }}
          transition={{ duration: 0.6, ease: "easeInOut" }}
          className={`flex flex-col items-center gap-6 w-full ${isHudVisible ? 'pointer-events-auto' : 'pointer-events-none'}`}
        >
          {activeTab === 'advisor' ? (
            <>
              <div className="pointer-events-auto shadow-2xl">
                 <CosmicButton 
                    onClick={() => isSessionActive ? endConversation() : startConversation()} 
                    disabled={!isAudioReady || sessionStatus === 'connecting'} 
                    variant={isSessionActive ? 'danger' : undefined}
                    icon={isSessionActive ? <MicOff size={18} /> : <Mic size={18} />}
                  >
                      {sessionStatus === 'connecting' ? 'Calibrating...' : isSessionActive ? 'Sever Link' : 'Establish Link'}
                  </CosmicButton>
              </div>

              <motion.div 
                initial={{ y: 25, opacity: 0 }}
                animate={{ 
                  y: 0, 
                  opacity: 1,
                  height: isFeedCollapsed ? "64px" : "340px"
                }}
                transition={{ type: "spring", stiffness: 140, damping: 22 }}
                className="w-full max-w-xl bg-black/60 backdrop-blur-2xl border border-white/15 rounded-3xl p-5 overflow-hidden flex flex-col pointer-events-auto shadow-[0_20px_50px_rgba(0,0,0,0.85)] border-t-cyan-500/25 border-b-purple-500/25"
              >
                <div className="flex items-center justify-between mb-2 border-b border-white/5 pb-2 flex-shrink-0">
                    <div className="flex items-center gap-2">
                        <Activity size={12} className="text-purple-400 animate-pulse" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Neural Transcription Feed</span>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1">
                            <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping"></div>
                            <span className="text-[8px] font-mono text-cyan-500 mr-2">LIVE_DATA_TX</span>
                        </div>

                        <button
                          type="button"
                          onClick={() => setIsFeedCollapsed(!isFeedCollapsed)}
                          className="px-2.5 py-1 rounded-lg border border-purple-500/25 hover:border-purple-400 bg-purple-500/5 hover:bg-purple-500/15 transition-all text-[8.5px] font-black uppercase tracking-widest text-purple-300 cursor-pointer pointer-events-auto"
                          title={isFeedCollapsed ? "Expand Feed" : "Collapse Feed to view background animation"}
                        >
                          {isFeedCollapsed ? "EXPAND_FEED" : "COLLAPSE_FEED"}
                        </button>
                    </div>
                </div>
                <div ref={transcriptionContainerRef} className="flex-1 overflow-y-auto space-y-4 font-space-mono text-xs pr-2 custom-scrollbar">
                    <AnimatePresence mode="popLayout">
                        {transcriptionHistory.length === 0 && (
                            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="h-full flex items-center justify-center text-gray-600 italic">
                                Awaiting signal input...
                            </motion.div>
                        )}
                        {transcriptionHistory.map((msg, index) => (
                            <motion.div 
                              key={index} 
                              initial={{ x: msg.speaker === 'User' ? 20 : -20, opacity: 0 }}
                              animate={{ x: 0, opacity: 1 }}
                              className={`flex items-start gap-3 ${msg.speaker === 'User' ? 'flex-row-reverse' : ''}`}
                            >
                              <div className={`w-8 h-8 rounded-lg flex-shrink-0 flex items-center justify-center font-black text-xs border ${msg.speaker === 'User' ? 'bg-cyan-500/10 border-cyan-500/50 text-cyan-400' : msg.speaker === 'System' ? 'bg-gray-500/10 border-gray-500/50 text-gray-400' : 'bg-purple-500/10 border-purple-500/50 text-purple-400'}`}>
                                {msg.speaker === 'User' ? 'U' : msg.speaker === 'System' ? 'S' : 'V'}
                              </div>
                              <div className={`flex flex-col ${msg.speaker === 'User' ? 'items-end' : 'items-start'} max-w-[80%]`}>
                                <div className="flex items-center gap-2 mb-1">
                                    <span className={`text-[9px] font-black uppercase tracking-widest ${msg.speaker === 'User' ? 'text-cyan-400' : msg.speaker === 'System' ? 'text-gray-500' : 'text-purple-400'}`}>
                                        {msg.speaker === 'User' ? 'Inquisitor' : msg.speaker === 'System' ? 'Kernel' : 'VYNO_ADVISOR'}
                                    </span>
                                    <span className="text-[8px] text-gray-700 italic">{new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                                </div>
                                <div className={`p-3 rounded-xl border ${msg.speaker === 'User' ? 'bg-cyan-500/5 border-cyan-500/20 text-cyan-50' : msg.speaker === 'System' ? 'bg-gray-500/5 border-gray-500/10 text-gray-400 italic' : 'bg-purple-500/5 border-purple-500/20 text-purple-50'}`}>
                                    <div className="leading-relaxed prose prose-invert prose-xs">
                                        <Markdown>
                                          {typeof msg.text === 'string'
                                            ? msg.text
                                            : typeof msg.text === 'object' && msg.text !== null
                                            ? ((msg.text as any).message || JSON.stringify(msg.text))
                                            : String(msg.text || '')}
                                        </Markdown>
                                    </div>
                                </div>
                              </div>
                            </motion.div>
                        ))}
                    </AnimatePresence>
                </div>

                {/* interactive manual transmition form */}
                <form 
                  onSubmit={(e) => { e.preventDefault(); sendTextMessage(); }}
                  className="mt-3 flex items-center gap-2 border-t border-white/10 pt-3"
                >
                  <input
                    type="text"
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    placeholder="Transmit encrypted signal query manually..."
                    className="flex-1 bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500/50 transition-colors pointer-events-auto"
                  />
                  <button
                    type="submit"
                    disabled={!inputText.trim()}
                    className="px-4 py-3 bg-cyan-500/20 hover:bg-cyan-500/40 border border-cyan-500/30 rounded-xl text-cyan-400 text-xs font-black uppercase tracking-wider transition-all duration-300 disabled:opacity-30 disabled:pointer-events-none cursor-pointer pointer-events-auto"
                  >
                    Transmit
                  </button>
                </form>
              </motion.div>
            </>
          ) : (
            <motion.div
              initial={{ scale: 0.98, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 150, damping: 25 }}
              className="w-full max-w-5xl bg-black/75 backdrop-blur-3xl border border-white/15 rounded-[2rem] p-6 md:p-8 hover:border-cyan-500/20 transition-all duration-500 shadow-[0_25px_65px_rgba(0,0,0,0.95)] overflow-y-auto max-h-[70vh] pointer-events-auto space-y-8 text-left border-t-amber-500/25 border-b-cyan-500/25 custom-scrollbar"
            >
              <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-white/5 pb-4 gap-4">
                <div>
                  <h2 className="text-xl md:text-2xl font-black uppercase tracking-tight flex items-center gap-2">
                    <span className="text-cyan-400">TECH</span>
                    <span className="text-amber-400">TRANSIT</span>
                    <span className="text-xs font-mono py-1 px-2.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20 font-medium">SYSTEMS & AEROSPACE REGISTRY</span>
                  </h2>
                  <p className="text-xs text-gray-400 mt-1 max-w-xl">
                    Authorized hardware database. Complete catalog referencing core aerospace propulsion physics, structural codebases, and local network signals.
                  </p>
                </div>
                <div className="flex items-center gap-2 self-start md:self-center">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                  <span className="text-[10px] font-mono text-emerald-400 font-bold uppercase tracking-widest">DECRYPT_LEVEL_A</span>
                </div>
              </div>

              {/* CODESPACE & DNA OF THE WEB */}
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-black uppercase tracking-widest text-cyan-300 flex items-center gap-2">
                    <span className="w-1.5 h-3 bg-cyan-400 rounded-sm"></span>
                    The DNA of the Web (Coding Standards)
                  </h3>
                  <p className="text-[11px] text-gray-400 max-w-2xl mt-1">
                    Modern digital applications leverage optimized structural architectures. Hover or tab to load corresponding blueprint modules.
                  </p>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                  {/* Tab Selector Column */}
                  <div className="lg:col-span-2 flex flex-col gap-2.5">
                    {(Object.keys(codeSnippets) as Array<keyof typeof codeSnippets>).map((langKey) => (
                      <button
                        type="button"
                        key={langKey}
                        onClick={() => {
                          setSelectedSnippet(langKey);
                          setCodeExplanation('Click "Explain Code" to initiate high-throughput description breakdown.');
                        }}
                        className={`w-full text-left p-4 rounded-xl border transition-all duration-300 ${
                          selectedSnippet === langKey
                            ? 'bg-gradient-to-r from-cyan-500/15 via-cyan-500/5 to-transparent border-cyan-400/40 shadow-inner text-white'
                            : 'bg-black/20 border-white/5 text-gray-400 hover:border-white/10 hover:text-gray-200'
                        }`}
                      >
                        <span className="text-xs font-black uppercase tracking-wider block">
                          {langKey === 'html' ? 'HTML5 Document' : langKey === 'javascript' ? 'JavaScript Core' : langKey === 'python' ? 'Python Interpreter' : 'C++ System Engine'}
                        </span>
                        <span className="text-[9.5px] font-mono text-gray-500">
                          {langKey === 'html' ? 'Core DOM Markup Structure' : langKey === 'javascript' ? 'High Latency Event Sync' : langKey === 'python' ? 'Complex Vector Math Engine' : 'Ultra-Performance Flight Vector'}
                        </span>
                      </button>
                    ))}
                  </div>

                  {/* Terminal Display Panel */}
                  <div className="lg:col-span-3 flex flex-col bg-slate-950/85 border border-white/10 rounded-2xl overflow-hidden h-[330px] shadow-2xl relative">
                    <div className="bg-slate-900/90 px-4 py-2.5 flex items-center justify-between border-b border-white/5">
                      <div className="flex items-center gap-1.5">
                        <div className="w-2.5 h-2.5 rounded-full bg-red-500 opacity-80"></div>
                        <div className="w-2.5 h-2.5 rounded-full bg-amber-500 opacity-80"></div>
                        <div className="w-2.5 h-2.5 rounded-full bg-green-500 opacity-80"></div>
                        <span className="text-[10px] text-gray-500 font-mono uppercase tracking-widest ml-3">
                          {selectedSnippet === 'html' ? 'index.html' : selectedSnippet === 'javascript' ? 'vyno_sync.js' : selectedSnippet === 'python' ? 'telemetry.py' : 'physics_aero.cpp'}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={explainSelectedCode}
                        disabled={isExplaining}
                        className="text-[9px] bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 px-3 py-1.5 rounded-lg transition-all duration-300 font-black uppercase tracking-wider disabled:opacity-40 pointer-events-auto cursor-pointer"
                      >
                        {isExplaining ? 'Processing...' : '✨ Explain Code'}
                      </button>
                    </div>

                    <div className="p-4 overflow-auto font-mono text-[11px] leading-relaxed flex-grow text-cyan-100 bg-black/30 scrollbar-thin">
                      <pre className="whitespace-pre">{codeSnippets[selectedSnippet]}</pre>
                    </div>

                    <div className="p-3 bg-slate-950/90 text-[10px] text-gray-400 border-t border-white/5 h-24 overflow-y-auto italic custom-scrollbar">
                      {isExplaining ? (
                        <div className="space-y-2 py-1">
                          <div className="loading-shimmer h-3 w-full rounded opacity-70"></div>
                          <div className="loading-shimmer h-3 w-5/6 rounded opacity-70"></div>
                          <div className="loading-shimmer h-3 w-2/3 rounded opacity-70"></div>
                        </div>
                      ) : (
                        codeExplanation
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* AEROSPACE & PHYSICS DECOY */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                
                {/* Propulsion & Physics assistant */}
                <div className="flex flex-col gap-4">
                  <h3 className="text-sm font-black uppercase tracking-widest text-amber-300 flex items-center gap-2">
                    <span className="w-1.5 h-3 bg-amber-400 rounded-sm"></span>
                    Aviation & Supersonic Dynamics
                  </h3>

                  <div className="p-5 bg-white/5 duration-300 rounded-2xl border border-white/5 hover:border-amber-500/20 text-left space-y-3">
                    <div className="flex items-center gap-3">
                      <span className="text-3xl">✈️</span>
                      <div>
                        <h4 className="text-xs font-black uppercase tracking-wider text-white">Fixed-Wing Hull Parameters</h4>
                        <span className="text-[10.5px] text-gray-500 font-mono">Airbus A380 & Lockheed SR-71 Telemetry</span>
                      </div>
                    </div>
                    <p className="text-[11px] text-gray-400 leading-relaxed">
                      Aerodynamic aircraft rely on pressure-differential "Lift" generated via high-velocity chord camber. While standard airlines seek lift-to-drag optimization at subsonic flight (Mach 0.85), supersonic scouts like the SR-71 bypass bypass thresholds to generate sonic compression shockwaves.
                    </p>
                  </div>

                  {/* Sonic visualization simulation */}
                  <div className="p-5 bg-gradient-to-br from-black/40 to-slate-900/50 rounded-2xl border border-white/5 flex items-center justify-between h-36 relative overflow-hidden">
                    <div className="space-y-1 z-10">
                      <h4 className="text-xs font-black uppercase tracking-wider text-amber-400">Sonic Shockwave Simulation</h4>
                      <p className="text-[10px] text-gray-400 leading-relaxed max-w-[190px]">
                        Continuous oscillation visualizer tracking acoustic compression barrier threshold convergence.
                      </p>
                    </div>
                    <div className="relative w-32 h-32 flex items-center justify-center border border-white/5 rounded-full mr-4 bg-black/40">
                      <div className="absolute w-12 h-12 bg-amber-400/10 rounded-full animate-ping"></div>
                      <div className="absolute w-20 h-20 bg-amber-400/5 rounded-full animate-ping [animation-delay:0.4s]"></div>
                      <div className="absolute w-28 h-28 bg-amber-400/5 rounded-full animate-ping [animation-delay:0.8s]"></div>
                      <div className="text-[9px] font-mono font-bold text-amber-400 uppercase tracking-widest z-10 text-center select-none bg-black/60 px-2.5 py-1 rounded-md border border-amber-500/25">
                        Mach 1.0
                      </div>
                    </div>
                  </div>
                </div>

                {/* Aerospace chatbot */}
                <div className="flex flex-col gap-3 bg-gradient-to-b from-slate-900/40 to-cyan-950/10 border border-slate-800/80 rounded-2xl p-4 md:p-5">
                  <div className="flex items-center justify-between border-b border-white/5 pb-2">
                    <h3 className="text-xs font-black text-white flex items-center gap-2 uppercase tracking-widest">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
                      </span>
                      Aerospace Assistant
                    </h3>
                    <span className="text-[9px] font-mono text-gray-500">COGNITION_LINK</span>
                  </div>

                  {/* Chats output */}
                  <div className="flex-grow overflow-y-auto space-y-3 h-48 pr-2 max-h-[190px] custom-scrollbar text-[11px] text-left">
                    {aerospaceChat.map((msg, i) => (
                      <div key={i} className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}>
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className={`text-[9.5px] font-black uppercase tracking-wider ${msg.sender === 'user' ? 'text-cyan-400' : 'text-amber-400'}`}>
                            {msg.sender === 'user' ? 'Inquisitor' : 'Aerospace Assistant'}
                          </span>
                        </div>
                        <div className={`p-2.5 rounded-xl border max-w-[85%] leading-relaxed ${msg.sender === 'user' ? 'bg-cyan-500/5 border-cyan-500/20 text-cyan-50' : 'bg-amber-500/5 border-amber-500/10 text-amber-100'}`}>
                          {msg.text}
                        </div>
                      </div>
                    ))}
                    {isAerospaceLoading && (
                      <div className="flex items-start gap-2">
                        <div className="loading-shimmer h-8 w-2/3 rounded-xl opacity-60"></div>
                      </div>
                    )}
                  </div>

                  {/* Input form */}
                  <form onSubmit={askAerospaceExpert} className="flex gap-2 border-t border-white/5 pt-3">
                    <input
                      type="text"
                      value={aerospaceInput}
                      onChange={(e) => setAerospaceInput(e.target.value)}
                      placeholder="Ask rocket equations, sonic pressure..."
                      disabled={isAerospaceLoading}
                      className="flex-grow bg-slate-950/70 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-cyan-500/40 transition-colors pointer-events-auto"
                    />
                    <button
                      type="submit"
                      disabled={isAerospaceLoading || !aerospaceInput.trim()}
                      className="bg-cyan-500/20 hover:bg-cyan-500/45 text-cyan-400 border border-cyan-500/35 px-4 rounded-xl text-xs font-black uppercase tracking-wider transition-all duration-300 disabled:opacity-30 cursor-pointer pointer-events-auto"
                    >
                      {isAerospaceLoading ? '...' : 'Ask'}
                    </button>
                  </form>
                </div>
              </div>

              {/* TELEMETRY MATRIX & STATS CARD */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 border-t border-white/5 pt-6">
                <div className="p-4 bg-white/5 rounded-xl border border-white/5 text-left">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-cyan-400">ACTIVE CHANNELS</div>
                  <div className="text-lg font-black font-mono text-white mt-2">SECURE PORT 82</div>
                  <p className="text-[10px] text-gray-500 leading-tight mt-1">High fidelity data link with orbital cryptographic keys.</p>
                </div>
                <div className="p-4 bg-white/5 rounded-xl border border-white/5 text-left">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-amber-400">PROPULSION LIFT</div>
                  <div className="text-lg font-black font-mono text-white mt-2">MACH 3.2 BLACKBIRD</div>
                  <p className="text-[10px] text-gray-500 leading-tight mt-1">SR-71 shock compression limits optimized for thermal drag levels.</p>
                </div>
                <div className="p-4 bg-white/5 rounded-xl border border-white/5 text-left">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-purple-400">SIGNAL PROPAGATION</div>
                  <div className="text-lg font-black font-mono text-white mt-2">~299,792 KM/S</div>
                  <p className="text-[10px] text-gray-500 leading-tight mt-1">Universal light speed constant computed across local nodes.</p>
                </div>
              </div>
            </motion.div>
          )}
        </motion.div>
      </div>
      
      {/* INITIALIZATION OVERLAY */}
      <AnimatePresence>
        {showMessageBox && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, scale: 1.1 }}
              className="fixed inset-0 bg-black/35 backdrop-blur-sm z-50 flex items-center justify-center p-6"
            >
                <motion.div 
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: 0.2 }}
                    className="max-w-xl w-full p-8 md:p-12 bg-black/60 backdrop-blur-3xl border-2 border-purple-500/30 rounded-[2.5rem] text-center shadow-[0_0_100px_rgba(138,43,226,0.3)] relative overflow-hidden"
                >
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-purple-500 to-transparent"></div>
                    
                    <div className="flex justify-center mb-8">
                        <div className="relative">
                            <motion.div 
                                animate={{ rotate: 360 }}
                                transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
                                className="w-24 h-24 rounded-full border-4 border-dashed border-purple-500/20"
                            ></motion.div>
                            <div className="absolute inset-0 flex items-center justify-center">
                                <Sparkles className="text-cyan-400 w-10 h-10" />
                            </div>
                        </div>
                    </div>

                    <h2 className="text-3xl md:text-5xl font-black mb-3 uppercase tracking-tighter" style={{ background: `linear-gradient(45deg, ${cosmicColors.cyan}, ${cosmicColors.pink})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                        Neural Link Required
                    </h2>
                    
                    <p className="mb-4 text-cyan-400 font-bold uppercase tracking-widest text-[9px]">
                        VYNO COIN Ecosystem Verification & Authorization
                    </p>

                    <div className="mb-6 p-4 bg-white/5 border border-white/10 rounded-2xl text-left text-xs text-gray-300 max-h-[160px] overflow-y-auto space-y-2 custom-scrollbar pointer-events-auto">
                        <p className="font-semibold text-white">1. Real-time Cosmos Link</p>
                        <p className="text-gray-400 leading-relaxed">
                            Welcome to the <strong className="text-cyan-400">VYNO COIN</strong> Sentient Cosmos, powered by <strong className="text-purple-400">Vanhsya</strong>. Connecting to this terminal initiates local client-side sound processing coupled with a persistent high-performance real-time WebSocket connection to the VYNO AI engine.
                        </p>
                        <p className="font-semibold text-white">2. Low-latency Voice Interface</p>
                        <p className="text-gray-400 leading-relaxed">
                            Our immersive platform utilizes state-of-the-art live audio streaming allowing hands-free voice interrogation. No real-world financial assets are automatically executed during this telemetry simulation.
                        </p>
                        <p className="font-semibold text-white">3. System Consent</p>
                        <p className="text-gray-400 leading-relaxed">
                            I authorize the application to activate the local microphone stream for real-time speech transcription and synthesis.
                        </p>
                    </div>

                    <label className="flex items-center gap-3 justify-center mb-6 cursor-pointer group text-left select-none max-w-sm mx-auto pointer-events-auto">
                        <input 
                            type="checkbox" 
                            checked={hasAcknowledgedExplanation} 
                            onChange={(e) => setHasAcknowledgedExplanation(e.target.checked)}
                            className="w-4 h-4 rounded border-purple-500/50 bg-black/50 text-cyan-400 focus:ring-cyan-400/50 cursor-pointer"
                        />
                        <span className={`text-[10px] font-black uppercase tracking-wider transition-colors ${hasAcknowledgedExplanation ? 'text-cyan-400 font-bold' : 'text-gray-400 group-hover:text-gray-300'}`}>
                            I consent to the terminal protocols
                        </span>
                    </label>

                    {audioError && (
                        <motion.div 
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          className="mb-8 p-4 bg-red-500/10 border border-red-500/50 rounded-2xl text-left overflow-hidden pointer-events-auto"
                        >
                            <div className="flex items-center gap-2 mb-2">
                                <X className="text-red-500 w-4 h-4" />
                                <span className="text-[10px] font-black uppercase tracking-widest text-red-400 text-left">Systems Malfunction</span>
                            </div>
                            <div className="text-red-50 text-xs text-left leading-relaxed">
                                { typeof audioError === 'string' ? audioError : audioError }
                            </div>
                        </motion.div>
                    )}

                    <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pointer-events-auto">
                        <motion.button 
                            whileHover={hasAcknowledgedExplanation ? { scale: 1.05 } : {}}
                            whileTap={hasAcknowledgedExplanation ? { scale: 0.95 } : {}}
                            onClick={() => hasAcknowledgedExplanation && initBaseAudio()} 
                            disabled={micPermissionStatus === 'denied' || !hasAcknowledgedExplanation}
                            className={`group relative py-4 px-8 rounded-full font-black uppercase text-xs tracking-[0.15em] bg-white text-black overflow-hidden transition-all duration-300 ${(micPermissionStatus === 'denied' || !hasAcknowledgedExplanation) ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'}`}
                        >
                            <span className="relative z-10 flex items-center gap-2">
                                <Power size={14} />
                                {micPermissionStatus === 'denied' ? 'OS Link Blocked' : 'Initialize Voice'}
                            </span>
                            {hasAcknowledgedExplanation && (
                                <div className="absolute inset-0 bg-gradient-to-r from-cyan-400 to-purple-500 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                            )}
                        </motion.button>

                        <motion.button 
                            whileHover={hasAcknowledgedExplanation ? { scale: 1.05 } : {}}
                            whileTap={hasAcknowledgedExplanation ? { scale: 0.95 } : {}}
                            onClick={() => {
                                if (hasAcknowledgedExplanation) {
                                    initTextOnlyAudio();
                                }
                            }}
                            disabled={!hasAcknowledgedExplanation}
                            className={`py-4 px-8 rounded-full font-black uppercase text-xs tracking-[0.15em] bg-transparent border-2 border-cyan-500/35 text-cyan-400 hover:bg-cyan-500/10 transition-all duration-300 ${!hasAcknowledgedExplanation ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'}`}
                        >
                            HOLOGRAPHIC TEXT MODE
                        </motion.button>
                    </div>

                    <div className="mt-8 flex justify-center gap-4 opacity-30 grayscale">
                        <div className="w-8 h-px bg-white/20 my-auto"></div>
                        <span className="text-[8px] uppercase tracking-widest font-black">Secure Node 82-X</span>
                        <div className="w-8 h-px bg-white/20 my-auto"></div>
                    </div>
                </motion.div>
            </motion.div>
        )}
      </AnimatePresence>

      {/* FLOAT RESTORE BUTTON FOR IMMERSIVE CINEMATIC MODE */}
      <AnimatePresence>
        {!isHudVisible && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8, y: 30 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8, y: 30 }}
            transition={{ type: "spring", stiffness: 220, damping: 22 }}
            onClick={() => setIsHudVisible(true)}
            className="fixed bottom-6 right-6 z-40 bg-black/60 shadow-[0_0_30px_rgba(6,182,212,0.35)] hover:bg-black/90 text-cyan-400 border border-cyan-500/40 backdrop-blur-xl px-4 py-3 rounded-full text-[10px] font-black uppercase tracking-[0.2em] flex items-center gap-2 cursor-pointer pointer-events-auto"
            title="Restore HUD Control Panels"
          >
            <Eye size={12} className="animate-pulse text-cyan-400" />
            <span>Show HUD Panels</span>
          </motion.button>
        )}
      </AnimatePresence>

      <audio ref={backgroundMusicRef} src="https://cdn.pixabay.com/audio/2022/10/17/audio_3b24660749.mp3" id="background-music" loop crossOrigin="anonymous" />
      <video ref={videoRef} src="https://webglfundamentals.org/webgl/resources/hls/tears_of_steel_720p.mp4" loop muted playsInline crossOrigin="anonymous" style={{ display: 'none' }}></video>
    </div>
  );
};

export default App;