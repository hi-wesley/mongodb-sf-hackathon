import { useState, useEffect, useMemo, useRef } from 'react';
import axios from 'axios';
import { motion, AnimatePresence } from 'framer-motion';
import { Clock, CheckCircle2, AlertCircle, Loader2, User, Globe, FileText, Send, Trash2 } from 'lucide-react';

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
  context?: Record<string, any>;
  steps?: Step[];
}

const API_URL = 'http://localhost:3000/api';

function renderMarkdownLite(markdown: string) {
  return markdown
    .split('\n')
    .map((rawLine, index) => {
      const line = rawLine.trimEnd();
      if (!line.trim()) return <div key={index} className="h-2" />;
      if (line.startsWith('# ')) return <div key={index} className="text-lg font-bold text-white">{line.slice(2)}</div>;
      if (line.startsWith('## ')) return <div key={index} className="text-base font-semibold text-white/90">{line.slice(3)}</div>;
      if (line.startsWith('### ')) return <div key={index} className="text-sm font-semibold text-white/80">{line.slice(4)}</div>;
      if (line.startsWith('- ')) {
        return (
          <div key={index} className="flex gap-2 text-sm text-gray-200">
            <span className="text-horizon-accent">•</span>
            <span className="min-w-0 break-words">{line.slice(2)}</span>
          </div>
        );
      }
      return <div key={index} className="text-sm text-gray-200 break-words">{line}</div>;
    });
}

