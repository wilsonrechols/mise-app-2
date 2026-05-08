import { useState, useRef, useEffect, useCallback } from 'react';
import { Sparkles, Send, X, ChevronDown, ChevronUp, Check, Loader2, ChevronRight } from 'lucide-react';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'https://mise-sync-311883254950.us-central1.run.app';

async function callAI(prompt, options = {}) {
  const model = options.smart ? 'claude-sonnet-4-6' : 'claude-haiku-4-5-20251001';
  const body = { model, max_tokens: options.maxTokens || 2000, messages: [{ role: 'user', content: prompt }] };
  const r = await fetch(`${SERVER_URL}/ai`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(`AI error ${r.status}: ${e.error?.message || JSON.stringify(e)}`); }
  const d = await r.json();
  return d.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
}

function extractJSON(text) {
  let clean = text.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
  const am = clean.match(/\[[\s\S]*\]/), om = clean.match(/\{[\s\S]*\}/);
  if (am && (!om || am.index < om.index)) clean = am[0]; else if (om) clean = om[0];
  return JSON.parse(clean);
}

const DAYS_KEYS = ['mon','tue','wed','thu','fri','sat','sun'];
const DAYS_LABEL = { mon:'Mon', tue:'Tue', wed:'Wed', thu:'Thu', fri:'Fri', sat:'Sat', sun:'Sun' };
const MEALS_LIST = ['breakfast','lunch','dinner'];

function detectIntent(text) {
  const t = text.toLowerCase();
  if (/\b(plan|schedule|what.*week|week.*meal|meal.*plan|\d+\s*days?\s*(of\s*)?(meal|food))/i.test(t)) return 'plan';
  if (/\b(prep|prepare|make ahead|before (dinner|lunch|breakfast)|what can (i|we) (make|cook|prep))/i.test(t)) return 'prep';
  if (/\b(log|ate|had|just (ate|had)|for (breakfast|lunch|dinner) (i|we))/i.test(t)) return 'log';
  return 'general';
}

function getTodayDayKeyLocal() {
  return ['sun','mon','tue','wed','thu','fri','sat'][new Date().getDay()];
}

function buildContextBlock(recipes, mealPlan, mealHistory, currentWeek, weekPrepGuide) {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const dayStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  const todayKey = getTodayDayKeyLocal();
  const weekPlan = mealPlan[currentWeek] || {};

  const recipeSummaries = Object.values(recipes).map(r =>
    `"${r.name}" (${r.cuisine || '?'}, ${(r.prepTime||0)+(r.cookTime||0)}min, id:${r.id})`
  );

  const planLines = DAYS_KEYS.map(dk => {
    const dp = weekPlan[dk] || {};
    const meals = MEALS_LIST.map(m => {
      const s = dp[m];
      if (!s) return `${m}: empty`;
      if (s.slotType === 'eating_out') return `${m}: eating out (${s.label || 'restaurant'})`;
      if (s.leftoverFrom) return `${m}: leftovers from ${s.leftoverFrom.day} ${s.leftoverFrom.meal}`;
      const r = recipes[s.recipeId || s];
      return `${m}: ${r ? r.name : 'unknown recipe'}`;
    });
    return `  ${DAYS_LABEL[dk]}: ${meals.join(' | ')}`;
  });

  const cutoff = Date.now() - 60 * 86400000;
  const recent = (mealHistory || []).filter(h => h.date >= cutoff);
  const outCount = recent.filter(h => h.slotType === 'eating_out').length;
  const outPct = recent.length > 0 ? Math.round(outCount / recent.length * 100) : 0;
  const recentMeals = recent.slice(-30).map(h =>
    `${new Date(h.date).toLocaleDateString()} ${h.meal}: ${h.label}${h.slotType === 'eating_out' ? ' (out)' : ''}`
  );
  const prepLine = weekPrepGuide && !weekPrepGuide.empty && !weekPrepGuide.error
    ? 'Exists - ' + (weekPrepGuide.intro || '') : 'None generated';

  return [
    `CURRENT TIME: ${timeStr}, ${dayStr}`,
    `TODAY: ${todayKey}`,
    '',
    `RECIPE LIBRARY (${recipeSummaries.length} recipes):`,
    recipeSummaries.slice(0, 60).join('\n') || 'None yet',
    '',
    `CURRENT WEEK PLAN (week of ${currentWeek}):`,
    planLines.join('\n'),
    '',
    `RECENT MEAL HISTORY (last 60 days, eating out ${outPct}% of meals):`,
    recentMeals.slice(-20).join('\n') || 'No history',
    '',
    `WEEKLY PREP GUIDE: ${prepLine}`,
  ].join('\n');
}

