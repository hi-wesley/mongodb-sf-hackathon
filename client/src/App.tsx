import { useState, useEffect } from 'react';
import axios from 'axios';
import { motion, AnimatePresence } from 'framer-motion';
import { Plane, Clock, CheckCircle2, AlertCircle, Loader2, User, Globe, FileText, Send } from 'lucide-react';

// Types
interface Step {
  _id: string;
  name: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'BLOCKED';
  assignedAgent: string;
  scheduledFor: string;
  logs: string[];
  output?: any;
}

interface Workflow {
  _id: string;
  goal: string;
  status: string;
  steps?: Step[];
}

const API_URL = 'http://localhost:3000/api';

function App() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeWorkflow, setActiveWorkflow] = useState<Workflow | null>(null);
  const [prompt, setPrompt] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Poll for workflow list
  useEffect(() => {
    const fetchWorkflows = async () => {
      try {
        const res = await axios.get(`${API_URL}/workflows`);
        setWorkflows(res.data);
        // Auto-select first if none selected
        if (!activeId && res.data.length > 0) setActiveId(res.data[0]._id);
      } catch (err) {
        console.error("Failed to fetch workflows", err);
      }
    };
    fetchWorkflows();
    const interval = setInterval(fetchWorkflows, 2000);
    return () => clearInterval(interval);
  }, [activeId]);

  // Poll for active workflow details
  useEffect(() => {
    if (!activeId) return;

    const fetchDetails = async () => {
      try {
        const res = await axios.get(`${API_URL}/workflows/${activeId}`);
        setActiveWorkflow(res.data);
      } catch (err) {
        console.error("Failed to fetch details", err);
      }
    };
    fetchDetails();
    const interval = setInterval(fetchDetails, 1000); // Fast polling for demo
    return () => clearInterval(interval);
  }, [activeId]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt) return;
    setIsLoading(true);
    try {
      const res = await axios.post(`${API_URL}/workflows`, { prompt });
      setPrompt('');
      setActiveId(res.data.workflowId);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  // Derived active agent
  const activeStep = activeWorkflow?.steps?.find(s => s.status === 'RUNNING');
  const activeAgent = activeStep?.assignedAgent || 'System';

  return (
    <div className="flex h-screen bg-horizon-bg text-gray-100 font-sans overflow-hidden">
      {/* Sidebar */}
      <div className="w-64 border-r border-gray-800 p-4 flex flex-col bg-horizon-card/50">
        <div className="flex items-center gap-2 mb-8 text-horizon-accent font-bold text-xl">
          <Globe className="w-6 h-6 animate-pulse-slow" />
          <span>Event Horizon</span>
        </div>

        <h3 className="text-xs font-semibold text-gray-500 uppercase mb-3 tracking-wider">Recent Missions</h3>
        <div className="flex-1 overflow-y-auto space-y-2">
          {workflows.map(wf => (
            <button
              key={wf._id}
              onClick={() => setActiveId(wf._id)}
              className={`w-full text-left p-3 rounded-lg text-sm transition-all ${activeId === wf._id
                ? 'bg-horizon-accent/10 border border-horizon-accent/30 text-white'
                : 'hover:bg-gray-800 text-gray-400'
                }`}
            >
              <div className="truncate font-medium">{wf.goal}</div>
              <div className="text-xs opacity-60 mt-1">{new Date().toLocaleDateString()}</div>
            </button>
          ))}
        </div>

        <div className="mt-4 pt-4 border-t border-gray-800">
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
            System Online
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden relative">
        {/* Background Grid */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(18,18,23,0.8)_1px,transparent_1px),linear-gradient(90deg,rgba(18,18,23,0.8)_1px,transparent_1px)] bg-[size:40px_40px] opacity-20 pointer-events-none"></div>

        {/* Header / Input */}
        <div className="p-6 border-b border-gray-800 z-10 bg-horizon-bg/80 backdrop-blur-md">
          <form onSubmit={handleCreate} className="max-w-3xl mx-auto relative flex gap-4">
            <div className="relative flex-1">
              <input
                type="text"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Initialize new mission... (e.g. 'Plan a trip to Mars')"
                className="w-full bg-horizon-card border border-gray-700 rounded-xl px-4 py-3 pl-12 focus:ring-2 focus:ring-horizon-accent/50 focus:border-horizon-accent outline-none transition-all placeholder-gray-600"
              />
              <Send className="w-5 h-5 text-gray-500 absolute left-4 top-3.5" />
            </div>
            <button
              disabled={isLoading}
              className="bg-horizon-accent hover:bg-blue-600 text-white px-6 py-3 rounded-xl font-medium transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-blue-500/20"
            >
              {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Launch'}
            </button>
          </form>
        </div>

        {/* Dashboard Grid */}
        {activeWorkflow && (
          <div className="flex-1 p-8 overflow-y-auto max-w-6xl mx-auto w-full z-10 grid grid-cols-12 gap-6">

            {/* Agent Status Panel (Top Left) */}
            <div className="col-span-12 lg:col-span-4 space-y-6">
              <div className="bg-horizon-card border border-gray-800 rounded-2xl p-6 relative overflow-hidden group">
                <div className="absolute inset-0 bg-gradient-to-br from-horizon-accent/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                <h2 className="text-gray-400 text-sm font-semibold uppercase mb-4 tracking-wider flex items-center gap-2">
                  <User className="w-4 h-4" /> Active Agent
                </h2>

                <div className="flex items-center gap-4">
                  <div className={`w-16 h-16 rounded-2xl flex items-center justify-center text-2xl shadow-xl transition-all duration-500 ${activeAgent !== 'System'
                    ? 'bg-gradient-to-tr from-blue-600 to-cyan-400 shadow-blue-500/30 scale-110'
                    : 'bg-gray-800 text-gray-600'
                    }`}>
                    {activeAgent === 'System' ? '🤖' : '🕵️'}
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-white mb-1">
                      {activeAgent}
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      {activeStep ? (
                        <span className="text-green-400 flex items-center gap-1">
                          <Loader2 className="w-3 h-3 animate-spin" /> Processing
                        </span>
                      ) : (
                        <span className="text-gray-500">Idle</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-6 p-4 bg-black/40 rounded-xl border border-gray-800 font-mono text-xs text-green-400 min-h-[100px]">
                  <div className="opacity-50 mb-2">// Agent Logs</div>
                  {activeStep?.logs.slice(-3).map((log, i) => (
                    <div key={i} className="mb-1">{'>'} {log}</div>
                  ))}
                  {activeStep && <span className="animate-pulse">_</span>}
                </div>
              </div>
            </div>

            {/* Mission Timeline (Right) */}
            <div className="col-span-12 lg:col-span-8">
              <div className="bg-horizon-card border border-gray-800 rounded-2xl p-6 min-h-[500px]">
                <h2 className="text-gray-400 text-sm font-semibold uppercase mb-6 tracking-wider flex items-center gap-2">
                  <FileText className="w-4 h-4" /> Mission Control: {activeWorkflow.goal}
                </h2>

                <div className="space-y-4">
                  <AnimatePresence>
                    {activeWorkflow.steps?.map((step, index) => {
                      const isFuture = step.status === 'BLOCKED';
                      const isRunning = step.status === 'RUNNING';
                      const isDone = step.status === 'COMPLETED';
                      const isWait = step.name.startsWith('WAIT');

                      return (
                        <motion.div
                          key={step._id}
                          initial={{ opacity: 0, x: 20 }}
                          animate={{ opacity: 1, x: 0 }}
                          className={`relative pl-8 pb-8 last:pb-0 border-l ${isDone ? 'border-green-500/50' : 'border-gray-800'
                            }`}
                        >
                          {/* Timeline Dot */}
                          <div className={`absolute -left-[9px] top-0 w-[18px] h-[18px] rounded-full border-4 transition-colors ${isRunning ? 'border-blue-500 bg-black animate-pulse shadow-[0_0_10px_rgba(59,130,246,0.5)]' :
                            isDone ? 'border-green-500 bg-green-500' :
                              'border-gray-700 bg-gray-900'
                            }`}></div>

                          <div className={`p-4 rounded-xl border transition-all ${isRunning
                            ? 'bg-horizon-accent/5 border-horizon-accent/30 shadow-lg'
                            : 'bg-gray-800/30 border-gray-800'
                            } ${isFuture ? 'opacity-50 grayscale' : ''}`}>

                            <div className="flex justify-between items-start mb-2">
                              <h3 className={`font-semibold ${isRunning ? 'text-white' : 'text-gray-300'}`}>
                                {step.name}
                              </h3>
                              <div className="text-xs font-mono px-2 py-1 rounded bg-black/20 border border-white/5 text-gray-500">
                                {step.assignedAgent}
                              </div>
                            </div>

                            {isWait && !isDone && (
                              <div className="flex items-center gap-2 text-yellow-500 text-sm mt-2">
                                <Clock className="w-4 h-4 animate-spin-slow" />
                                <span>Waiting for schedule...</span>
                              </div>
                            )}

                            {/* RICH OUTPUT DISPLAY */}
                            {step.output && (
                              <div className="mt-4 bg-black/50 rounded-lg p-3 border border-gray-700/50">
                                {step.output.type === 'weather' && (
                                  <div className="flex gap-4 overflow-x-auto">
                                    {step.output.forecast.map((day: any, i: number) => (
                                      <div key={i} className="flex flex-col items-center min-w-[80px] p-2 bg-gray-800 rounded">
                                        <span className="text-xs text-gray-400">{day.date}</span>
                                        {day.condition.includes('Sun') ? <div className="text-yellow-400 text-2xl">☀️</div> :
                                          day.condition.includes('Cloud') ? <div className="text-gray-400 text-2xl">☁️</div> :
                                            <div className="text-blue-400 text-2xl">🌧️</div>}
                                        <span className="font-bold">{day.temp}°F</span>
                                      </div>
                                    ))}
                                  </div>
                                )}

                                {step.output.type === 'flights' && (
                                  <div className="space-y-2">
                                    {step.output.options.map((flight: any, i: number) => (
                                      <div key={i} className="flex justify-between items-center text-sm p-2 bg-gray-800 rounded border border-gray-700">
                                        <div className="flex flex-col">
                                          <span className="font-bold text-white">{flight.airline}</span>
                                          <span className="text-xs text-gray-400">{flight.flight}</span>
                                        </div>
                                        <div className="text-right">
                                          <div className="font-bold text-green-400">{flight.price}</div>
                                          <div className="text-xs text-gray-500">{flight.duration}</div>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}

                                {step.output.type === 'events' && (
                                  <div className="space-y-1">
                                    {step.output.items.map((event: any, i: number) => (
                                      <div key={i} className="flex items-center gap-2 text-sm text-gray-300">
                                        <span className="text-horizon-accent">•</span>
                                        <span>{event.name}</span>
                                        <span className="text-xs text-gray-500">({event.date})</span>
                                      </div>
                                    ))}
                                  </div>
                                )}

                                {step.output.type === 'dates' && (
                                  <div className="text-sm p-2 bg-green-500/10 border border-green-500/30 rounded text-green-300">
                                    📅 <strong>Recommendation:</strong> {step.output.recommendation}
                                  </div>
                                )}
                              </div>
                            )}

                            {isRunning && (
                              <div className="h-1 w-full bg-gray-800 rounded-full mt-3 overflow-hidden">
                                <div className="h-full bg-blue-500 animate-progress-indeterminate"></div>
                              </div>
                            )}
                          </div>
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                </div>
              </div>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}

export default App;
