import React, { useState, useEffect, useRef } from 'react';
import { Activity, AlertTriangle, Terminal, Satellite, Play, ShieldAlert, Edit3, WifiOff, BookOpen, Globe } from 'lucide-react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Sphere, Stars } from '@react-three/drei';

// --- 3D ORBITAL VIEWPORT COMPONENT ---
function OrbitalScene({ scenario, collisionWarning }) {
  const satRef = useRef();
  const earthRef = useRef();
  const debrisRef = useRef();

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    
    // Rotate Earth slowly
    if (earthRef.current) {
      earthRef.current.rotation.y = t * 0.02;
    }
    
    // Orbit Main Satellite
    if (satRef.current) {
      satRef.current.position.x = Math.cos(t * 0.3) * 2.2;
      satRef.current.position.z = Math.sin(t * 0.3) * 2.2;
      satRef.current.rotation.y = -t * 0.3;
      
      // Visual Simulator: If AOCS fails, the satellite physically tumbles!
      if (scenario === 'AOCS_FAILURE') {
         satRef.current.rotation.x = t * 2;
         satRef.current.rotation.z = t * 1.5;
      } else {
         satRef.current.rotation.x = 0;
         satRef.current.rotation.z = 0;
      }
    }

    // Orbit Debris on an intercept trajectory
    if (debrisRef.current) {
        debrisRef.current.position.x = Math.cos(t * 0.3 + 0.15) * 2.3;
        debrisRef.current.position.z = Math.sin(t * 0.3 + 0.15) * 2.3;
        debrisRef.current.rotation.x = t;
        debrisRef.current.rotation.y = t;
    }
  });

  return (
    <>
      <ambientLight intensity={0.2} />
      <pointLight position={[10, 10, 10]} intensity={1.5} color="#4ade80" />
      <Stars radius={50} depth={50} count={1000} factor={3} saturation={0} fade speed={1} />
      
      {/* Allows the user to click and drag to look around */}
      <OrbitControls enableZoom={false} autoRotate={false} />

      {/* Earth (Solid Core + Cyberpunk Wireframe Grid) */}
      <group ref={earthRef}>
        <Sphere args={[1.2, 32, 32]}>
          <meshStandardMaterial color="#020617" wireframe={false} />
        </Sphere>
        <Sphere args={[1.22, 16, 16]}>
          <meshBasicMaterial color="#06b6d4" wireframe={true} transparent opacity={0.15} />
        </Sphere>
      </group>

      {/* Target Spacecraft */}
      <group ref={satRef}>
        {/* Core Body */}
        <mesh>
          <boxGeometry args={[0.15, 0.15, 0.15]} />
          <meshStandardMaterial color={scenario === 'ECLIPSE_ANOMALY' ? '#ef4444' : '#10b981'} />
        </mesh>
        {/* Solar Panel 1 */}
        <mesh position={[0.2, 0, 0]}>
          <boxGeometry args={[0.25, 0.02, 0.15]} />
          <meshStandardMaterial color="#3b82f6" />
        </mesh>
        {/* Solar Panel 2 */}
        <mesh position={[-0.2, 0, 0]}>
          <boxGeometry args={[0.25, 0.02, 0.15]} />
          <meshStandardMaterial color="#3b82f6" />
        </mesh>
      </group>

      {/* Hazardous Space Debris (Only renders if AI detects a threat) */}
      {collisionWarning && (
        <mesh ref={debrisRef}>
           <dodecahedronGeometry args={[0.06]} />
           <meshStandardMaterial color="#ef4444" emissive="#ef4444" emissiveIntensity={0.8} />
        </mesh>
      )}
    </>
  );
}