function resolveSlot(slot, recipes) {
  if (!slot) return { type: 'empty', label: '' };
  if (typeof slot === 'string') { const r = recipes[slot]; return { type: 'recipe', label: r ? r.name : slot, recipeId: slot }; }
  if (slot.slotType === 'eating_out') return { type: 'out', label: slot.label || 'Eating out' };
  if (slot.leftoverFrom) return { type: 'leftover', label: `Leftover (${slot.leftoverFrom.day} ${slot.leftoverFrom.meal})` };
  const r = recipes[slot.recipeId];
  return { type: 'recipe', label: r ? r.name : 'Unknown', recipeId: slot.recipeId };
}

function planToRows(plan, recipes) {
  return DAYS_KEYS.map(dk => {
    const dp = (plan && plan[dk]) || {};
    return { dayKey: dk, dayLabel: DAYS_LABEL[dk], breakfast: resolveSlot(dp.breakfast, recipes), lunch: resolveSlot(dp.lunch, recipes), dinner: resolveSlot(dp.dinner, recipes) };
  });
}

function MealPlanPreview({ draftPlan, recipes, onSwap, onApply, applying }) {
  const rows = planToRows(draftPlan, recipes);
  const todayKey = getTodayDayKeyLocal();
  return (
    <div className="mt-3 bg-white border border-stone-200 rounded-2xl overflow-hidden">
      <div className="px-4 pt-4 pb-2 border-b border-stone-100 flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-stone-500 font-medium">7-day plan preview</span>
        <span className="text-[10px] text-stone-400">tap any slot to swap</span>
      </div>
      <div className="divide-y divide-stone-100">
        {rows.map(({ dayKey, dayLabel, breakfast, lunch, dinner }) => {
          const isToday = dayKey === todayKey;
          return (
            <div key={dayKey} className={`px-4 py-2.5 ${isToday ? 'bg-orange-50/50' : ''}`}>
              <div className="flex items-start gap-3">
                <span className={`text-xs font-medium w-9 flex-shrink-0 mt-0.5 ${isToday ? 'text-orange-700' : 'text-stone-400'}`}>
                  {dayLabel}{isToday ? ' *' : ''}
                </span>
                <div className="flex-1 grid grid-cols-3 gap-1.5">
                  {[breakfast, lunch, dinner].map((slot, mi) => {
                    const mealName = MEALS_LIST[mi];
                    return (
                      <button key={mealName} onClick={() => onSwap(dayKey, mealName, slot)}
                        className={`text-left px-2 py-1.5 rounded-lg text-xs transition-colors ${slot.type === 'empty' ? 'border border-dashed border-stone-200 text-stone-400 hover:border-stone-400' : slot.type === 'out' ? 'bg-amber-50 text-amber-800 border border-amber-100 hover:bg-amber-100' : 'bg-stone-50 text-stone-700 border border-stone-100 hover:bg-stone-100'}`}>
                        <div className="text-[9px] uppercase tracking-wider mb-0.5 opacity-60">{mealName}</div>
                        <div className="leading-tight truncate">{slot.type === 'empty' ? '+ add' : slot.label}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="px-4 py-3 border-t border-stone-100 flex gap-2">
        <button onClick={onApply} disabled={applying}
          className="flex items-center gap-2 px-4 py-2 rounded-full bg-orange-700 text-white text-sm hover:bg-orange-800 disabled:opacity-60">
          {applying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          Apply to week
        </button>
        <span className="text-xs text-stone-400 self-center">overwrites current week plan</span>
      </div>
    </div>
  );
}

function SlotSwapModal({ day, meal, recipeList, onSave, onClose }) {
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState('recipe');
  const [eoLabel, setEoLabel] = useState('');
  const filtered = recipeList.filter(r => !search.trim() || r.name.toLowerCase().includes(search.toLowerCase()));
  return (
    <div className="fixed inset-0 bg-stone-900/40 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div className="bg-stone-50 rounded-2xl p-4 w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h4 className="font-display text-lg">{DAYS_LABEL[day]} - {meal}</h4>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-stone-200 text-stone-500"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex gap-1 mb-3 p-1 bg-stone-100 rounded-full">
          {[['recipe','Recipe'],['out','Eating out'],['clear','Clear']].map(([id,lbl]) => (
            <button key={id} onClick={() => setMode(id)} className={`flex-1 px-2 py-1 rounded-full text-xs font-medium ${mode === id ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500'}`}>{lbl}</button>
          ))}
        </div>
        {mode === 'recipe' && (
          <>
            <input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Search recipes..." className="w-full px-3 py-2 bg-white border border-stone-200 rounded-lg text-sm mb-2 focus:outline-none focus:border-stone-400" />
            <div className="max-h-56 overflow-y-auto space-y-1">
              {filtered.map(r => (
                <button key={r.id} onClick={() => onSave({ recipeId: r.id, slotType: 'recipe', multiplier: 1 })} className="w-full text-left px-3 py-2 rounded-lg hover:bg-stone-100 text-sm">
                  {r.name}<span className="text-xs text-stone-400 ml-2">{r.cuisine}</span>
                </button>
              ))}
              {filtered.length === 0 && <p className="text-sm text-stone-400 text-center py-4">No matches</p>}
            </div>
          </>
        )}
        {mode === 'out' && (
          <div className="space-y-3">
            <input autoFocus value={eoLabel} onChange={e => setEoLabel(e.target.value)} placeholder="e.g. Sushi night, Tacos..." className="w-full px-3 py-2 bg-white border border-stone-200 rounded-lg text-sm focus:outline-none focus:border-stone-400" onKeyDown={e => e.key === 'Enter' && onSave({ slotType: 'eating_out', label: eoLabel || 'Eating out' })} />
            <button onClick={() => onSave({ slotType: 'eating_out', label: eoLabel || 'Eating out' })} className="w-full py-2 rounded-full bg-amber-600 text-white text-sm hover:bg-amber-700">Set as eating out</button>
          </div>
        )}
        {mode === 'clear' && (
          <button onClick={() => onSave(null)} className="w-full py-2 rounded-full bg-stone-200 text-stone-700 text-sm hover:bg-stone-300">Clear this slot</button>
        )}
      </div>
    </div>
  );
}

function ChatMessage({ msg, recipes, recipeList, onApplyPlan, onStartCooking, applying, swapTarget, onSwapOpen, onSwapClose, onSwapSave }) {
  const isUser = msg.role === 'user';
  if (isUser) {
    return (
      <div className="flex justify-end mb-3">
        <div className="bg-stone-900 text-stone-50 rounded-2xl rounded-br-sm px-4 py-2.5 text-sm max-w-[80%]">{msg.content}</div>
      </div>
    );
  }
  return (
    <div className="flex gap-2.5 mb-4 items-start">
      <div className="w-6 h-6 rounded-full bg-orange-100 flex items-center justify-center flex-shrink-0 mt-0.5">
        <Sparkles className="w-3 h-3 text-orange-700" />
      </div>
      <div className="flex-1 min-w-0">
        {msg.loading ? (
          <div className="flex items-center gap-2 py-1 text-stone-400"><Loader2 className="w-3.5 h-3.5 animate-spin text-orange-600" /><span className="text-sm">Thinking...</span></div>
        ) : (
          <>
            {msg.text && <div className="text-sm text-stone-800 leading-relaxed whitespace-pre-wrap">{msg.text}</div>}
            {msg.draftPlan && (
              <MealPlanPreview
                draftPlan={msg.draftPlan} recipes={recipes}
                onSwap={(day, meal, slot) => onSwapOpen({ msgId: msg.id, day, meal, slot })}
                onApply={() => onApplyPlan(msg.id, msg.draftPlan)}
                applying={applying === msg.id}
              />
            )}
            {msg.saveAsRecipePrompt && (
              <div className="mt-3 flex items-center gap-2 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2.5">
                <span className="text-xs text-amber-800 flex-1">Want to save "<strong>{msg.saveAsRecipePrompt}</strong>" as a recipe?</span>
                <button onClick={() => msg.onSaveAsRecipe && msg.onSaveAsRecipe()} className="flex-shrink-0 px-3 py-1 rounded-full bg-amber-600 text-white text-xs hover:bg-amber-700">Save</button>
              </div>
            )}
            {msg.recipeLinks && msg.recipeLinks.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {msg.recipeLinks.map(({ id, name }) => (
                  <button key={id} onClick={() => onStartCooking(id)} className="flex items-center gap-1 px-2.5 py-1 rounded-full border border-orange-200 text-orange-700 text-xs hover:bg-orange-50">
                    Start cooking: {name} <ChevronRight className="w-3 h-3" />
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
      {swapTarget && swapTarget.msgId === msg.id && (
        <SlotSwapModal day={swapTarget.day} meal={swapTarget.meal} recipeList={recipeList}
          onSave={(newSlot) => onSwapSave(msg.id, swapTarget.day, swapTarget.meal, newSlot)}
          onClose={onSwapClose} />
      )}
    </div>
  );
}

export function MealChat({ recipes, recipeList, mealPlan, mealHistory, currentWeek, weekPrepGuide, onApplyWeekPlan, onAddMealHistory, onSaveRecipe, onStartCooking }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(null);
  const [swapTarget, setSwapTarget] = useState(null);
  const [draftPlans, setDraftPlans] = useState({});
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => { if (open && bottomRef.current) bottomRef.current.scrollIntoView({ behavior: 'smooth' }); }, [messages, open]);
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 50); }, [open]);

  function addMessage(msg) {
    const id = msg.id || Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    setMessages(prev => [...prev, { ...msg, id }]);
    return id;
  }

  function updateMessage(id, updates) {
    setMessages(prev => prev.map(m => m.id === id ? { ...m, ...updates } : m));
  }

  const send = useCallback(async (text) => {
    const trimmed = (text || input).trim();
    if (!trimmed || loading) return;
    setInput('');
    setLoading(true);
    addMessage({ role: 'user', content: trimmed });
    const replyId = addMessage({ role: 'assistant', loading: true });
    const intent = detectIntent(trimmed);
    const context = buildContextBlock(recipes, mealPlan, mealHistory, currentWeek, weekPrepGuide);

    try {
      if (intent === 'plan') {
        const prompt = `You are a helpful meal planning assistant for the app "Mise".\n\n${context}\n\nUSER REQUEST: "${trimmed}"\n\nGenerate a full 7-day meal plan (Monday-Sunday) using recipes from the library above.\nPrefer variety - avoid repeating the same recipe more than twice.\nYou may include "eating out" slots (1-2 per week max unless the user asks for more).\nRespond ONLY with valid JSON in this exact shape - no markdown, no extra text:\n{\n  "message": "brief friendly intro (1-2 sentences)",\n  "plan": {\n    "mon": { "breakfast": "recipeId or null", "lunch": "recipeId or null", "dinner": "recipeId or null" },\n    "tue": { "breakfast": "recipeId or null", "lunch": "recipeId or null", "dinner": "recipeId or null" },\n    "wed": { "breakfast": "recipeId or null", "lunch": "recipeId or null", "dinner": "recipeId or null" },\n    "thu": { "breakfast": "recipeId or null", "lunch": "recipeId or null", "dinner": "recipeId or null" },\n    "fri": { "breakfast": "recipeId or null", "lunch": "recipeId or null", "dinner": "recipeId or null" },\n    "sat": { "breakfast": "recipeId or null", "lunch": "recipeId or null", "dinner": "recipeId or null" },\n    "sun": { "breakfast": "recipeId or null", "lunch": "recipeId or null", "dinner": "recipeId or null" }\n  }\n}\nFor eating-out slots use: { "slotType": "eating_out", "label": "Restaurant night" }\nFor empty/skipped slots use: null\nUse recipe IDs exactly as shown in the library (the id: values after each recipe name).\nIf the library has fewer than 21 recipes, reuse some or leave nulls.`;
        const raw = await callAI(prompt, { smart: true, maxTokens: 2000 });
        const data = extractJSON(raw);
        const msgDraftPlan = data.plan || {};
        setDraftPlans(prev => ({ ...prev, [replyId]: JSON.parse(JSON.stringify(msgDraftPlan)) }));
        updateMessage(replyId, { loading: false, text: data.message || "Here's a plan for the week - swap any slot you'd like to change.", draftPlan: msgDraftPlan });

      } else if (intent === 'prep') {
        const prompt = `You are a meal prep coach inside the app "Mise".\n\n${context}\n\nUSER REQUEST: "${trimmed}"\n\nAnswer in 3-6 sentences. Be specific about what to prep given the current time and today's plan.\nIf relevant, mention which recipes to cook ahead and how to store things.\nEnd with a line like: RECIPE_LINKS: ["recipeId1","recipeId2"] listing at most 2 relevant recipes from the library (or empty array []).`;
        const raw = await callAI(prompt, { smart: true, maxTokens: 600 });
        const linkMatch = raw.match(/RECIPE_LINKS:\s*(\[.*?\])/s);
        let recipeLinks = [];
        const bodyText = raw.replace(/RECIPE_LINKS:.*$/s, '').trim();
        if (linkMatch) { try { const ids = JSON.parse(linkMatch[1]); recipeLinks = ids.map(id => ({ id, name: recipes[id]?.name })).filter(r => r.name); } catch { } }
        updateMessage(replyId, { loading: false, text: bodyText, recipeLinks });

      } else if (intent === 'log') {
        const prompt = `You are a meal logging assistant inside "Mise".\n\n${context}\n\nUSER MESSAGE: "${trimmed}"\n\nParse what the user ate. Return ONLY valid JSON:\n{\n  "meal": "breakfast|lunch|dinner",\n  "label": "dish name",\n  "recipeId": "id from library or null",\n  "isNewFood": true/false,\n  "reply": "short friendly confirmation (1 sentence)"\n}`;
        const data = extractJSON(await callAI(prompt, { smart: false, maxTokens: 400 }));
        onAddMealHistory({ date: Date.now(), meal: data.meal || 'dinner', label: data.label || trimmed, recipeId: data.recipeId || null, slotType: data.recipeId ? 'recipe' : 'freetext' });
        const isNew = data.isNewFood && !data.recipeId;
        const saveLabel = data.label || trimmed;
        updateMessage(replyId, {
          loading: false, text: data.reply || `Logged "${saveLabel}"!`,
          saveAsRecipePrompt: isNew ? saveLabel : null,
          onSaveAsRecipe: isNew ? () => onSaveRecipe({ name: saveLabel, servings: 2, prepTime: 15, cookTime: 30, cuisine: 'Other', course: 'Main', tags: ['logged'], ingredients: [], instructions: [] }) : null,
        });

      } else {
        const prompt = `You are a helpful cooking and meal planning assistant inside the app "Mise".\n\n${context}\n\nUSER: "${trimmed}"\n\nRespond helpfully in 2-5 sentences. Be specific and use context from the user's meal plan and history.\nIf you mention specific recipes from their library, end with: RECIPE_LINKS: ["id1"] (empty array [] if none).`;
        const raw = await callAI(prompt, { smart: false, maxTokens: 500 });
        const linkMatch = raw.match(/RECIPE_LINKS:\s*(\[.*?\])/s);
        let recipeLinks = [];
        const bodyText = raw.replace(/RECIPE_LINKS:.*$/s, '').trim();
        if (linkMatch) { try { const ids = JSON.parse(linkMatch[1]); recipeLinks = ids.map(id => ({ id, name: recipes[id]?.name })).filter(r => r.name); } catch { } }
        updateMessage(replyId, { loading: false, text: bodyText, recipeLinks });
      }
    } catch (err) {
      updateMessage(replyId, { loading: false, text: 'Sorry, something went wrong. Try again.' });
      console.error('[MealChat]', err);
    } finally {
      setLoading(false);
    }
  }, [input, loading, recipes, mealPlan, mealHistory, currentWeek, weekPrepGuide]);

  async function handleApplyPlan(msgId, plan) {
    const livePlan = draftPlans[msgId] || plan;
    setApplying(msgId);
    try { onApplyWeekPlan(currentWeek, livePlan); updateMessage(msgId, { text: 'Plan applied to your week!', draftPlan: null }); }
    finally { setApplying(null); }
  }

  function handleSwapOpen(target) { setSwapTarget(target); }
  function handleSwapClose() { setSwapTarget(null); }
  function handleSwapSave(msgId, day, meal, newSlot) {
    setDraftPlans(prev => { const plan = { ...(prev[msgId] || {}) }; plan[day] = { ...(plan[day] || {}) }; plan[day][meal] = newSlot; return { ...prev, [msgId]: plan }; });
    setMessages(prev => prev.map(m => { if (m.id !== msgId || !m.draftPlan) return m; const updated = { ...m.draftPlan, [day]: { ...(m.draftPlan[day] || {}), [meal]: newSlot } }; return { ...m, draftPlan: updated }; }));
    setSwapTarget(null);
  }

  const quickPrompts = [
    { label: 'Plan my week', prompt: 'Plan my week with recipes from my library.' },
    { label: 'What can I prep tonight?', prompt: 'What can I prep before dinner tonight?' },
    { label: '3 days of meals', prompt: 'Give me 3 days of meals using what I have.' },
  ];

  return (
    <>
      {!open && (
        <button onClick={() => setOpen(true)} className="w-full text-left bg-white border border-stone-200 rounded-2xl p-5 mb-4 hover:border-orange-300 hover:bg-orange-50/30 transition-colors group">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2"><Sparkles className="w-4 h-4 text-orange-600" /><h3 className="font-display text-lg">Meal planning assistant</h3></div>
            <ChevronDown className="w-4 h-4 text-stone-400 group-hover:text-orange-600 transition-colors" />
          </div>
          <p className="text-sm text-stone-500">"Plan my week", "What can I prep tonight?", quick-log a meal...</p>
        </button>
      )}
      {open && (
        <div className="bg-white border border-stone-200 rounded-2xl mb-4 flex flex-col overflow-hidden" style={{ maxHeight: '70vh' }}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-stone-100 flex-shrink-0">
            <div className="flex items-center gap-2"><Sparkles className="w-4 h-4 text-orange-600" /><span className="font-display text-base">Meal assistant</span></div>
            <button onClick={() => setOpen(false)} className="p-1.5 rounded-full hover:bg-stone-100 text-stone-400"><ChevronUp className="w-4 h-4" /></button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-4 min-h-0">
            {messages.length === 0 && (
              <div className="space-y-2 mb-4">
                <p className="text-xs text-stone-400 text-center mb-3">Quick starts:</p>
                {quickPrompts.map(qp => (
                  <button key={qp.label} onClick={() => send(qp.prompt)} disabled={loading} className="w-full text-left px-3 py-2.5 rounded-xl border border-stone-200 text-sm text-stone-700 hover:border-orange-300 hover:bg-orange-50/30 transition-colors disabled:opacity-50">
                    {qp.label}
                  </button>
                ))}
              </div>
            )}
            {messages.map(msg => (
              <ChatMessage key={msg.id} msg={msg} recipes={recipes} recipeList={recipeList}
                onApplyPlan={handleApplyPlan} onStartCooking={onStartCooking}
                applying={applying} swapTarget={swapTarget}
                onSwapOpen={handleSwapOpen} onSwapClose={handleSwapClose} onSwapSave={handleSwapSave} />
            ))}
            <div ref={bottomRef} />
          </div>
          <div className="px-3 pb-3 pt-2 border-t border-stone-100 flex-shrink-0">
            <div className="flex items-center gap-2 bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 focus-within:border-stone-400 transition-colors">
              <input ref={inputRef} value={input} onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                placeholder="Plan my week, what can I prep, log a meal..."
                className="flex-1 bg-transparent text-sm outline-none placeholder-stone-400" disabled={loading} />
              <button onClick={() => send()} disabled={!input.trim() || loading}
                className="flex-shrink-0 w-7 h-7 rounded-lg bg-orange-700 text-white flex items-center justify-center hover:bg-orange-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