function App() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeWorkflow, setActiveWorkflow] = useState<Workflow | null>(null);
  const [prompt, setPrompt] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  const focusStepRef = useRef<HTMLDivElement | null>(null);

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

  const handleClearMissions = async () => {
    if (isClearing) return;
    const ok = window.confirm('Clear all recent missions? This will delete workflows and steps from the database.');
    if (!ok) return;
    setIsClearing(true);
    try {
      await axios.delete(`${API_URL}/workflows`);
      setWorkflows([]);
      setActiveId(null);
      setActiveWorkflow(null);
    } catch (err) {
      console.error(err);
    } finally {
      setIsClearing(false);
    }
  };

  // Derived active agent
  const steps = activeWorkflow?.steps ?? [];
  const now = Date.now();
  const tripContext = (activeWorkflow?.context ?? {}) as any;

  const runningStep = useMemo(() => steps.find(s => s.status === 'RUNNING'), [steps]);
  const nextPendingStep = useMemo(() => {
    const pending = steps.filter(s => s.status === 'PENDING');
    if (pending.length === 0) return undefined;
    return pending.reduce((earliest, step) => {
      const earliestTime = new Date(earliest.scheduledFor).getTime();
      const stepTime = new Date(step.scheduledFor).getTime();
      if (Number.isNaN(earliestTime)) return step;
      if (Number.isNaN(stepTime)) return earliest;
      return stepTime < earliestTime ? step : earliest;
    });
  }, [steps]);

  const focusStep = runningStep ?? nextPendingStep;
  const focusStepId = focusStep?._id;

  const isSleeping =
    !runningStep &&
    nextPendingStep &&
    new Date(nextPendingStep.scheduledFor).getTime() > now;

  const activeAgent = focusStep?.assignedAgent || 'System';

  useEffect(() => {
    if (!focusStepId) return;
    focusStepRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [focusStepId]);

  const focusTitle = runningStep
    ? 'Running Now'
    : isSleeping
      ? 'Sleeping Until Scheduled Time'
      : nextPendingStep
        ? 'Queued Next'
        : 'Idle';

  const focusWhen = (() => {
    if (!focusStep?.scheduledFor) return null;
    const t = new Date(focusStep.scheduledFor);
    if (Number.isNaN(t.getTime())) return null;
    return t.toLocaleString();
  })();

  return (
    <div className="flex h-screen bg-horizon-bg text-gray-100 font-sans overflow-hidden">
      {/* Sidebar */}
      <div className="w-64 border-r border-gray-800 p-4 flex flex-col bg-horizon-card/50">
        <div className="flex items-center gap-2 mb-8 text-horizon-accent font-bold text-xl">
          <Globe className="w-6 h-6 animate-pulse-slow" />
          <span>AI Plan My Trip Now</span>
        </div>

        <h3 className="text-xs font-semibold text-gray-500 uppercase mb-3 tracking-wider">Recent Missions</h3>
        <div className="mb-3 flex items-center justify-between gap-2">
          <span className="text-[11px] text-gray-600">Manage</span>
          <button
            type="button"
            onClick={handleClearMissions}
            disabled={isClearing || workflows.length === 0}
            className="text-xs px-2 py-1 rounded-md border border-gray-800 bg-black/30 hover:bg-gray-900 text-gray-400 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
            title="Clear missions"
          >
            {isClearing ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Trash2 className="w-3 h-3" />
            )}
            Clear
          </button>
        </div>
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
                      {runningStep ? (
                        <span className="text-green-400 flex items-center gap-1">
                          <Loader2 className="w-3 h-3 animate-spin" /> Processing
                        </span>
                      ) : (
                        <span className="text-gray-500">{focusTitle}</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-4 text-xs text-gray-400 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="uppercase tracking-wider opacity-70">Current Task</span>
                    {focusWhen && <span className="font-mono text-gray-500">{focusWhen}</span>}
                  </div>
                  <div className="text-sm text-white truncate">
                    {focusStep?.name || '—'}
                  </div>
                </div>

                <div className="mt-6 p-4 bg-black/40 rounded-xl border border-gray-800 font-mono text-xs text-green-400 min-h-[100px]">
                  <div className="opacity-50 mb-2">// Agent Logs</div>
                  {runningStep?.logs.slice(-3).map((log, i) => (
                    <div key={i} className="mb-1">{'>'} {log}</div>
                  ))}
                  {runningStep && <span className="animate-pulse">_</span>}
                </div>
              </div>
            </div>

            {/* Mission Timeline (Right) */}
            <div className="col-span-12 lg:col-span-8">
              <div className="bg-horizon-card border border-gray-800 rounded-2xl p-6 min-h-[500px]">
                <h2 className="text-gray-400 text-sm font-semibold uppercase mb-6 tracking-wider flex items-center gap-2">
                  <FileText className="w-4 h-4" /> Mission Control: {activeWorkflow.goal}
                </h2>

                {/* Trip Summary (user-facing results) */}
                {(tripContext.dates ||
                  tripContext.flights ||
                  tripContext.hotels ||
                  tripContext.transport ||
                  tripContext.budget ||
                  tripContext.activities ||
                  tripContext.itineraryMarkdown) && (
                  <div className="mb-6 space-y-3">
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Trip Summary</div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {tripContext.dates?.type === 'dates' && (
                        <div className="bg-black/40 border border-gray-800 rounded-xl p-4">
                          <div className="text-xs text-gray-400 mb-1">Selected Dates</div>
                          <div className="text-white font-semibold">{tripContext.dates.recommendation}</div>
                          {(tripContext.dates.startISO || tripContext.dates.endISO) && (
                            <div className="text-xs text-gray-500 mt-1">
                              {tripContext.dates.startISO ? new Date(tripContext.dates.startISO).toLocaleDateString() : '—'}
                              {' → '}
                              {tripContext.dates.endISO ? new Date(tripContext.dates.endISO).toLocaleDateString() : '—'}
                            </div>
                          )}
                          {tripContext.dates.reason && <div className="text-xs text-gray-500 mt-1">{tripContext.dates.reason}</div>}
                        </div>
                      )}

                      {tripContext.flights?.type === 'flights' && (
                        <div className="bg-black/40 border border-gray-800 rounded-xl p-4">
                          <div className="text-xs text-gray-400 mb-2">Flights (Recommended)</div>
                          {(() => {
                            const idx = tripContext.flights.recommendedIndex ?? 0;
                            const flight = tripContext.flights.options?.[idx] ?? tripContext.flights.options?.[0];
                            if (!flight) return <div className="text-gray-500 text-sm">No flights yet.</div>;
                            return (
                              <div className="flex justify-between items-start gap-3">
                                <div className="min-w-0">
                                  <div className="text-white font-semibold truncate">{flight.airline} {flight.flight}</div>
                                  <div className="text-xs text-gray-500">
                                    {flight.route ? `${flight.route} • ` : ''}{flight.time ? `${flight.time} • ` : ''}{flight.duration}
                                  </div>
                                </div>
                                <div className="text-green-400 font-bold shrink-0">{flight.price}</div>
                              </div>
                            );
                          })()}
                        </div>
                      )}

                      {tripContext.hotels?.type === 'hotels' && (
                        <div className="bg-black/40 border border-gray-800 rounded-xl p-4">
                          <div className="text-xs text-gray-400 mb-2">Accommodation (Recommended)</div>
                          {(() => {
                            const idx = tripContext.hotels.recommendedIndex ?? 0;
                            const hotel = tripContext.hotels.options?.[idx] ?? tripContext.hotels.options?.[0];
                            if (!hotel) return <div className="text-gray-500 text-sm">No hotels yet.</div>;
                            return (
                              <div className="flex justify-between items-start gap-3">
                                <div className="min-w-0">
                                  <div className="text-white font-semibold truncate">{hotel.name}</div>
                                  <div className="text-xs text-gray-500">{hotel.area}</div>
                                  <div className="text-xs text-gray-500">~${hotel.nightlyUsd}/night • {tripContext.hotels.nights} nights</div>
                                </div>
                                <div className="text-green-400 font-bold shrink-0">${hotel.totalUsd}</div>
                              </div>
                            );
                          })()}
                        </div>
                      )}

                      {tripContext.transport?.type === 'transport' && (
                        <div className="bg-black/40 border border-gray-800 rounded-xl p-4">
                          <div className="text-xs text-gray-400 mb-2">Getting Around</div>
                          <div className="space-y-2">
                            {tripContext.transport.options?.slice(0, 4).map((o: any, i: number) => (
                              <div key={i} className="flex items-start justify-between gap-3 text-sm p-2 bg-gray-800/40 rounded border border-gray-800">
                                <div className="min-w-0">
                                  <div className="text-white font-semibold truncate">
                                    <span className="text-horizon-accent">{o.mode}</span>
                                    {' • '}
                                    {o.name}
                                  </div>
                                  <div className="text-xs text-gray-400">{o.details}</div>
                                </div>
                                {o.estimate && <div className="text-xs text-gray-500 shrink-0">{o.estimate}</div>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {tripContext.budget?.type === 'budget' && (
                        <div className="bg-black/40 border border-gray-800 rounded-xl p-4">
                          <div className="text-xs text-gray-400 mb-2">Estimated Budget</div>
                          <div className="text-green-400 font-bold text-lg">{tripContext.budget.total}</div>
                          <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                            {tripContext.budget.breakdown?.slice(0, 4).map((b: any, i: number) => (
                              <div key={i} className="flex justify-between bg-gray-800/50 border border-gray-800 rounded-lg p-2">
                                <span className="text-gray-300">{b.category}</span>
                                <span className="text-white font-mono">{b.amount}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {tripContext.activities?.type === 'events' && (
                        <div className="bg-black/40 border border-gray-800 rounded-xl p-4 md:col-span-2">
                          <div className="text-xs text-gray-400 mb-2">Highlights</div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            {tripContext.activities.items?.slice(0, 8).map((event: any, i: number) => (
                              <div key={i} className="flex items-center gap-2 text-sm text-gray-200 bg-gray-800/30 border border-gray-800 rounded-lg p-2">
                                <span className="text-horizon-accent">•</span>
                                <span className="min-w-0 truncate">{event.name}</span>
                                <span className="text-xs text-gray-500 shrink-0">{event.date}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {typeof tripContext.itineraryMarkdown === 'string' && tripContext.itineraryMarkdown.trim().length > 0 && (
                      <div className="bg-black/40 border border-gray-800 rounded-xl p-4">
                        <div className="text-xs text-gray-400 mb-2">Itinerary</div>
                        <div className="space-y-2">{renderMarkdownLite(tripContext.itineraryMarkdown)}</div>
                      </div>
                    )}
                  </div>
                )}

                <div className="space-y-4">
                  <AnimatePresence>
                    {activeWorkflow.steps?.map((step) => {
                      const isFuture = step.status === 'BLOCKED';
                      const isRunning = step.status === 'RUNNING';
                      const isDone = step.status === 'COMPLETED';
                      const isFailed = step.status === 'FAILED';
                      const isWait = step.name.startsWith('WAIT');
                      const isFocused = step._id === focusStepId;
                      const output = step.output as any;
                      const canRenderOutput =
                        Boolean(output) &&
                        (output.type === 'weather' ||
                          output.type === 'flights' ||
                          output.type === 'hotels' ||
                          output.type === 'transport' ||
                          output.type === 'events' ||
                          output.type === 'dates' ||
                          output.type === 'budget' ||
                          output.type === 'markdown' ||
                          Boolean(output.itineraryMarkdown));

                      return (
                        <motion.div
                          key={step._id}
                          ref={isFocused ? focusStepRef : undefined}
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
                              <div className="flex items-start gap-2 min-w-0">
                                {isRunning ? (
                                  <Loader2 className="w-4 h-4 mt-0.5 text-blue-400 animate-spin shrink-0" />
                                ) : isDone ? (
                                  <CheckCircle2 className="w-4 h-4 mt-0.5 text-green-500 shrink-0" />
                                ) : isFailed ? (
                                  <AlertCircle className="w-4 h-4 mt-0.5 text-red-500 shrink-0" />
                                ) : (
                                  <Clock className="w-4 h-4 mt-0.5 text-gray-500 shrink-0" />
                                )}
                                <h3 className={`font-semibold truncate ${isRunning ? 'text-white' : 'text-gray-300'}`}>
                                  {step.name}
                                </h3>
                              </div>
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
                            {canRenderOutput && (
                              <div className="mt-4 bg-black/50 rounded-lg p-3 border border-gray-700/50">
                                {output.type === 'weather' && (
                                  <div className="flex gap-4 overflow-x-auto">
                                    {output.forecast.map((day: any, i: number) => (
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

                                {output.type === 'flights' && (
                                  <div className="space-y-2">
                                    {output.options.map((flight: any, i: number) => (
                                      <div key={i} className="flex justify-between items-center text-sm p-2 bg-gray-800 rounded border border-gray-700">
                                        <div className="flex flex-col">
                                          <span className="font-bold text-white">{flight.airline}</span>
                                          <span className="text-xs text-gray-400">
                                            {flight.flight}
                                            {flight.time ? ` • ${flight.time}` : ''}
                                          </span>
                                        </div>
                                        <div className="text-right">
                                          <div className="font-bold text-green-400">{flight.price}</div>
                                          <div className="text-xs text-gray-500">{flight.duration}</div>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}

                                {output.type === 'hotels' && (
                                  <div className="space-y-2">
                                    {output.options?.map((hotel: any, i: number) => {
                                      const isRecommended = i === (output.recommendedIndex ?? 0);
                                      return (
                                        <div
                                          key={i}
                                          className={`flex justify-between items-start gap-3 text-sm p-2 rounded border ${isRecommended
                                            ? 'bg-horizon-accent/10 border-horizon-accent/30'
                                            : 'bg-gray-800 rounded border-gray-700'
                                            }`}
                                        >
                                          <div className="min-w-0">
                                            <div className="font-bold text-white truncate">
                                              {hotel.name}
                                              {isRecommended && <span className="text-xs text-horizon-accent ml-2">Recommended</span>}
                                            </div>
                                            <div className="text-xs text-gray-400">{hotel.area}</div>
                                            <div className="text-xs text-gray-500">~${hotel.nightlyUsd}/night • {output.nights} nights</div>
                                          </div>
                                          <div className="text-right shrink-0">
                                            <div className="font-bold text-green-400">${hotel.totalUsd}</div>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}

                                {output.type === 'transport' && (
                                  <div className="space-y-2">
                                    {output.options?.map((o: any, i: number) => (
                                      <div key={i} className="flex items-start justify-between gap-3 text-sm p-2 bg-gray-800 rounded border border-gray-700">
                                        <div className="min-w-0">
                                          <div className="font-bold text-white truncate">
                                            <span className="text-horizon-accent">{o.mode}</span>
                                            {' • '}
                                            {o.name}
                                          </div>
                                          <div className="text-xs text-gray-400">{o.details}</div>
                                        </div>
                                        {o.estimate && (
                                          <div className="text-xs text-gray-500 shrink-0">{o.estimate}</div>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                )}

                                {output.type === 'events' && (
                                  <div className="space-y-1">
                                    {output.items.map((event: any, i: number) => (
                                      <div key={i} className="flex items-center gap-2 text-sm text-gray-300">
                                        <span className="text-horizon-accent">•</span>
                                        <span>{event.name}</span>
                                        <span className="text-xs text-gray-500">({event.date})</span>
                                      </div>
                                    ))}
                                  </div>
                                )}

                                {output.type === 'dates' && (
                                  <div className="text-sm p-2 bg-green-500/10 border border-green-500/30 rounded text-green-300 space-y-1">
                                    <div>📅 <strong>Recommendation:</strong> {output.recommendation}</div>
                                    {(output.startISO || output.endISO) && (
                                      <div className="text-xs text-green-200/80">
                                        {output.startISO ? new Date(output.startISO).toLocaleDateString() : '—'}
                                        {' → '}
                                        {output.endISO ? new Date(output.endISO).toLocaleDateString() : '—'}
                                      </div>
                                    )}
                                    {output.reason && (
                                      <div className="text-xs text-green-200/80">{output.reason}</div>
                                    )}
                                  </div>
                                )}

                                {output.type === 'budget' && (
                                  <div className="space-y-2 text-sm">
                                    <div className="font-bold text-green-400">Total: {output.total}</div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                      {output.breakdown?.map((b: any, i: number) => (
                                        <div key={i} className="flex justify-between items-center p-2 bg-gray-800 rounded border border-gray-700">
                                          <span className="text-gray-300">{b.category}</span>
                                          <span className="font-mono text-white">{b.amount}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {(output.type === 'markdown' || output.itineraryMarkdown) && (
                                  <div className="space-y-2">
                                    {renderMarkdownLite(output.markdown || output.itineraryMarkdown)}
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