// --- MAIN DASHBOARD APP ---
export default function App() {
  const [telemetry, setTelemetry] = useState({});
  const [diagnosis, setDiagnosis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [scenario, setScenario] = useState("NOMINAL");
  
  const [selectedImage, setSelectedImage] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [debrisData, setDebrisData] = useState(null);
  const [isScanning, setIsScanning] = useState(false);

  const [manualForm, setManualForm] = useState({
    EPS_Bus_Voltage_V: 28.0,
    EPS_Solar_Current_A: 15.0,
    EPS_Battery_Temp_C: 12.0,
    AOCS_Gyro_Drift_deg_s: 0.02,
    Orbital_Status: "Sunlit"
  });

  useEffect(() => {
    const interval = setInterval(() => {
      fetch('http://localhost:8000/api/telemetry')
        .then(res => res.json())
        .then(data => setTelemetry(data))
        .catch(err => console.error("Telemetry offline", err));
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const changeScenario = async (newScenario) => {
    setScenario(newScenario);
    try {
      await fetch('http://localhost:8000/api/scenario', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario: newScenario })
      });
      setDiagnosis(null);
    } catch (err) {
      console.error("Scenario toggle failed", err);
    }
  };

  const toggleUplink = async () => {
    const newStatus = telemetry.Uplink_Status === "AOS" ? "LOS" : "AOS";
    try {
      await fetch('http://localhost:8000/api/uplink', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });
      setTelemetry(prev => ({...prev, Uplink_Status: newStatus}));
    } catch (err) {
      console.error("Uplink toggle failed", err);
    }
  };

  const submitManualData = async () => {
    try {
      await fetch('http://localhost:8000/api/manual-override', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          EPS_Bus_Voltage_V: parseFloat(manualForm.EPS_Bus_Voltage_V),
          EPS_Solar_Current_A: parseFloat(manualForm.EPS_Solar_Current_A),
          EPS_Battery_Temp_C: parseFloat(manualForm.EPS_Battery_Temp_C),
          AOCS_Gyro_Drift_deg_s: parseFloat(manualForm.AOCS_Gyro_Drift_deg_s),
          Orbital_Status: manualForm.Orbital_Status
        })
      });
      setScenario("MANUAL");
      setDiagnosis(null);
    } catch (err) {
      console.error("Manual override failed", err);
    }
  };

  const runDiagnostic = async () => {
    setLoading(true);
    try {
      const res = await fetch('http://localhost:8000/api/diagnose', { method: 'POST' });
      const data = await res.json();
      setDiagnosis(data);
    } catch (error) {
      console.error("Diagnostic failed", error);
    }
    setLoading(false);
  };

  const runDebrisScan = async () => {
    if (!selectedImage) return;
    setIsScanning(true);
    const formData = new FormData();
    formData.append("file", selectedImage);
    try {
      const res = await fetch("http://localhost:8000/api/detect-debris", {
        method: "POST",
        body: formData
      });
      const data = await res.json();
      setDebrisData(data);
    } catch (err) {
      console.error("Debris scan failed", err);
    }
    setIsScanning(false);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 font-mono">
      
      <header className="flex flex-wrap justify-between items-center border-b border-slate-800 pb-4 mb-6 gap-4">
        <div className="flex items-center gap-3 text-cyan-400">
          <Satellite size={32} />
          <div>
            <h1 className="text-xl font-bold tracking-widest uppercase">INSAT-AI-OPS // MISSION CONTROL</h1>
            <p className="text-xs text-slate-400">Subsystem Telemetry Co-Pilot & Recovery Terminal</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button 
            onClick={toggleUplink} 
            className={`flex items-center gap-2 px-3 py-1 rounded text-xs border cursor-pointer transition-all ${telemetry.Uplink_Status === 'LOS' ? 'text-rose-400 bg-rose-950/40 border-rose-800 animate-pulse' : 'text-emerald-400 bg-emerald-950/40 border-emerald-800 hover:bg-emerald-900/60'}`}
          >
            {telemetry.Uplink_Status === 'LOS' ? <><WifiOff size={14} /> LOS: BLACKOUT (AUTO-MODE)</> : <><Activity size={14} /> AOS: UPLINK ACTIVE</>}
          </button>
          <span className="text-xs text-slate-400 border border-slate-800 px-3 py-1 rounded">
            ORBIT: LEO 550km
          </span>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column Container */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* NEW: 3D ORBITAL VIEWPORT */}
          <div className="bg-slate-900/90 border border-slate-800 p-1 rounded-lg shadow-xl relative overflow-hidden">
            <div className="absolute top-4 left-4 z-10 pointer-events-none flex items-center gap-2 text-cyan-400">
              <Globe size={16} />
              <h2 className="text-sm font-semibold uppercase tracking-wider">3D Orbital Situational Awareness</h2>
            </div>
            {/* The 3D Canvas rendering engine */}
            <div className="h-[280px] w-full bg-black rounded">
              <Canvas camera={{ position: [0, 1.5, 4], fov: 45 }}>
                <OrbitalScene scenario={scenario} collisionWarning={debrisData?.collision_warning} />
              </Canvas>
            </div>
            <div className="absolute bottom-4 left-4 z-10 pointer-events-none">
              <p className="text-[10px] text-slate-400 uppercase tracking-widest">DRAG TO ROTATE VIEWPORT</p>
            </div>
          </div>
          
          {/* Telemetry Matrix */}
          <div className="bg-slate-900/90 border border-slate-800 p-5 rounded-lg shadow-xl">
            <h2 className="text-sm font-semibold text-cyan-400 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Activity size={16} /> Subsystem Telemetry Matrix
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {Object.entries(telemetry).map(([key, value]) => {
                if(key === "Uplink_Status") return null; 
                const isAnomaly = typeof value === 'number' && (value === 0 || value > 40 || (key.includes("Gyro") && value > 1.0));
                return (
                  <div key={key} className="bg-slate-950 p-4 rounded border border-slate-800 flex justify-between items-center">
                    <div>
                      <p className="text-xs text-slate-400 font-medium uppercase">{key.replace(/_/g, ' ')}</p>
                      <p className="text-xs text-slate-600">Nominal range tracked</p>
                    </div>
                    <span className={`text-lg font-bold font-mono px-2 py-1 rounded ${isAnomaly ? 'text-rose-400 bg-rose-950/50 border border-rose-800 animate-pulse' : 'text-emerald-400 bg-emerald-950/30'}`}>
                      {value}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="bg-slate-900/90 border border-slate-800 p-5 rounded-lg">
            <h2 className="text-sm font-semibold text-amber-400 uppercase tracking-wider mb-3 flex items-center gap-2">
              <AlertTriangle size={16} /> Anomaly Injection Simulator
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <button 
                onClick={() => changeScenario("NOMINAL")} 
                className={`p-3 rounded text-xs font-bold transition-all ${scenario === "NOMINAL" ? "bg-emerald-600 text-white ring-2 ring-emerald-400" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}>
                1. Nominal Orbit State
              </button>
              <button 
                onClick={() => changeScenario("ECLIPSE_ANOMALY")} 
                className={`p-3 rounded text-xs font-bold transition-all ${scenario === "ECLIPSE_ANOMALY" ? "bg-rose-600 text-white ring-2 ring-rose-400" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}>
                2. Inject EPS Power Anomaly
              </button>
              <button 
                onClick={() => changeScenario("AOCS_FAILURE")} 
                className={`p-3 rounded text-xs font-bold transition-all ${scenario === "AOCS_FAILURE" ? "bg-amber-600 text-white ring-2 ring-amber-400" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}>
                3. Inject AOCS Gyro Drift
              </button>
            </div>
          </div>

          <div className="bg-slate-900/90 border border-slate-800 p-5 rounded-lg shadow-xl">
            <h2 className="text-sm font-semibold text-indigo-400 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Edit3 size={16} /> Manual Telemetry Override
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
              {Object.keys(manualForm).map((key) => (
                <div key={key} className="flex flex-col gap-1">
                  <label className="text-xs text-slate-400 uppercase">{key.replace(/_/g, ' ')}</label>
                  {key === "Orbital_Status" ? (
                    <select 
                      value={manualForm[key]}
                      onChange={(e) => setManualForm({...manualForm, [key]: e.target.value})}
                      className="bg-slate-950 border border-slate-800 rounded p-2 text-sm text-cyan-400 focus:outline-none focus:border-indigo-500"
                    >
                      <option value="Sunlit">Sunlit</option>
                      <option value="Eclipse">Eclipse</option>
                    </select>
                  ) : (
                    <input 
                      type="number" 
                      step="0.01"
                      value={manualForm[key]}
                      onChange={(e) => setManualForm({...manualForm, [key]: e.target.value})}
                      className="bg-slate-950 border border-slate-800 rounded p-2 text-sm text-cyan-400 focus:outline-none focus:border-indigo-500"
                    />
                  )}
                </div>
              ))}
            </div>
            <button 
              onClick={submitManualData}
              className={`w-full py-2 rounded text-xs font-bold uppercase transition-all ${scenario === "MANUAL" ? "bg-indigo-600 text-white ring-2 ring-indigo-400" : "bg-slate-800 text-indigo-400 hover:bg-slate-700"}`}
            >
              Push Manual Override to Subsystems
            </button>
          </div>

          <div className="bg-slate-900/90 border border-slate-800 p-5 rounded-lg shadow-xl">
            <h2 className="text-sm font-semibold text-purple-400 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Satellite size={16} /> Hybrid AI Vision Scanner
            </h2>
            
            <div className="flex flex-col md:flex-row gap-6">
              <div className="flex-1 space-y-4">
                <input 
                  type="file" 
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files[0];
                    if(file) {
                      setSelectedImage(file);
                      setPreviewUrl(URL.createObjectURL(file));
                      setDebrisData(null);
                    }
                  }}
                  className="block w-full text-xs text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-slate-800 file:text-cyan-400 hover:file:bg-slate-700 cursor-pointer"
                />
                
                {previewUrl && (
                  <div className="relative border border-slate-700 rounded bg-black min-h-[200px] flex items-center justify-center overflow-hidden">
                    <img src={previewUrl} alt="Orbital Feed" className="w-full h-auto max-h-[300px] object-contain" />
                    
                    {debrisData && debrisData.conjunction_data.map((obj, idx) => {
                      const isGemini = obj.source === "Gemini";
                      const borderColor = obj.critical ? '#ef4444' : (isGemini ? '#10b981' : '#3b82f6');
                      const bgColor = obj.critical ? 'rgba(239, 68, 68, 0.2)' : (isGemini ? 'rgba(16, 185, 129, 0.2)' : 'rgba(59, 130, 246, 0.2)');
                      
                      return (
                        <div key={idx} style={{
                          position: 'absolute',
                          left: `${obj.bbox[0]}%`,
                          top: `${obj.bbox[1]}%`,
                          width: `${obj.bbox[2] - obj.bbox[0]}%`,
                          height: `${obj.bbox[3] - obj.bbox[1]}%`,
                          border: `2px solid ${borderColor}`,
                          backgroundColor: bgColor
                        }}>
                          <span className="absolute -top-4 left-0 text-[9px] font-bold bg-black px-1 whitespace-nowrap" style={{color: borderColor}}>
                            {obj.label}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}

                <button 
                  onClick={runDebrisScan}
                  disabled={!selectedImage || isScanning}
                  className="w-full bg-purple-600 hover:bg-purple-500 disabled:bg-slate-800 disabled:text-slate-500 text-white py-2 rounded text-xs font-bold uppercase transition-all cursor-pointer"
                >
                  {isScanning ? "PROCESSING HYBRID AI INFERENCE..." : "SCAN OPTICAL FEED"}
                </button>
              </div>

              <div className="flex-1 space-y-4">
                {debrisData ? (
                  <div className="space-y-3">
                    <div className={`p-3 rounded border ${debrisData.collision_warning ? 'bg-rose-950/40 border-rose-800' : 'bg-emerald-950/40 border-emerald-800'}`}>
                      <p className="text-xs uppercase font-semibold mb-1">Conjunction Status</p>
                      <p className={`text-lg font-bold ${debrisData.collision_warning ? 'text-rose-400' : 'text-emerald-400'}`}>
                        {debrisData.collision_warning ? "CRITICAL EVASION REQUIRED" : "TRAJECTORY CLEAR"}
                      </p>
                    </div>

                    <div className="bg-black border border-slate-800 p-3 rounded h-40 overflow-y-auto">
                      <p className="text-xs text-cyan-400 uppercase font-semibold mb-2">Target Metrics</p>
                      {debrisData.conjunction_data.length === 0 ? (
                        <p className="text-xs text-slate-500">No objects detected.</p>
                      ) : (
                        debrisData.conjunction_data.map((obj, i) => (
                          <div key={i} className="flex justify-between text-xs border-b border-slate-800 py-2 last:border-0 text-slate-300">
                            <div className="flex flex-col">
                              <span className={`font-semibold ${obj.source === "Gemini" ? 'text-emerald-400' : 'text-blue-400'}`}>
                                {obj.label}
                              </span>
                              <span>Est. Distance: {obj.estimated_distance_km}km</span>
                            </div>
                            <span className={`self-center ${obj.critical ? 'text-rose-400 font-bold' : ''}`}>
                              TCA: {obj.time_to_impact_s}s
                            </span>
                          </div>
                        ))
                      )}
                    </div>

                    {debrisData.collision_warning && (
                      <div className="bg-black border border-slate-800 p-3 rounded">
                        <p className="text-xs text-amber-400 uppercase font-semibold mb-1">AOCS Override</p>
                        <pre className="text-emerald-400 text-xs whitespace-pre-wrap">{debrisData.recommended_maneuver}</pre>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="h-full flex items-center justify-center border border-dashed border-slate-800 rounded text-slate-500 text-xs p-4 text-center">
                    Upload an optical feed image to initiate Conjunction Assessment.
                  </div>
                )}
              </div>
            </div>
          </div>

        </div>

        <div className="space-y-6">
          <div className="bg-slate-900/90 border border-slate-800 p-5 rounded-lg flex flex-col h-full shadow-xl">
            <h2 className="text-sm font-semibold text-cyan-400 uppercase tracking-wider mb-3 flex items-center gap-2">
              <ShieldAlert size={16} /> AI Diagnostic Co-Pilot
            </h2>
            
            <button 
              onClick={runDiagnostic}
              disabled={loading}
              className="w-full bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-800 disabled:text-slate-500 text-white py-3 rounded text-xs font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2 mb-4 cursor-pointer"
            >
              <Play size={14} /> {loading ? "CORRELATING TELEMETRY..." : "RUN CROSS-VARIABLE DIAGNOSIS"}
            </button>

            {diagnosis ? (
              <div className="space-y-4 flex-1">
                <div className="p-3 bg-rose-950/40 border border-rose-800 rounded">
                  <p className="text-xs text-rose-400 uppercase font-semibold">Fault Classification</p>
                  <p className="text-sm font-bold text-slate-100">{diagnosis.Fault_Name}</p>
                </div>

                {diagnosis.Cited_Standard && (
                  <div className="p-2 bg-indigo-950/40 border border-indigo-800 rounded flex items-start gap-2">
                    <BookOpen size={14} className="text-indigo-400 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-[10px] text-indigo-400 uppercase font-bold tracking-wider mb-0.5">Vector Database Retrieval</p>
                      <p className="text-xs text-slate-300 font-mono">{diagnosis.Cited_Standard}</p>
                    </div>
                  </div>
                )}
                
                <div className="p-3 bg-slate-950 border border-slate-800 rounded">
                  <p className="text-xs text-amber-400 uppercase font-semibold">Correlation Rationale</p>
                  <p className="text-xs text-slate-300 leading-relaxed mt-1">{diagnosis.Correlated_Evidence}</p>
                </div>

                <div className="p-3 bg-black border border-slate-800 rounded">
                  <p className="text-xs text-cyan-400 uppercase font-semibold flex items-center gap-1.5 mb-1.5">
                    <Terminal size={14}/> Onboard Remediation Command
                  </p>
                  <pre className={`${diagnosis.Hardware_Execution_Command.includes("AUTO") ? "text-rose-400 bg-rose-950/20" : "text-emerald-400 bg-slate-950"} text-xs p-2 rounded overflow-x-auto border border-slate-800`}>
                    <code>{diagnosis.Hardware_Execution_Command}</code>
                  </pre>
                  
                  {diagnosis.Hardware_Execution_Command.includes("AWAITING") && (
                    <button className="mt-3 w-full bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-400 border border-emerald-800 py-2 rounded text-xs font-bold transition-all cursor-pointer">
                      AUTHORIZE COMMAND UPLINK
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center border border-dashed border-slate-800 rounded p-6 text-center">
                <p className="text-xs text-slate-500">Awaiting telemetry scan trigger or anomaly injection.</p>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}