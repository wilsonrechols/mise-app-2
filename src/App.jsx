import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  BookOpen, Calendar, ShoppingCart, Sparkles, Package,
  Plus, Minus, Search, X, Camera, Link as LinkIcon, FileText, Edit2,
  Trash2, ThumbsUp, ThumbsDown, Clock, Users, ChefHat, Loader2,
  Check, ChevronLeft, ChevronRight, Upload, Save, RefreshCw,
  Flame, Cloud, CloudOff, Download, Copy, UtensilsCrossed,
  Star, MessageSquare, Share2, Zap, History, Image as ImageIcon,
  PenLine, ChevronUp, ChevronDown, Home, Activity, GripVertical,
  Play, ListOrdered, AlertTriangle
} from 'lucide-react';
import { MealChat } from './MealChat';

// ---------- Config ----------
const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'https://mise-sync-311883254950.us-central1.run.app';
const SECRET_KEY = import.meta.env.VITE_SECRET_KEY || 'mise-wilson-2026';
const STORAGE_KEY = 'mise:state:v3';

// ---------- Constants ----------
const CATEGORIES = ['produce','dairy','meat','seafood','pantry','spices','frozen','bakery','beverages','other'];
const CUISINES = ['American','Italian','Mexican','Asian','Mediterranean','Indian','French','Middle Eastern','BBQ','Comfort','Other'];
const COURSES = ['Main','Side','Dessert','Breakfast','Snack','Drink','Sauce','Other'];
const DAYS = [
  {key:'mon',label:'Monday'},{key:'tue',label:'Tuesday'},{key:'wed',label:'Wednesday'},
  {key:'thu',label:'Thursday'},{key:'fri',label:'Friday'},{key:'sat',label:'Saturday'},{key:'sun',label:'Sunday'}
];
const MEALS = ['breakfast','lunch','dinner','snack'];
const MAIN_MEALS = ['breakfast','lunch','dinner'];

const DEFAULT_STATE = {
  recipes:{}, mealPlan:{}, cookedSlots:{}, manualGrocery:{}, groceryChecks:{},
  pantry:['salt','black pepper','olive oil','butter','garlic','sugar','flour'],
  settings:{defaultServings:4},
  cookLog:{},
  mealHistory:[],
  groceryCategoryOrder: [...CATEGORIES],
  weekPrepGuide: null,    // {intro, tasks:[{id,recipe,task,duration,storedUntil}]}
  weekPrepChecks: {},     // {taskId: true}
};

// ---------- Utilities ----------
function generateId(){return Date.now().toString(36)+Math.random().toString(36).slice(2,7);}
function getWeekStart(date=new Date()){const d=new Date(date);const day=d.getDay();const diff=d.getDate()-day+(day===0?-6:1);return new Date(d.setDate(diff)).toISOString().split('T')[0];}
function shiftWeek(ws,w){const d=new Date(ws);d.setDate(d.getDate()+w*7);return d.toISOString().split('T')[0];}
function formatWeekRange(ws){const s=new Date(ws),e=new Date(ws);e.setDate(e.getDate()+6);const o={month:'short',day:'numeric'};return`${s.toLocaleDateString('en-US',o)} – ${e.toLocaleDateString('en-US',o)}`;}
function normalizeIngredientName(n){return n.toLowerCase().trim().replace(/s$/,'');}
function formatQuantity(qty){
  if(qty==null||isNaN(qty))return '';if(qty===0)return '0';
  const whole=Math.floor(qty),frac=qty-whole;
  const fracs=[[0,''],[1/8,'1/8'],[1/4,'1/4'],[1/3,'1/3'],[3/8,'3/8'],[1/2,'1/2'],[5/8,'5/8'],[2/3,'2/3'],[3/4,'3/4'],[7/8,'7/8'],[1,'']];
  let bs='',bv=0,bd=Infinity;
  for(const[v,s]of fracs){const d=Math.abs(frac-v);if(d<bd){bd=d;bs=s;bv=v;}}
  if(bd<0.02){const aw=whole+(bv===1?1:0);if(aw===0)return bs||'0';return bs?`${aw} ${bs}`:aw.toString();}
  return qty.toFixed(2).replace(/\.?0+$/,'');
}
function normalizeSlot(slot){if(!slot)return null;if(typeof slot==='string')return{recipeId:slot,multiplier:1,slotType:'recipe'};return{multiplier:1,slotType:'recipe',...slot};}
function getOriginSlot(weekPlan,slot,prevWeekPlan){const norm=normalizeSlot(slot);if(!norm)return null;if(norm.leftoverFrom){const{day,meal}=norm.leftoverFrom;const s=weekPlan?.[day]?.[meal]??prevWeekPlan?.[day]?.[meal];return normalizeSlot(s);}return norm;}
function listOriginSlots(weekPlan,prevWeekPlan){const result=[];for(const plan of[weekPlan,prevWeekPlan].filter(Boolean)){const label=plan===prevWeekPlan?'last week':'this week';for(const d of DAYS){const dp=plan?.[d.key]||{};for(const m of MEALS){const n=normalizeSlot(dp[m]);if(n&&n.recipeId&&!n.leftoverFrom)result.push({day:d.key,dayLabel:`${d.label}${plan===prevWeekPlan?' (last wk)':''}`,meal:m,recipeId:n.recipeId,multiplier:n.multiplier});}}}return result;}
function todayISO(){return new Date().toISOString().split('T')[0];}
function daysAgo(n){const d=new Date();d.setDate(d.getDate()-n);return d.toISOString().split('T')[0];}
function getTodayDayKey(){const dkm=['sun','mon','tue','wed','thu','fri','sat'];return dkm[new Date().getDay()];}

// ---------- Gram conversion ----------
const GPW={g:1,gram:1,grams:1,kg:1000,oz:28.35,ounce:28.35,ounces:28.35,lb:453.6,lbs:453.6,pound:453.6,pounds:453.6};
const VTC={cup:1,cups:1,tbsp:1/16,tablespoon:1/16,tablespoons:1/16,tsp:1/48,teaspoon:1/48,teaspoons:1/48,ml:1/237,l:1000/237,'fl oz':1/8};
const GPC={flour:125,'all-purpose flour':125,sugar:200,'brown sugar':220,butter:227,'olive oil':218,oil:218,water:237,milk:240,cream:240,'heavy cream':240,rice:200,salt:273,'kosher salt':220,honey:340,'soy sauce':245,broth:240,stock:240,cheese:113,parmesan:100,onion:160,garlic:136,tomato:180};
const GPI={egg:56,onion:150,garlic:5,tomato:120,potato:213,carrot:60,apple:180,lemon:65,lime:45,avocado:150,'chicken breast':200,'chicken thigh':100,'garlic clove':5};
function lookupBySub(table,name){const n=(name||'').toLowerCase().trim();if(!n)return null;if(table[n]!=null)return table[n];const keys=Object.keys(table).sort((a,b)=>b.length-a.length);for(const k of keys){if(n.includes(k))return table[k];}return null;}
function ingredientToGrams(ing){if(!ing)return null;if(typeof ing.grams==='number'&&ing.grams>0)return ing.grams;const qty=ing.quantity;if(!qty||qty<=0)return null;const unit=(ing.unit||'').toLowerCase().trim();if(GPW[unit]!=null)return qty*GPW[unit];if(VTC[unit]!=null){const cups=qty*VTC[unit];const d=lookupBySub(GPC,ing.name);return d!=null?cups*d:null;}if(!unit){const ig=lookupBySub(GPI,ing.name);return ig!=null?qty*ig:null;}return null;}
function formatGrams(g){if(g==null||isNaN(g))return null;return g<10?`${Math.round(g*10)/10}g`:`${Math.round(g)}g`;}
const UNIT_ABBR={'tablespoon':'tbsp','tablespoons':'tbsp','teaspoon':'tsp','teaspoons':'tsp','ounce':'oz','ounces':'oz','pound':'lb','pounds':'lb','gram':'g','grams':'g','kilogram':'kg','kilograms':'kg','milliliter':'ml','milliliters':'ml','liter':'L','liters':'L','fluid ounce':'fl oz','fluid ounces':'fl oz','package':'pkg','packages':'pkg','slice':'sl','slices':'sl','clove':'clv','cloves':'clv','inch':'in','inches':'in'};
function abbreviateUnit(u){if(!u)return'';const l=u.toLowerCase().trim();return UNIT_ABBR[l]||u;}
function fmtUnit(qty,unit){return`${formatQuantity(qty)}${abbreviateUnit(unit)?' '+abbreviateUnit(unit):''}`.trim();}
function extractJSON(text){let clean=text.replace(/```json\s*/gi,'').replace(/```/g,'').trim();const am=clean.match(/\[[\s\S]*\]/),om=clean.match(/\{[\s\S]*\}/);if(am&&(!om||am.index<om.index))clean=am[0];else if(om)clean=om[0];return JSON.parse(clean);}

// ---------- API ----------
async function callAI(prompt,options={}){
  const model=options.smart?'claude-sonnet-4-6':'claude-haiku-4-5-20251001';
  const body={model,max_tokens:options.maxTokens||2000,messages:[{role:'user',content:prompt}]};
  if(options.tools)body.tools=options.tools;
  if(options.imageData)body.messages=[{role:'user',content:[{type:'image',source:{type:'base64',media_type:options.imageType,data:options.imageData}},{type:'text',text:prompt}]}];
  const r=await fetch(`${SERVER_URL}/ai`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(!r.ok){const errData=await r.json().catch(()=>({}));throw new Error(`AI error ${r.status}: ${errData.error?.message||errData.error||JSON.stringify(errData)}`);}
  const d=await r.json();
  return d.content.filter(b=>b.type==='text').map(b=>b.text).join('\n');
}
async function syncRead(){const r=await fetch(`${SERVER_URL}/data`);if(r.status===404)return null;if(!r.ok)throw new Error(`Sync read error ${r.status}`);return r.json();}
async function syncWrite(data){const r=await fetch(`${SERVER_URL}/data`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});if(!r.ok)throw new Error(`Sync write error ${r.status}`);}

function exportRecipes(recipes){const data=JSON.stringify({version:1,exportedAt:new Date().toISOString(),recipes},null,2);const blob=new Blob([data],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`mise-recipes-${new Date().toISOString().split('T')[0]}.json`;a.click();URL.revokeObjectURL(url);}
function importRecipesFromFile(file,onImport,onError){const reader=new FileReader();reader.onload=e=>{try{const raw=JSON.parse(e.target.result);const recipes=raw.recipes||raw;if(typeof recipes!=='object'||Array.isArray(recipes))throw new Error('Bad format');onImport(recipes);}catch{onError('Could not read that file.');}};reader.readAsText(file);}

const SCHEMA=`Return ONLY valid JSON, no markdown fences. Schema:
{"name":"string","servings":number,"prepTime":number,"cookTime":number,"cuisine":"American|Italian|Mexican|Asian|Mediterranean|Indian|French|Middle Eastern|BBQ|Comfort|Other","course":"Main|Side|Dessert|Breakfast|Snack|Drink|Sauce|Other","tags":["string"],"ingredients":[{"name":"string","quantity":number,"unit":"string","category":"produce|dairy|meat|seafood|pantry|spices|frozen|bakery|beverages|other","grams":number}],"instructions":["string"],"notes":"string"}`;

// ---------- useAppState ----------
function useAppState(){
  const[state,setState]=useState(DEFAULT_STATE);
  const[loaded,setLoaded]=useState(false);
  const[syncStatus,setSyncStatus]=useState('idle');
  const[syncError,setSyncError]=useState(null);
  const[lastSynced,setLastSynced]=useState(null);
  const saveTimer=useRef(null);
  useEffect(()=>{
    (async()=>{
      setSyncStatus('syncing');
      try{
        const remote=await syncRead();
        if(remote){const merged={...DEFAULT_STATE,...remote};setState(merged);localStorage.setItem(STORAGE_KEY,JSON.stringify(merged));}
        else{try{const loc=localStorage.getItem(STORAGE_KEY);if(loc)setState({...DEFAULT_STATE,...JSON.parse(loc)});}catch{}}
        setLastSynced(Date.now());setSyncStatus('synced');
      }catch(e){
        setSyncError(e.message);
        try{const loc=localStorage.getItem(STORAGE_KEY);if(loc)setState({...DEFAULT_STATE,...JSON.parse(loc)});}catch{}
        setSyncStatus('error');
      }
      setLoaded(true);
    })();
  },[]);
  useEffect(()=>{
    if(!loaded)return;
    if(saveTimer.current)clearTimeout(saveTimer.current);
    saveTimer.current=setTimeout(async()=>{
      localStorage.setItem(STORAGE_KEY,JSON.stringify(state));
      setSyncStatus('syncing');
      try{await syncWrite(state);setLastSynced(Date.now());setSyncStatus('synced');}
      catch(e){setSyncError(e.message);setSyncStatus('error');}
    },2000);
    return()=>clearTimeout(saveTimer.current);
  },[state,loaded]);
  async function manualSync(){
    setSyncStatus('syncing');setSyncError(null);
    try{const remote=await syncRead();if(remote){const merged={...DEFAULT_STATE,...remote};setState(merged);localStorage.setItem(STORAGE_KEY,JSON.stringify(merged));}setLastSynced(Date.now());setSyncStatus('synced');}
    catch(e){setSyncError(e.message);setSyncStatus('error');}
  }
  return[state,setState,loaded,setLoaded,syncStatus,syncError,lastSynced,manualSync];
}

function SyncBadge({status,lastSynced,onSync}){
  const ago=lastSynced?(()=>{const m=Math.floor((Date.now()-lastSynced)/60000);if(m<1)return'just now';if(m===1)return'1m ago';if(m<60)return`${m}m ago`;return`${Math.floor(m/60)}h ago`;})():null;
  if(status==='syncing')return<div className="flex items-center gap-1.5 text-xs text-stone-500"><Loader2 className="w-3.5 h-3.5 animate-spin text-orange-600"/><span className="hidden sm:inline">Syncing…</span></div>;
  if(status==='synced')return<div className="flex items-center gap-1.5 text-xs text-stone-500"><Cloud className="w-3.5 h-3.5 text-emerald-600"/><span className="hidden sm:inline">Synced {ago}</span></div>;
  if(status==='error')return<button onClick={onSync} className="flex items-center gap-1.5 text-xs text-red-600 hover:text-red-700"><CloudOff className="w-3.5 h-3.5"/><span className="hidden sm:inline">Sync failed · retry</span></button>;
  return<button onClick={onSync} className="flex items-center gap-1.5 text-xs text-stone-400 hover:text-stone-600"><RefreshCw className="w-3.5 h-3.5"/><span className="hidden sm:inline">Sync</span></button>;
}

function LoadingScreen({onSkip}){
  const[elapsed,setElapsed]=useState(0);
  useEffect(()=>{const t=setInterval(()=>setElapsed(e=>e+1),1000);return()=>clearInterval(t);},[]);
  const msgs=['Loading your recipes…','Connecting…','Almost there…','Just a moment more…'];
  return(
    <div className="paper-bg min-h-screen flex flex-col items-center justify-center gap-4 px-6">
      <ChefHat className="w-8 h-8 text-orange-700" strokeWidth={1.5}/>
      <h1 className="font-display text-2xl font-medium">Mise</h1>
      <div className="flex items-center gap-2 text-sm text-stone-500"><Loader2 className="w-4 h-4 animate-spin text-orange-600"/><span>{msgs[Math.min(Math.floor(elapsed/6),msgs.length-1)]}</span></div>
      {elapsed>=10&&<div className="text-center mt-2"><p className="text-xs text-stone-400 mb-2">Taking a while. Open without sync?</p><button onClick={onSkip} className="px-4 py-2 rounded-full bg-stone-900 text-stone-50 text-sm">Open anyway</button></div>}
    </div>
  );
}

function Modal({children,onClose,wide}){
  useEffect(()=>{const h=e=>{if(e.key==='Escape')onClose();};window.addEventListener('keydown',h);return()=>window.removeEventListener('keydown',h);},[onClose]);
  return(
    <div className="fixed inset-0 bg-stone-900/40 backdrop-blur-sm z-50 flex items-start justify-center p-2 sm:p-4 overflow-y-auto" onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} className={`bg-stone-50 rounded-2xl p-4 sm:p-6 my-4 sm:my-8 w-full ${wide?'max-w-3xl':'max-w-md'} relative`}>
        <button onClick={onClose} className="absolute top-3 right-3 p-2 rounded-full hover:bg-stone-200 text-stone-500"><X className="w-4 h-4"/></button>
        {children}
      </div>
    </div>
  );
}

function NutritionBadge({nutrition}){
  if(!nutrition)return null;
  return(
    <div className="flex items-center gap-2 flex-wrap">
      {[['cal',nutrition.calories,'text-orange-700'],['pro',nutrition.protein,'text-blue-600'],['carb',nutrition.carbs,'text-amber-600'],['fat',nutrition.fat,'text-rose-600']].map(([label,val,color])=>(
        val!=null&&<span key={label} className={`text-xs font-medium ${color}`}>{Math.round(val)}<span className="text-stone-400 font-normal ml-0.5">{label}</span></span>
      ))}
      {nutrition.perServing&&<span className="text-[10px] text-stone-400">/ serving</span>}
    </div>
  );
}

function NutritionSection({recipe,onSave}){
  const[loading,setLoading]=useState(false);
  const[error,setError]=useState(null);
  const n=recipe.nutrition;
  async function estimate(){
    setLoading(true);setError(null);
    try{
      const ings=(recipe.ingredients||[]).map(i=>`${formatQuantity(i.quantity)} ${i.unit} ${i.name}`.trim()).join(', ');
      const result=extractJSON(await callAI(`Estimate nutrition for this recipe per serving (${recipe.servings||4} servings total).\nIngredients: ${ings}\nReturn ONLY JSON: {"calories":number,"protein":number,"carbs":number,"fat":number,"fiber":number,"perServing":true}\nUse realistic values.`));
      onSave({...recipe,nutrition:result});
    }catch(e){setError('Could not estimate. Try again.');}
    finally{setLoading(false);}
  }
  if(!n)return(
    <div className="flex items-center gap-3">
      <button onClick={estimate} disabled={loading} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-stone-200 text-sm text-stone-600 hover:border-orange-400 hover:text-orange-700 disabled:opacity-50">
        {loading?<Loader2 className="w-3.5 h-3.5 animate-spin"/>:<Activity className="w-3.5 h-3.5"/>}
        {loading?'Estimating…':'Estimate nutrition'}
      </button>
      {error&&<span className="text-xs text-red-600">{error}</span>}
    </div>
  );
  return(
    <div className="bg-stone-50 border border-stone-200 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs uppercase tracking-wider text-stone-500 font-medium flex items-center gap-1.5"><Activity className="w-3.5 h-3.5"/> Nutrition per serving</p>
        <button onClick={estimate} disabled={loading} className="text-xs text-stone-400 hover:text-orange-700 flex items-center gap-1">{loading?<Loader2 className="w-3 h-3 animate-spin"/>:<RefreshCw className="w-3 h-3"/>} Refresh</button>
      </div>
      <div className="grid grid-cols-5 gap-2">
        {[['Calories',n.calories,'bg-orange-50 text-orange-700'],['Protein',n.protein,'bg-blue-50 text-blue-700'],['Carbs',n.carbs,'bg-amber-50 text-amber-700'],['Fat',n.fat,'bg-rose-50 text-rose-700'],['Fiber',n.fiber,'bg-emerald-50 text-emerald-700']].map(([label,val,cls])=>(
          <div key={label} className={`${cls} rounded-lg p-2 text-center`}>
            <div className="text-lg font-display font-medium leading-none">{Math.round(val||0)}</div>
            <div className="text-[10px] mt-0.5 opacity-70">{label}</div>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-stone-400 mt-2">AI estimate · not a substitute for professional nutritional advice</p>
    </div>
  );
}

// ---------- PrepChecklist (Home inline card) ----------
function PrepChecklist({guide,checks,onToggle,onRegenerate}){
  const[confirmRegen,setConfirmRegen]=useState(false);
  if(!guide||guide.empty||guide.error)return null;
  const tasks=guide.tasks||[];
  const doneCount=tasks.filter(t=>checks[t.id]).length;

  if(confirmRegen){
    return(
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 mb-4">
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0"/>
          <h3 className="font-display text-lg text-amber-900">Regenerate prep guide?</h3>
        </div>
        <p className="text-sm text-amber-800 mb-4">This will clear all checklist progress and regenerate based on the next 7 days of your meal plan. Any items you've already checked off will be lost.</p>
        <div className="flex gap-2">
          <button onClick={()=>{setConfirmRegen(false);onRegenerate();}} className="px-4 py-2 rounded-full bg-amber-600 text-white text-sm hover:bg-amber-700">Yes, regenerate</button>
          <button onClick={()=>setConfirmRegen(false)} className="px-4 py-2 rounded-full border border-amber-200 text-amber-800 text-sm hover:bg-amber-100">Cancel</button>
        </div>
      </div>
    );
  }

  return(
    <div className="bg-white border border-stone-200 rounded-2xl p-5 mb-4">
      <div className="flex items-center justify-between mb-1">
        <h3 className="font-display text-lg">Prep checklist</h3>
        <button onClick={()=>setConfirmRegen(true)} className="flex items-center gap-1 text-xs text-stone-400 hover:text-stone-700">
          <RefreshCw className="w-3 h-3"/> Regenerate
        </button>
      </div>
      <p className="text-xs text-stone-500 mb-4">{doneCount} of {tasks.length} done</p>
      {guide.intro&&<p className="text-xs text-stone-500 italic mb-3">{guide.intro}</p>}
      <div className="space-y-2">
        {tasks.map(task=>{
          const done=!!checks[task.id];
          return(
            <button key={task.id} onClick={()=>onToggle(task.id)} className={`w-full flex items-start gap-3 p-3 rounded-xl border text-left transition-colors ${done?'border-emerald-200 bg-emerald-50/40':'border-stone-100 bg-stone-50 hover:border-stone-200'}`}>
              <div className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${done?'bg-emerald-600 border-emerald-600':'border-stone-300'}`}>
                {done&&<Check className="w-3 h-3 text-white" strokeWidth={3}/>}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 mb-0.5">
                  <span className={`text-xs font-medium ${done?'text-emerald-700':'text-orange-700'}`}>{task.recipe}</span>
                  {task.duration&&<span className="text-[10px] text-stone-400 flex-shrink-0">{task.duration}</span>}
                </div>
                <p className={`text-sm leading-snug ${done?'line-through text-stone-400':'text-stone-700'}`}>{task.task}</p>
                {task.storedUntil&&!done&&<p className="text-[10px] text-stone-400 mt-0.5">Keeps: {task.storedUntil}</p>}
              </div>
            </button>
          );
        })}
      </div>
      {doneCount===tasks.length&&tasks.length>0&&(
        <div className="mt-3 flex items-center gap-2 text-sm text-emerald-700 font-medium">
          <Check className="w-4 h-4" strokeWidth={3}/> All prep done — you're ready for the week!
        </div>
      )}
    </div>
  );
}

function HomeView({recipes,mealPlan,currentWeek,weekPrepGuide,weekPrepChecks,onSelectRecipe,onGoToWeek,onStartCookingOverlay,onSaveRecipeGuide,onPrepWeek,onTogglePrepCheck,onRegeneratePrepGuide,onSaveCookLog,onLogCook,mealHistory,onApplyWeekPlan,onAddMealHistory,onSaveRecipe,onPlanMeal}){
  const today=getTodayDayKey();
  const weekPlan=mealPlan[currentWeek]||{};
  const todayPlan=weekPlan[today]||{};
  const[cookingMode,setCookingMode]=useState(null);
  const[prepGuide,setPrepGuide]=useState(null);
  const[showIngredients,setShowIngredients]=useState(false);
  const[cookReview,setCookReview]=useState(null);

  const todayMeals=MEALS.map(m=>{
    const slot=normalizeSlot(todayPlan[m]);
    if(!slot)return{meal:m,slot:null,recipe:null};
    if(slot.slotType==='eating_out')return{meal:m,slot,recipe:null,isEatingOut:true};
    const recipe=slot.recipeId?recipes[slot.recipeId]:null;
    return{meal:m,slot,recipe};
  });
  const cookableMeals=todayMeals.filter(({recipe,slot,isEatingOut})=>recipe&&slot&&!isEatingOut);
  const todayDate=new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'});

  async function startCooking(recipe,isMealPrep=false){
    const multiplier=isMealPrep?(()=>{
      const week=mealPlan[currentWeek]||{};
      for(const d of DAYS){const dp=week[d.key]||{};for(const m of MEALS){const s=normalizeSlot(dp[m]);if(s?.recipeId===recipe.id)return s.multiplier||1;}}
      return 1;
    })():1;
    const cachedGuide=isMealPrep?recipe.mealPrepGuide:recipe.prepGuide;
    setPrepGuide({recipe,guide:cachedGuide||null,loading:!cachedGuide,isMealPrep,multiplier});
    if(!cachedGuide){
      try{
        const ings=(recipe.ingredients||[]).map(i=>`${fmtUnit(i.quantity,i.unit)} ${i.name}`).join(', ');
        const steps=(recipe.instructions||[]).map((s,i)=>`${i+1}. ${s}`).join('\n');
        const prompt=isMealPrep
          ?`You are a meal prep coach. For batch cooking this recipe (${multiplier}x servings), give an optimized parallel-task prep guide.\nRecipe: ${recipe.name}\nIngredients: ${ings}\nSteps:\n${steps}\nReturn ONLY JSON: {"overview":"string","phases":[{"phase":"string","tasks":["string"],"canDoAhead":true,"aheadTiming":"string or null"}],"storageNotes":"string"}`
          :`You are a cooking coach. Analyze this recipe and identify what can be prepped ahead of time.\nRecipe: ${recipe.name}\nIngredients: ${ings}\nSteps:\n${steps}\nReturn ONLY JSON: {"overview":"string","prepAhead":[{"what":"string","relatedSteps":[number],"howFarAhead":"string","tip":"string"}],"cookingNotes":"string"}`;
        const result=extractJSON(await callAI(prompt,{smart:true}));
        setPrepGuide(g=>({...g,guide:result,loading:false}));
        if(onSaveRecipeGuide)onSaveRecipeGuide(recipe.id,result,isMealPrep);
      }catch(e){setPrepGuide(g=>({...g,loading:false,error:'Could not generate prep guide.'}));}
    }
  }

  function handleStartCookingOverlay(recipe,isMealPrep=false){
    const multiplier=isMealPrep?(()=>{const week=mealPlan[currentWeek]||{};for(const d of DAYS){const dp=week[d.key]||{};for(const m of MEALS){const s=normalizeSlot(dp[m]);if(s?.recipeId===recipe.id)return s.multiplier||1;}}return 1;})():1;
    onStartCookingOverlay&&onStartCookingOverlay(recipe,isMealPrep,multiplier);
  }

  if(prepGuide&&!cookingMode){
    const{recipe,guide,loading,error,isMealPrep,multiplier}=prepGuide;
    return(
      <div className="max-w-lg mx-auto">
        <button onClick={()=>setPrepGuide(null)} className="flex items-center gap-1.5 text-sm text-stone-600 mb-4 hover:text-stone-900"><ChevronLeft className="w-4 h-4"/> Back</button>
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-1">
            <p className="text-xs uppercase tracking-wider text-orange-700 font-medium mb-0.5">{isMealPrep?`Meal prep · ${multiplier}x`:'Prep guide'}</p>
            <h2 className="font-display text-2xl font-medium">{recipe.name}</h2>
          </div>
          <button onClick={()=>startCooking(recipe,isMealPrep)} className="p-1.5 rounded-full text-stone-400 hover:text-orange-700" title="Regenerate"><RefreshCw className="w-4 h-4"/></button>
        </div>
        {loading&&<div className="flex items-center gap-2 py-8 justify-center text-stone-500"><Loader2 className="w-5 h-5 animate-spin text-orange-600"/><span>Generating prep guide…</span></div>}
        {error&&<p className="text-sm text-red-600 mb-4">{error}</p>}
        {guide&&!loading&&(isMealPrep?(
          <div className="space-y-4 mb-6">
            {guide.overview&&<p className="text-sm text-stone-600 bg-orange-50 border border-orange-100 rounded-xl p-3">{guide.overview}</p>}
            {(guide.phases||[]).map((ph,i)=>(
              <div key={i} className={`rounded-2xl border p-4 ${ph.canDoAhead?'border-emerald-200 bg-emerald-50/30':'border-stone-200 bg-white'}`}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-stone-600">{ph.phase}</span>
                  {ph.canDoAhead&&<span className="text-[10px] px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full font-medium">Can prep ahead{ph.aheadTiming?` · ${ph.aheadTiming}`:''}</span>}
                </div>
                <ul className="space-y-1">{(ph.tasks||[]).map((t,j)=><li key={j} className="text-sm text-stone-700 flex gap-2"><span className="text-stone-300 flex-shrink-0">·</span>{t}</li>)}</ul>
              </div>
            ))}
            {guide.storageNotes&&<div className="bg-stone-50 border border-stone-200 rounded-xl p-3"><p className="text-xs uppercase tracking-wider text-stone-400 font-medium mb-1">Storage</p><p className="text-sm text-stone-600">{guide.storageNotes}</p></div>}
          </div>
        ):(
          <div className="space-y-4 mb-6">
            {guide.overview&&<p className="text-sm text-stone-600 bg-orange-50 border border-orange-100 rounded-xl p-3">{guide.overview}</p>}
            {(guide.prepAhead||[]).length>0&&<div>
              <p className="text-xs uppercase tracking-wider text-stone-400 font-medium mb-2">Prep ahead</p>
              <div className="space-y-3">{(guide.prepAhead||[]).map((p,i)=>(
                <div key={i} className="bg-white border border-stone-200 rounded-xl p-3">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <span className="text-sm font-medium text-stone-800">{p.what}</span>
                    <span className="text-xs text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full whitespace-nowrap flex-shrink-0">{p.howFarAhead}</span>
                  </div>
                  {p.relatedSteps?.length>0&&<p className="text-xs text-stone-400 mb-1">Steps {p.relatedSteps.join(', ')}</p>}
                  {p.tip&&<p className="text-xs text-stone-500 italic">{p.tip}</p>}
                </div>
              ))}</div>
            </div>}
            {guide.cookingNotes&&<div className="bg-stone-50 border border-stone-200 rounded-xl p-3"><p className="text-xs uppercase tracking-wider text-stone-400 font-medium mb-1">Tips for cooking day</p><p className="text-sm text-stone-600">{guide.cookingNotes}</p></div>}
          </div>
        ))}
        {!loading&&<button onClick={()=>setCookingMode({recipe,stepIdx:0})} className="w-full py-3 rounded-full bg-orange-700 text-white text-sm hover:bg-orange-800 flex items-center justify-center gap-2"><Play className="w-4 h-4 fill-current"/> Start step-by-step cooking</button>}
      </div>
    );
  }

  if(cookingMode){
    const{recipe,stepIdx}=cookingMode;
    const steps=recipe.instructions||[];
    const step=steps[stepIdx];
    const isLast=stepIdx===steps.length-1;
    const allIngs=recipe.ingredients||[];
    return(
      <div className="max-w-lg mx-auto">
        <button onClick={()=>setCookingMode(null)} className="flex items-center gap-1.5 text-sm text-stone-600 mb-6 hover:text-stone-900"><ChevronLeft className="w-4 h-4"/> Back</button>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs uppercase tracking-wider text-orange-700 font-medium">{recipe.name}</span>
          <span className="text-xs text-stone-400">Step {stepIdx+1} of {steps.length}</span>
        </div>
        <div className="w-full bg-stone-100 rounded-full h-1.5 mb-6">
          <div className="h-full bg-orange-700 rounded-full transition-all" style={{width:`${((stepIdx+1)/steps.length)*100}%`}}/>
        </div>
        <div className="bg-white border border-stone-200 rounded-2xl p-6 mb-4 min-h-[180px] flex flex-col justify-center">
          <span className="font-display text-5xl text-orange-100 font-medium mb-3">{stepIdx+1}.</span>
          <p className="text-stone-800 text-lg leading-relaxed">{step}</p>
        </div>
        <div className="mb-4 bg-white border border-stone-200 rounded-2xl overflow-hidden">
          <button onClick={()=>setShowIngredients(v=>!v)} className="w-full flex items-center justify-between px-4 py-3 text-sm text-stone-600 hover:bg-stone-50">
            <span className="flex items-center gap-2"><Package className="w-3.5 h-3.5"/> All ingredients ({allIngs.length})</span>
            {showIngredients?<ChevronUp className="w-4 h-4"/>:<ChevronDown className="w-4 h-4"/>}
          </button>
          {showIngredients&&<div className="px-4 pb-4 border-t border-stone-100">
            <div className="mt-3 space-y-1">{allIngs.map((ing,i)=>(
              <div key={i} className="flex items-center gap-2 text-sm">
                <span className="font-medium text-stone-900 w-20 flex-shrink-0 text-xs">{fmtUnit(ing.quantity,ing.unit)}</span>
                <span className="text-stone-700">{ing.name}</span>
              </div>
            ))}</div>
          </div>}
        </div>
        <div className="flex gap-3">
          <button onClick={()=>setCookingMode(c=>({...c,stepIdx:Math.max(0,c.stepIdx-1)}))} disabled={stepIdx===0} className="flex-1 py-3 rounded-full border border-stone-200 text-sm text-stone-600 disabled:opacity-30 hover:bg-stone-50">← Back</button>
          {isLast?(
            <button onClick={()=>{const r=cookingMode.recipe;setCookingMode(null);setPrepGuide(null);onLogCook&&onLogCook(r.id);setCookReview(r);}} className="flex-1 py-3 rounded-full bg-emerald-700 text-white text-sm hover:bg-emerald-800 flex items-center justify-center gap-2"><Check className="w-4 h-4"/> Done!</button>
          ):(
            <button onClick={()=>setCookingMode(c=>({...c,stepIdx:c.stepIdx+1}))} className="flex-1 py-3 rounded-full bg-stone-900 text-white text-sm hover:bg-stone-800">Next step →</button>
          )}
        </div>
      </div>
    );
  }

  if(cookReview){
    return(
      <div className="max-w-lg mx-auto">
        <p className="text-xs uppercase tracking-wider text-emerald-700 font-medium mb-4 flex items-center gap-2"><Check className="w-3.5 h-3.5" strokeWidth={3}/> Nice work!</p>
        <CookReviewCard recipe={cookReview} onClose={()=>setCookReview(null)} onSave={(id,log)=>{if(onSaveCookLog)onSaveCookLog(id,log);setCookReview(null);}}/>
      </div>
    );
  }

  return(
    <div>
      <div className="mb-6">
        <p className="text-sm text-stone-500 mb-1">{todayDate}</p>
        <h2 className="font-display text-4xl tracking-tight">Good {new Date().getHours()<12?'morning':new Date().getHours()<17?'afternoon':'evening'}</h2>
      </div>

      {/* AI Meal Planning Chat */}
      <MealChat
        recipes={recipes}
        recipeList={Object.values(recipes)}
        mealPlan={mealPlan}
        mealHistory={mealHistory}
        currentWeek={currentWeek}
        weekPrepGuide={weekPrepGuide}
        onApplyWeekPlan={onApplyWeekPlan}
        onAddMealHistory={onAddMealHistory}
        onSaveRecipe={onSaveRecipe}
        onPlanMeal={onPlanMeal}
        onStartCooking={recipeId=>onSelectRecipe(recipeId)}
      />

      {/* Today's meals */}
      <div className="bg-white border border-stone-200 rounded-2xl p-5 mb-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display text-lg">Today's meals</h3>
          <button onClick={onGoToWeek} className="text-xs text-stone-500 hover:text-orange-700 flex items-center gap-1">Edit week <ChevronRight className="w-3.5 h-3.5"/></button>
        </div>
        <div className="space-y-3">
          {todayMeals.map(({meal,slot,recipe,isEatingOut})=>(
            <div key={meal} className="flex items-center gap-3">
              <span className="text-xs uppercase tracking-wider text-stone-400 w-16 flex-shrink-0">{meal}</span>
              {recipe?(
                <div className="flex-1 flex items-center justify-between gap-2 bg-stone-50 rounded-xl px-3 py-2.5">
                  <button onClick={()=>onSelectRecipe(recipe.id)} className="font-display text-sm hover:text-orange-700 text-left flex-1">{recipe.name}</button>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {recipe.nutrition&&<NutritionBadge nutrition={recipe.nutrition}/>}
                    <button onClick={()=>handleStartCookingOverlay(recipe,false)} className="flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-orange-700 text-white text-xs hover:bg-orange-800">
                      <Play className="w-3 h-3 fill-current"/> Cook
                    </button>
                  </div>
                </div>
              ):isEatingOut?(
                <div className="flex-1 flex items-center gap-2 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2.5">
                  <UtensilsCrossed className="w-3.5 h-3.5 text-amber-600 flex-shrink-0"/>
                  <span className="text-sm text-amber-800">{slot.label||'Eating out'}</span>
                </div>
              ):(
                <button onClick={onGoToWeek} className="flex-1 text-xs text-stone-400 hover:text-stone-600 bg-stone-50 rounded-xl px-3 py-2.5 text-left border border-dashed border-stone-200 hover:border-stone-400">
                  + Plan this meal
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Cook cards — one per planned meal today */}
      {cookableMeals.length>0&&(
        <div className="space-y-3 mb-4">
          {cookableMeals.map(({meal,recipe})=>(
            <div key={meal} className="bg-orange-50 border border-orange-200 rounded-2xl p-5">
              <p className="text-xs uppercase tracking-wider text-orange-600 font-medium mb-1">{meal}</p>
              <h3 className="font-display text-2xl mb-1">{recipe.name}</h3>
              <p className="text-sm text-stone-600 mb-4">
                {((recipe.prepTime||0)+(recipe.cookTime||0))}m total · {recipe.servings} servings
                {recipe.nutrition&&<> · ~{Math.round(recipe.nutrition.calories)} cal/serving</>}
              </p>
              <div className="flex gap-2 flex-wrap">
                <button onClick={()=>handleStartCookingOverlay(recipe,false)} className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-orange-700 text-white text-sm hover:bg-orange-800">
                  <Play className="w-4 h-4 fill-current"/> Start cooking
                </button>
                <button onClick={()=>handleStartCookingOverlay(recipe,true)} className="flex items-center gap-2 px-4 py-2.5 rounded-full border border-orange-200 text-orange-700 text-sm hover:bg-orange-100">
                  Meal prep
                </button>
                <button onClick={()=>onSelectRecipe(recipe.id)} className="flex items-center gap-2 px-3 py-2.5 rounded-full border border-stone-200 text-stone-600 text-sm hover:bg-stone-100">
                  View
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Persistent prep checklist (shows when guide exists) */}
      {weekPrepGuide&&!weekPrepGuide.empty&&!weekPrepGuide.error&&(
        <PrepChecklist
          guide={weekPrepGuide}
          checks={weekPrepChecks||{}}
          onToggle={onTogglePrepCheck}
          onRegenerate={onRegeneratePrepGuide}
        />
      )}

      {/* Weekly prep guide CTA (shows when no guide yet) */}
      {(!weekPrepGuide||weekPrepGuide.empty||weekPrepGuide.error)&&(
        <div className="bg-white border border-stone-200 rounded-2xl p-5 mb-4">
          <h3 className="font-display text-lg mb-1">Prep this week</h3>
          <p className="text-sm text-stone-500 mb-3">See what can be made ahead across the next 7 days.</p>
          <button onClick={onPrepWeek} className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-stone-900 text-stone-50 text-sm hover:bg-stone-800">
            <ListOrdered className="w-4 h-4"/> Generate prep guide
          </button>
        </div>
      )}


    </div>
  );
}

function RecipeCard({recipe,onClick}){
  const tt=(recipe.prepTime||0)+(recipe.cookTime||0);
  return(
    <button onClick={onClick} className="rcs text-left bg-white border border-stone-200 rounded-2xl overflow-hidden transition-all hover:-translate-y-0.5 w-full">
      {recipe.photoUrl&&<div className="w-full h-36 overflow-hidden bg-stone-100"><img src={recipe.photoUrl} alt={recipe.name} className="w-full h-full object-cover"/></div>}
      <div className="p-5">
        <div className="flex items-start justify-between mb-3">
          <span className="text-xs uppercase tracking-wider text-orange-700 font-medium">{recipe.cuisine||'Recipe'}{recipe.course&&recipe.course!=='Main'&&<span className="text-stone-400"> · {recipe.course}</span>}</span>
          <div className="flex items-center gap-1.5">{recipe.rating==='up'&&<ThumbsUp className="w-3.5 h-3.5 text-emerald-600" fill="currentColor"/>}{recipe.cookCount>0&&<span className="text-xs text-stone-500">×{recipe.cookCount}</span>}</div>
        </div>
        <h3 className="font-display text-xl font-medium leading-tight mb-3">{recipe.name}</h3>
        <div className="flex items-center gap-3 text-xs text-stone-500 mb-3">
          {tt>0&&<span className="flex items-center gap-1"><Clock className="w-3 h-3"/> {tt}m</span>}
          {recipe.servings&&<span className="flex items-center gap-1"><Users className="w-3 h-3"/> {recipe.servings}</span>}
          <span>{(recipe.ingredients||[]).length} ingredients</span>
        </div>
        {recipe.nutrition&&<div className="mb-3"><NutritionBadge nutrition={recipe.nutrition}/></div>}
        <div className="flex flex-wrap gap-1.5">{(recipe.tags||[]).slice(0,3).map(t=><span key={t} className="text-xs px-2 py-0.5 bg-stone-100 text-stone-600 rounded-full">{t}</span>)}</div>
      </div>
    </button>
  );
}

function RecipeForm({initial,onSave,onCancel,onDelete}){
  const[recipe,setRecipe]=useState(()=>initial||{name:'',servings:4,prepTime:15,cookTime:30,cuisine:'American',course:'Main',tags:[],ingredients:[{name:'',quantity:1,unit:'',category:'produce'}],instructions:[''],source:'',notes:''});
  const[generatingPhoto,setGeneratingPhoto]=useState(false);
  const u=(f,v)=>setRecipe(r=>({...r,[f]:v}));
  const ui=(i,f,v)=>setRecipe(r=>{const a=[...r.ingredients];a[i]={...a[i],[f]:v};return{...r,ingredients:a};});
  const un=(i,v)=>setRecipe(r=>{const a=[...r.instructions];a[i]=v;return{...r,instructions:a};});
  async function generatePhoto(){
    if(!recipe.name.trim())return;
    setGeneratingPhoto(true);
    try{
      const desc=await callAI(`For the dish "${recipe.name}" (${recipe.cuisine||''}), give me a single short phrase (3-6 words, no quotes) suitable as an Unsplash photo search. Reply with ONLY the phrase.`);
      const query=encodeURIComponent(desc.trim().slice(0,80));
      u('photoUrl',`https://source.unsplash.com/800x500/?${query},food,dish`);
    }catch(e){console.error('Photo gen failed',e);}
    finally{setGeneratingPhoto(false);}
  }
  function handleSave(){if(!recipe.name.trim()){alert('Recipe needs a name.');return;}onSave({...recipe,ingredients:recipe.ingredients.filter(i=>i.name.trim()),instructions:recipe.instructions.filter(s=>s.trim())});}
  const ic='w-full px-3 py-2 bg-white border border-stone-200 rounded-lg text-sm focus:outline-none focus:border-stone-500';
  const lc='text-xs uppercase tracking-wider text-stone-500 font-medium mb-1.5 block';
  return(
    <div className="bg-white border border-stone-200 rounded-2xl p-6 space-y-6">
      <div><label className={lc}>Recipe name</label><input value={recipe.name} onChange={e=>u('name',e.target.value)} placeholder="e.g. Sheet pan harissa chicken" className={`${ic} font-display text-lg`}/></div>
      <div>
        <label className={lc}>Recipe photo</label>
        {recipe.photoUrl?(
          <div className="space-y-2">
            <img src={recipe.photoUrl} alt="recipe" className="w-full h-48 object-cover rounded-xl border border-stone-200"/>
            <div className="flex gap-2">
              <button type="button" onClick={generatePhoto} disabled={generatingPhoto||!recipe.name.trim()} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-stone-200 text-sm text-stone-600 hover:border-stone-400 disabled:opacity-50">{generatingPhoto?<Loader2 className="w-3.5 h-3.5 animate-spin"/>:<RefreshCw className="w-3.5 h-3.5"/>} Regenerate</button>
              <button type="button" onClick={()=>u('photoUrl',null)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-stone-200 text-sm text-stone-600 hover:border-red-200 hover:text-red-600"><X className="w-3.5 h-3.5"/> Remove</button>
            </div>
          </div>
        ):(
          <button type="button" onClick={generatePhoto} disabled={generatingPhoto||!recipe.name.trim()} className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-dashed border-stone-300 text-sm text-stone-500 hover:border-orange-400 hover:text-orange-700 disabled:opacity-50 w-full justify-center">
            {generatingPhoto?<><Loader2 className="w-4 h-4 animate-spin"/> Generating…</>:<><ImageIcon className="w-4 h-4"/> Auto-generate photo</>}
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div><label className={lc}>Servings</label><input type="number" min="1" value={recipe.servings} onChange={e=>u('servings',parseInt(e.target.value)||1)} className={ic}/></div>
        <div><label className={lc}>Prep (min)</label><input type="number" min="0" value={recipe.prepTime} onChange={e=>u('prepTime',parseInt(e.target.value)||0)} className={ic}/></div>
        <div><label className={lc}>Cook (min)</label><input type="number" min="0" value={recipe.cookTime} onChange={e=>u('cookTime',parseInt(e.target.value)||0)} className={ic}/></div>
        <div><label className={lc}>Cuisine</label><select value={recipe.cuisine} onChange={e=>u('cuisine',e.target.value)} className={ic}>{CUISINES.map(c=><option key={c} value={c}>{c}</option>)}</select></div>
        <div><label className={lc}>Course</label><select value={recipe.course||'Main'} onChange={e=>u('course',e.target.value)} className={ic}>{COURSES.map(c=><option key={c} value={c}>{c}</option>)}</select></div>
      </div>
      <div><label className={lc}>Tags (comma-separated)</label><input value={(recipe.tags||[]).join(', ')} onChange={e=>u('tags',e.target.value.split(',').map(t=>t.trim()).filter(Boolean))} placeholder="chicken, weeknight, one-pan" className={ic}/></div>
      <div>
        <div className="flex items-center justify-between mb-2"><label className={`${lc} mb-0`}>Ingredients</label><button onClick={()=>setRecipe(r=>({...r,ingredients:[...r.ingredients,{name:'',quantity:1,unit:'',category:'produce'}]}))} className="text-xs text-orange-700 flex items-center gap-1"><Plus className="w-3 h-3"/> Add</button></div>
        <div className="space-y-2">{recipe.ingredients.map((ing,i)=>(<div key={i} className="grid grid-cols-2 sm:grid-cols-12 gap-2 pb-3 sm:pb-0 border-b border-stone-100 last:border-0 sm:border-0"><input type="number" step="0.25" min="0" value={ing.quantity} onChange={e=>ui(i,'quantity',parseFloat(e.target.value)||0)} placeholder="qty" className={`${ic} sm:col-span-2`}/><input value={ing.unit} onChange={e=>ui(i,'unit',e.target.value)} placeholder="unit" className={`${ic} sm:col-span-2`}/><input value={ing.name} onChange={e=>ui(i,'name',e.target.value)} placeholder="ingredient" className={`${ic} col-span-2 sm:col-span-4`}/><select value={ing.category} onChange={e=>ui(i,'category',e.target.value)} className={`${ic} sm:col-span-3`}>{CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}</select><button onClick={()=>setRecipe(r=>({...r,ingredients:r.ingredients.filter((_,idx)=>idx!==i)}))} className="flex items-center justify-center text-stone-400 hover:text-red-600 sm:col-span-1"><X className="w-4 h-4"/></button></div>))}</div>
      </div>
      <div>
        <div className="flex items-center justify-between mb-2"><label className={`${lc} mb-0`}>Instructions</label><button onClick={()=>setRecipe(r=>({...r,instructions:[...r.instructions,'']}))} className="text-xs text-orange-700 flex items-center gap-1"><Plus className="w-3 h-3"/> Add step</button></div>
        <div className="space-y-2">{recipe.instructions.map((step,i)=>(<div key={i} className="flex gap-2 items-start"><span className="font-display text-lg text-stone-400 mt-1 w-6">{i+1}.</span><textarea value={step} onChange={e=>un(i,e.target.value)} rows={2} className={`${ic} flex-1 resize-none`}/><button onClick={()=>setRecipe(r=>({...r,instructions:r.instructions.filter((_,idx)=>idx!==i)}))} className="mt-2 text-stone-400 hover:text-red-600"><X className="w-4 h-4"/></button></div>))}</div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div><label className={lc}>Source</label><input value={recipe.source||''} onChange={e=>u('source',e.target.value)} placeholder="URL, cookbook, 'Mom'" className={ic}/></div>
        <div><label className={lc}>Notes</label><input value={recipe.notes||''} onChange={e=>u('notes',e.target.value)} placeholder="Worked best with bone-in thighs" className={ic}/></div>
      </div>
      <div className="flex items-center justify-between pt-2 border-t border-stone-100">
        {onDelete&&<button onClick={onDelete} className="px-4 py-2 rounded-full text-sm text-red-600 hover:bg-red-50 flex items-center gap-1.5"><Trash2 className="w-3.5 h-3.5"/> Delete recipe</button>}
        <div className="flex gap-3 ml-auto">
          {onCancel&&<button onClick={onCancel} className="px-4 py-2 rounded-full text-sm text-stone-600 hover:bg-stone-100">Cancel</button>}
          <button onClick={handleSave} className="px-5 py-2 rounded-full bg-stone-900 text-stone-50 text-sm hover:bg-stone-800 flex items-center gap-2"><Save className="w-4 h-4"/> Save recipe</button>
        </div>
      </div>
    </div>
  );
}

function PasteInput({onParsed}){
  const[text,setText]=useState('');const[loading,setLoading]=useState(false);const[error,setError]=useState(null);
  async function parse(){if(!text.trim())return;setLoading(true);setError(null);try{onParsed(extractJSON(await callAI(`${SCHEMA}\n\nParse this recipe. If it has sections (e.g. "Make the sauce"), prepend each section's steps with that header, e.g. "Make the sauce: Heat oil..."\n\n${text}`)));}catch(e){setError(e.message);}finally{setLoading(false);}}
  return(<div className="bg-white border border-stone-200 rounded-2xl p-6"><textarea value={text} onChange={e=>setText(e.target.value)} rows={10} placeholder="Paste recipe text here..." className="w-full px-3 py-3 bg-stone-50 border border-stone-200 rounded-lg text-sm focus:outline-none focus:border-stone-500 resize-none mb-3"/>{error&&<p className="text-sm text-red-600 mb-3">{error}</p>}<button onClick={parse} disabled={!text.trim()||loading} className="px-5 py-2 rounded-full bg-stone-900 text-stone-50 text-sm disabled:opacity-50 flex items-center gap-2">{loading?<Loader2 className="w-4 h-4 animate-spin"/>:<Sparkles className="w-4 h-4"/>}{loading?'Parsing…':'Parse recipe'}</button></div>);
}
function URLInput({onParsed}){
  const[url,setUrl]=useState('');const[loading,setLoading]=useState(false);const[error,setError]=useState(null);
  async function parse(){if(!url.trim())return;setLoading(true);setError(null);try{const fetchRes=await fetch(`${SERVER_URL}/fetch-url`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url})});if(!fetchRes.ok)throw new Error('Could not fetch that URL');const{text}=await fetchRes.json();const r=extractJSON(await callAI(`Extract the recipe from this webpage. If it has sections prepend each step with that section header.\n\n${text}\n\nReturn ONLY JSON. ${SCHEMA}`));r.source=url;onParsed(r);}catch(e){setError(e.message);}finally{setLoading(false);}}
  return(<div className="bg-white border border-stone-200 rounded-2xl p-6"><input value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://..." className="w-full px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-lg text-sm focus:outline-none focus:border-stone-500 mb-3"/>{error&&<p className="text-sm text-red-600 mb-3">{error}</p>}<button onClick={parse} disabled={!url.trim()||loading} className="px-5 py-2 rounded-full bg-stone-900 text-stone-50 text-sm disabled:opacity-50 flex items-center gap-2">{loading?<Loader2 className="w-4 h-4 animate-spin"/>:<LinkIcon className="w-4 h-4"/>}{loading?'Fetching…':'Fetch recipe'}</button><p className="text-xs text-stone-400 mt-3">This can take 10–20 seconds.</p></div>);
}
function PhotoInput({onParsed}){
  const[imageData,setImageData]=useState(null);const[imageType,setImageType]=useState(null);const[preview,setPreview]=useState(null);const[loading,setLoading]=useState(false);const[error,setError]=useState(null);const fileRef=useRef(null);
  function handleFile(e){const f=e.target.files?.[0];if(!f)return;const r=new FileReader();r.onload=()=>{const res=r.result;setImageData(res.split(',')[1]);setImageType(f.type);setPreview(res);};r.readAsDataURL(f);}
  async function parse(){if(!imageData)return;setLoading(true);setError(null);try{onParsed(extractJSON(await callAI(`Extract the recipe from this image. If it has sections prepend each step with that section header. ${SCHEMA}`,{imageData,imageType})));}catch(e){setError(e.message);}finally{setLoading(false);}}
  return(<div className="bg-white border border-stone-200 rounded-2xl p-6"><input ref={fileRef} type="file" accept="image/*" onChange={handleFile} className="hidden"/>{!preview&&<button onClick={()=>fileRef.current?.click()} className="w-full py-12 border-2 border-dashed border-stone-300 rounded-xl text-stone-500 flex flex-col items-center gap-2"><Upload className="w-6 h-6" strokeWidth={1.5}/><span className="text-sm">Tap to upload a photo</span></button>}{preview&&<div className="space-y-3"><img src={preview} alt="recipe" className="w-full max-h-80 object-contain rounded-lg border border-stone-200"/><div className="flex gap-2"><button onClick={()=>fileRef.current?.click()} className="px-4 py-2 rounded-full text-sm text-stone-600 hover:bg-stone-100">Change photo</button><button onClick={parse} disabled={loading} className="px-5 py-2 rounded-full bg-stone-900 text-stone-50 text-sm disabled:opacity-50 flex items-center gap-2">{loading?<Loader2 className="w-4 h-4 animate-spin"/>:<Sparkles className="w-4 h-4"/>}{loading?'Reading…':'Extract recipe'}</button></div></div>}{error&&<p className="text-sm text-red-600 mt-3">{error}</p>}</div>);
}

function AddRecipeView({onSave}){
  const[method,setMethod]=useState('form');const[draft,setDraft]=useState(null);
  if(draft)return(<div><div className="flex items-center justify-between mb-6"><h2 className="font-display text-4xl tracking-tight">Review recipe</h2><button onClick={()=>setDraft(null)} className="text-sm text-stone-600 flex items-center gap-1"><ChevronLeft className="w-4 h-4"/> Start over</button></div><RecipeForm initial={draft} onSave={onSave} onCancel={()=>setDraft(null)}/></div>);
  const methods=[{id:'form',label:'Quick form',icon:Edit2,hint:'Type it in'},{id:'paste',label:'Paste text',icon:FileText,hint:'AI structures it'},{id:'url',label:'From URL',icon:LinkIcon,hint:'Fetch & parse'},{id:'photo',label:'From photo',icon:Camera,hint:'OCR & parse'}];
  return(
    <div>
      <h2 className="font-display text-4xl tracking-tight mb-2">Add a recipe</h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-8">{methods.map(m=>{const Icon=m.icon;const active=method===m.id;return(<button key={m.id} onClick={()=>setMethod(m.id)} className={`p-4 rounded-2xl border text-left ${active?'bg-stone-900 text-stone-50 border-stone-900':'bg-white border-stone-200 hover:border-stone-400'}`}><Icon className="w-4 h-4 mb-2" strokeWidth={1.75}/><div className="text-sm font-medium">{m.label}</div><div className={`text-xs mt-0.5 ${active?'text-stone-300':'text-stone-500'}`}>{m.hint}</div></button>);})}</div>
      {method==='form'&&<RecipeForm onSave={onSave}/>}
      {method==='paste'&&<PasteInput onParsed={setDraft}/>}
      {method==='url'&&<URLInput onParsed={setDraft}/>}
      {method==='photo'&&<PhotoInput onParsed={setDraft}/>}
    </div>
  );
}

function LibraryView({recipes,onSelect,onAdd,onSave,onImport}){
  const[showAdd,setShowAdd]=useState(false);
  function handleAdd(){setShowAdd(true);}
  function handleSave(recipe){onSave(recipe);setShowAdd(false);}
  const[search,setSearch]=useState('');const[cuisineFilter,setCuisineFilter]=useState('');const[courseFilter,setCourseFilter]=useState('All');const[sort,setSort]=useState('recent');const[importError,setImportError]=useState(null);const importRef=useRef(null);
  const courseCounts=useMemo(()=>{const c={All:recipes.length};for(const x of COURSES)c[x]=0;for(const r of recipes){const x=r.course||'Main';c[x]=(c[x]||0)+1;}return c;},[recipes]);
  const filtered=useMemo(()=>{let r=[...recipes];if(search.trim()){const q=search.toLowerCase();r=r.filter(x=>x.name.toLowerCase().includes(q)||(x.tags||[]).some(t=>t.toLowerCase().includes(q))||(x.ingredients||[]).some(i=>i.name.toLowerCase().includes(q)));}if(cuisineFilter)r=r.filter(x=>x.cuisine===cuisineFilter);if(courseFilter!=='All')r=r.filter(x=>(x.course||'Main')===courseFilter);if(sort==='recent')r.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));if(sort==='cooked')r.sort((a,b)=>(b.cookCount||0)-(a.cookCount||0));if(sort==='name')r.sort((a,b)=>a.name.localeCompare(b.name));return r;},[recipes,search,cuisineFilter,courseFilter,sort]);
  if(showAdd)return(<div><button onClick={()=>setShowAdd(false)} className="flex items-center gap-1.5 text-sm text-stone-600 mb-6 hover:text-stone-900"><ChevronLeft className="w-4 h-4"/> Back to library</button><AddRecipeView onSave={handleSave}/></div>);
  if(recipes.length===0)return(<div className="text-center py-20"><ChefHat className="w-12 h-12 text-stone-300 mx-auto mb-4" strokeWidth={1.25}/><h2 className="font-display text-3xl mb-2">Your library is empty</h2><p className="text-stone-600 mb-6">Add your first recipe.</p><button onClick={handleAdd} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-stone-900 text-stone-50"><Plus className="w-4 h-4"/> Add a recipe</button></div>);
  const vc=['All',...COURSES.filter(c=>courseCounts[c]>0||c===courseFilter)];
  return(
    <div>
      <input ref={importRef} type="file" accept=".json" className="hidden" onChange={e=>{const f=e.target.files?.[0];if(!f)return;importRecipesFromFile(f,imported=>{onImport(imported);setImportError(null);e.target.value='';},err=>setImportError(err));}}/>
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <h2 className="font-display text-4xl tracking-tight">Library</h2>
        <div className="flex items-center gap-2">
          {importError&&<span className="text-xs text-red-600">{importError}</span>}
          <span className="text-sm text-stone-500">{filtered.length} of {recipes.length}</span>
          <button onClick={handleAdd} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-stone-900 text-stone-50 text-sm hover:bg-stone-800"><Plus className="w-3.5 h-3.5"/> Add</button>
          <button onClick={()=>importRef.current?.click()} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-stone-200 bg-white text-sm text-stone-600 hover:border-stone-400"><Upload className="w-3.5 h-3.5"/><span className="hidden sm:inline">Import</span></button>
          <button onClick={()=>exportRecipes(recipes.reduce((acc,r)=>({...acc,[r.id]:r}),{}))} disabled={recipes.length===0} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-stone-200 bg-white text-sm text-stone-600 hover:border-stone-400 disabled:opacity-40"><Download className="w-3.5 h-3.5"/><span className="hidden sm:inline">Export</span></button>
        </div>
      </div>
      <div className="flex gap-1.5 mb-4 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 pb-1">{vc.map(c=>{const active=courseFilter===c;return(<button key={c} onClick={()=>setCourseFilter(c)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm whitespace-nowrap flex-shrink-0 ${active?'bg-stone-900 text-stone-50':'bg-white border border-stone-200 text-stone-600 hover:border-stone-400'}`}><span>{c}</span><span className="text-xs tabular-nums text-stone-400">{courseCounts[c]||0}</span></button>);})}</div>
      <div className="flex flex-wrap gap-2 mb-6 items-center">
        <div className="relative flex-1 min-w-[200px] max-w-sm"><Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400"/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search recipes, ingredients, tags..." className="w-full pl-9 pr-3 py-2 bg-white border border-stone-200 rounded-full text-sm focus:outline-none focus:border-stone-400"/></div>
        <select value={cuisineFilter} onChange={e=>setCuisineFilter(e.target.value)} className="px-3 py-2 bg-white border border-stone-200 rounded-full text-sm focus:outline-none"><option value="">All cuisines</option>{CUISINES.map(c=><option key={c} value={c}>{c}</option>)}</select>
        <select value={sort} onChange={e=>setSort(e.target.value)} className="px-3 py-2 bg-white border border-stone-200 rounded-full text-sm focus:outline-none"><option value="recent">Recently added</option><option value="cooked">Most cooked</option><option value="name">A–Z</option></select>
      </div>
      {filtered.length===0?<div className="text-center py-12 text-sm text-stone-500">No recipes match.</div>:<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">{filtered.map(r=><RecipeCard key={r.id} recipe={r} onClick={()=>onSelect(r.id)}/>)}</div>}
    </div>
  );
}

function WeekPlanView({recipes,mealPlan,currentWeek,setCurrentWeek,cookedSlots,onPickSlot,onClearSlot,onSelectRecipe,onMarkCooked,onSetMultiplier,onCopyLastWeek}){
  const week=mealPlan[currentWeek]||{};
  const prevWeek=mealPlan[shiftWeek(currentWeek,-1)]||{};
  const dkm=['sun','mon','tue','wed','thu','fri','sat'];
  const[selDayIdx,setSelDayIdx]=useState(()=>{const t=new Date();const todayKey=dkm[t.getDay()];const idx=DAYS.findIndex(d=>d.key===todayKey);return getWeekStart(t)===currentWeek?(idx>=0?idx:0):0;});
  const touchStartX=useRef(null);
  useEffect(()=>{const t=new Date();const todayKey=dkm[t.getDay()];const idx=DAYS.findIndex(d=>d.key===todayKey);setSelDayIdx(getWeekStart(t)===currentWeek?(idx>=0?idx:0):0);},[currentWeek]);
  function onTouchStart(e){touchStartX.current=e.touches[0].clientX;}
  function onTouchEnd(e){if(touchStartX.current===null)return;const dx=e.changedTouches[0].clientX-touchStartX.current;if(Math.abs(dx)>50){if(dx<0)setSelDayIdx(i=>Math.min(i+1,DAYS.length-1));else setSelDayIdx(i=>Math.max(i-1,0));}touchStartX.current=null;}
  function renderDay(d){
    const dp=week[d.key]||{};
    return(
      <div className="bg-white border border-stone-200 rounded-2xl p-3">
        <div className="text-xs uppercase tracking-wider text-stone-500 font-medium mb-2 px-1">{d.label}</div>
        <div className="space-y-2">
          {MEALS.map(m=>{
            const slot=normalizeSlot(dp[m]);const isEatingOut=slot?.slotType==='eating_out';const isLO=!!slot?.leftoverFrom;const origin=isLO?getOriginSlot(week,slot,prevWeek):slot;const rid=origin?.recipeId,recipe=rid?recipes[rid]:null,orphaned=isLO&&!recipe;const sk=`${d.key}_${m}`,ck=isLO&&slot?.leftoverFrom?`${slot.leftoverFrom.day}_${slot.leftoverFrom.meal}`:sk;const isCooked=!!cookedSlots[ck],mul=origin?.multiplier||1;const olabel=isLO&&slot?.leftoverFrom?`${DAYS.find(x=>x.key===slot.leftoverFrom.day)?.label.slice(0,3)} ${slot.leftoverFrom.meal}`:null;
            return(
              <div key={m} className={`border rounded-lg p-2 min-h-[64px] ${isCooked?'border-emerald-200 bg-emerald-50/40':isEatingOut?'border-amber-200 bg-amber-50/30':isLO?'border-stone-100 bg-stone-50/40':'border-stone-100'}`}>
                <div className="flex items-center justify-between mb-1 gap-1">
                  <span className="text-[10px] uppercase tracking-wider text-stone-400">{m}</span>
                  <div className="flex items-center gap-1">
                    {isEatingOut&&<span className="text-[9px] uppercase text-amber-700 font-medium px-1.5 py-0.5 bg-amber-100 rounded-full">eating out</span>}
                    {isLO&&!orphaned&&!isEatingOut&&<span className="text-[9px] uppercase text-stone-500 font-medium px-1.5 py-0.5 bg-stone-100 rounded-full">leftover</span>}
                    {!isLO&&!isEatingOut&&mul>1&&<span className="text-[10px] font-bold text-orange-700 px-1.5 py-0.5 bg-orange-50 rounded-full">×{mul}</span>}
                    {isCooked&&<Check className="w-3 h-3 text-emerald-700" strokeWidth={3}/>}
                  </div>
                </div>
                {isEatingOut?(<div className="flex items-center justify-between gap-1"><div className="flex items-center gap-1.5"><UtensilsCrossed className="w-3.5 h-3.5 text-amber-600" strokeWidth={1.75}/><span className="font-display text-sm text-amber-800">{slot.label||'Eating out'}</span></div><button onClick={()=>onClearSlot(d.key,m)} className="text-stone-300 hover:text-red-500"><X className="w-3 h-3"/></button></div>)
                :recipe||orphaned?(<div className="flex items-start justify-between gap-1"><button onClick={()=>recipe&&onSelectRecipe(rid)} disabled={orphaned} className={`font-display text-sm text-left leading-tight hover:text-orange-700 flex-1 ${isCooked?'text-stone-500 line-through':''} ${isLO?'italic text-stone-700':''} ${orphaned?'text-stone-400':''}`}>{orphaned?'(origin deleted)':recipe.name}{olabel&&!orphaned&&<span className="block text-[10px] not-italic text-stone-400 mt-0.5">from {olabel}</span>}</button><div className="flex flex-col gap-1.5 flex-shrink-0">{!isLO&&<><button onClick={()=>onSetMultiplier(d.key,m,mul>=4?1:mul+1)} className="text-[10px] text-stone-500 hover:text-orange-700 font-bold">×{mul}</button><button onClick={()=>onMarkCooked(d.key,m,rid,isCooked)} className={isCooked?'text-emerald-700':'text-stone-300 hover:text-emerald-700'}><ChefHat className="w-3.5 h-3.5"/></button></>}<button onClick={()=>onClearSlot(d.key,m)} className="text-stone-300 hover:text-red-500"><X className="w-3 h-3"/></button></div></div>)
                :(<button onClick={()=>onPickSlot(d.key,m)} className="w-full text-xs text-stone-400 hover:text-stone-700 py-2 rounded-md border border-dashed border-stone-200 hover:border-stone-400">+ Add</button>)}
              </div>
            );
          })}
        </div>
      </div>
    );
  }
  const sel=DAYS[selDayIdx]||DAYS[0];
  return(
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h2 className="font-display text-4xl tracking-tight">This week</h2>
        <div className="flex items-center gap-2">
          <button onClick={()=>setCurrentWeek(shiftWeek(currentWeek,-1))} className="p-2 rounded-full hover:bg-stone-200/60 text-stone-600"><ChevronLeft className="w-5 h-5"/></button>
          <p className="font-display text-lg font-medium">{formatWeekRange(currentWeek)}</p>
          <button onClick={()=>setCurrentWeek(shiftWeek(currentWeek,1))} className="p-2 rounded-full hover:bg-stone-200/60 text-stone-600"><ChevronRight className="w-5 h-5"/></button>
        </div>
        <button onClick={()=>setCurrentWeek(getWeekStart())} className="px-3 py-1.5 rounded-full text-sm border border-stone-200 text-stone-600 hover:bg-stone-100">Today</button>
        <button onClick={onCopyLastWeek} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm border border-stone-200 text-stone-600 hover:bg-stone-100"><Copy className="w-3.5 h-3.5"/> Copy last week</button>
      </div>
      <div className="lg:hidden"><div className="flex gap-1.5 mb-4 overflow-x-auto -mx-4 px-4 pb-1">{DAYS.map((d,i)=>{const dp=week[d.key]||{},filled=MEALS.filter(m=>dp[m]).length,active=selDayIdx===i;return(<button key={d.key} onClick={()=>setSelDayIdx(i)} className={`flex flex-col items-center gap-0.5 px-3.5 py-2 rounded-xl text-xs whitespace-nowrap flex-shrink-0 ${active?'bg-stone-900 text-stone-50':'bg-white border border-stone-200 text-stone-600'}`}><span className="font-medium">{d.label.slice(0,3)}</span><span className="text-[10px] text-stone-400">{filled>0?filled:'–'}</span></button>);})}</div><div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} className="relative overflow-hidden">{renderDay(sel)}<div className="flex justify-between mt-3 px-1"><button onClick={()=>setSelDayIdx(i=>Math.max(i-1,0))} disabled={selDayIdx===0} className="p-1.5 rounded-full text-stone-400 disabled:opacity-0 hover:bg-stone-100"><ChevronLeft className="w-4 h-4"/></button><span className="text-xs text-stone-400 self-center">swipe to navigate</span><button onClick={()=>setSelDayIdx(i=>Math.min(i+1,DAYS.length-1))} disabled={selDayIdx===DAYS.length-1} className="p-1.5 rounded-full text-stone-400 disabled:opacity-0 hover:bg-stone-100"><ChevronRight className="w-4 h-4"/></button></div></div></div>
      <div className="hidden lg:grid lg:grid-cols-7 gap-3">{DAYS.map(d=><div key={d.key}>{renderDay(d)}</div>)}</div>
    </div>
  );
}

function RecipePickerModal({recipes,recipeMap,title,currentWeekPlan,prevWeekPlan,targetSlot,onPick,onPickLeftover,onPickEatingOut,onClose}){
  const[search,setSearch]=useState('');const[mode,setMode]=useState('library');const[eoLabel,setEoLabel]=useState('');const[cuisineFilter,setCuisineFilter]=useState('');
  const availableCuisines=useMemo(()=>[...new Set(recipes.map(r=>r.cuisine).filter(Boolean))].sort(),[recipes]);
  const filtered=recipes.filter(r=>{const matchSearch=!search.trim()||r.name.toLowerCase().includes(search.toLowerCase());const matchCuisine=!cuisineFilter||r.cuisine===cuisineFilter;return matchSearch&&matchCuisine;});
  const origins=useMemo(()=>listOriginSlots(currentWeekPlan||{},prevWeekPlan||{}).filter(o=>!(o.day===targetSlot?.day&&o.meal===targetSlot?.meal)),[currentWeekPlan,prevWeekPlan,targetSlot]);
  const modes=[{id:'library',label:'From library'},{id:'leftover',label:`Leftovers${origins.length>0?` (${origins.length})`:''}`},{id:'eating_out',label:'Eating out'}];
  return(
    <Modal onClose={onClose}>
      <h3 className="font-display text-2xl mb-3">{title}</h3>
      <div className="flex gap-1 mb-4 p-1 bg-stone-100 rounded-full overflow-x-auto">{modes.map(md=><button key={md.id} onClick={()=>setMode(md.id)} className={`flex-1 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap ${mode===md.id?'bg-white text-stone-900 shadow-sm':'text-stone-600'}`}>{md.label}</button>)}</div>
      {mode==='library'&&<><input autoFocus value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search recipes..." className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm focus:outline-none focus:border-stone-500 mb-2"/>{availableCuisines.length>0&&<div className="flex gap-1.5 mb-3 overflow-x-auto pb-1 -mx-1 px-1">{['',  ...availableCuisines].map(c=><button key={c} onClick={()=>setCuisineFilter(c)} className={`flex-shrink-0 px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap ${cuisineFilter===c?'bg-stone-900 text-stone-50':'bg-stone-100 text-stone-600 hover:bg-stone-200'}`}>{c||'All'}</button>)}</div>}<div className="max-h-80 overflow-y-auto space-y-1">{filtered.length===0&&<p className="text-sm text-stone-500 py-6 text-center">No recipes match.</p>}{filtered.map(r=><button key={r.id} onClick={()=>onPick(r.id)} className="w-full text-left p-3 rounded-lg hover:bg-stone-100 flex items-center justify-between"><div><div className="font-display text-base">{r.name}</div><div className="text-xs text-stone-500">{r.cuisine} · {((r.prepTime||0)+(r.cookTime||0))}m{r.nutrition?` · ${Math.round(r.nutrition.calories)} cal`:''}</div></div>{r.rating==='up'&&<ThumbsUp className="w-3.5 h-3.5 text-emerald-600" fill="currentColor"/>}</button>)}</div></>}
      {mode==='leftover'&&<div className="max-h-96 overflow-y-auto space-y-1">{origins.length===0&&<p className="text-sm text-stone-500 py-6 text-center">No cooked meals this week to use as leftovers.</p>}{origins.map(o=>{const r=recipeMap[o.recipeId];if(!r)return null;return(<button key={`${o.day}_${o.meal}`} onClick={()=>onPickLeftover(o.day,o.meal)} className="w-full text-left p-3 rounded-lg hover:bg-stone-100"><div className="text-[10px] uppercase tracking-wider text-stone-500">{o.dayLabel} · {o.meal}</div><div className="font-display text-base">{r.name}</div></button>);})}</div>}
      {mode==='eating_out'&&<div className="space-y-4"><div className="flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl"><UtensilsCrossed className="w-6 h-6 text-amber-600 flex-shrink-0" strokeWidth={1.5}/><div><p className="text-sm font-medium text-amber-900">Eating out</p><p className="text-xs text-amber-700">Mark this slot as a restaurant meal</p></div></div><div><label className="text-xs uppercase tracking-wider text-stone-500 font-medium mb-1.5 block">Label (optional)</label><input value={eoLabel} onChange={e=>setEoLabel(e.target.value)} placeholder="e.g. Date night, Tacos…" className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm focus:outline-none focus:border-stone-500" onKeyDown={e=>e.key==='Enter'&&onPickEatingOut(eoLabel||'Eating out')}/></div><button onClick={()=>onPickEatingOut(eoLabel||'Eating out')} className="w-full py-2.5 rounded-full bg-amber-600 text-white text-sm hover:bg-amber-700 flex items-center justify-center gap-2"><UtensilsCrossed className="w-4 h-4"/> Set as eating out</button></div>}
    </Modal>
  );
}

function GroceryView({recipes,mealPlan,currentWeek,setCurrentWeek,pantry,checks,manualItems,onToggleCheck,onAddManualItem,onRemoveManualItem,categoryOrder,onReorderCategories,onAddToPantry}){
  const[showAdd,setShowAdd]=useState(false);
  const[newItem,setNewItem]=useState({name:'',quantity:1,unit:'',category:'other'});
  const[shareStatus,setShareStatus]=useState(null);
  const[editingOrder,setEditingOrder]=useState(false);
  const[shopMode,setShopMode]=useState(false);
  const[shopItems,setShopItems]=useState(null);
  const[shopLoading,setShopLoading]=useState(false);
  const[shopError,setShopError]=useState(null);
  const[pantryToast,setPantryToast]=useState(null);  // name of item just added to pantry
  const pantryToastTimer=useRef(null);
  const shopCacheKey=useRef(null);
  const dragItem=useRef(null);
  const dragOver=useRef(null);
  const orderedCats=useMemo(()=>{const order=categoryOrder||CATEGORIES;const missing=CATEGORIES.filter(c=>!order.includes(c));return[...order,...missing];},[categoryOrder]);
  const nextWeekKey=useMemo(()=>shiftWeek(currentWeek,1),[currentWeek]);
  const hasNextWeekMeals=useMemo(()=>{const nw=mealPlan[nextWeekKey]||{};return DAYS.some(d=>MEALS.some(m=>nw[d.key]?.[m]));},[mealPlan,nextWeekKey]);
  const [includeNextWeek,setIncludeNextWeek]=useState(false);
  const grocery=useMemo(()=>{
    const weeksToAggregate=[currentWeek,...(includeNextWeek?[nextWeekKey]:[])];
    const agg={};
    for(const wk of weeksToAggregate){const week=mealPlan[wk]||{};for(const day of DAYS){const dp=week[day.key]||{};for(const meal of MEALS){const slot=normalizeSlot(dp[meal]);if(!slot||slot.leftoverFrom||slot.slotType==='eating_out')continue;const rid=slot.recipeId;if(!rid)continue;const rec=recipes[rid];if(!rec)continue;const mul=slot.multiplier||1;for(const ing of rec.ingredients||[]){const n=normalizeIngredientName(ing.name);if(pantry.some(p=>normalizeIngredientName(p)===n))continue;const key=`${n}|${(ing.unit||'').toLowerCase()}`;const qty=(ing.quantity||0)*mul;if(agg[key])agg[key].quantity+=qty;else agg[key]={key,name:ing.name,quantity:qty,unit:ing.unit||'',category:ing.category||'other',manual:false};}}}}
    for(const item of manualItems){const key=`manual:${item.id}`;agg[key]={key,name:item.name,quantity:item.quantity||0,unit:item.unit||'',category:item.category||'other',manual:true,manualId:item.id};}
    const bc={};for(const item of Object.values(agg)){if(!bc[item.category])bc[item.category]=[];bc[item.category].push(item);}
    for(const c of Object.keys(bc))bc[c].sort((a,b)=>a.name.localeCompare(b.name));
    return bc;
  },[recipes,mealPlan,currentWeek,nextWeekKey,includeNextWeek,pantry,manualItems]);
  const ti=Object.values(grocery).reduce((s,i)=>s+i.length,0),cc=Object.keys(checks).length;

  // Fingerprint of the current ingredient list — if it changes, cache is stale
  const ingredientFingerprint=useMemo(()=>{
    const allItems=Object.values(grocery).flat().filter(i=>!i.manual);
    return allItems.map(i=>`${i.key}:${i.quantity}`).sort().join('|');
  },[grocery]);

  async function convertToShopUnits(){
    // Use cache if fingerprint hasn't changed
    if(shopItems&&shopCacheKey.current===ingredientFingerprint){setShopMode(true);return;}
    setShopMode(true);setShopLoading(true);setShopError(null);
    try{
      const allItems=Object.values(grocery).flat().filter(i=>!i.manual);
      if(!allItems.length){setShopItems([]);setShopLoading(false);return;}
      const ingredientList=allItems.map(i=>`${fmtUnit(i.quantity,i.unit)} ${i.name} (category: ${i.category})`).join('\n');
      const result=extractJSON(await callAI(
        `You are a US grocery shopping assistant. Convert these recipe ingredient amounts into what a shopper would actually buy at a standard US grocery store. Use realistic US retail package sizes (e.g. bags, bunches, cans, cartons, lbs, oz).

Rules:
- Round up to the nearest standard retail unit — never tell someone to buy a fraction of a package
- For produce sold by weight (chicken, beef, carrots, etc.), give lbs rounded to nearest 0.25lb
- For produce sold by unit (onions, lemons, garlic heads, etc.), give a count
- For produce sold by bag/bunch (baby spinach, kale, herbs, green onions), give bag or bunch count
- For canned goods, give number of standard cans with size (e.g. "1 can (15 oz)")
- For dairy, give standard retail sizes (e.g. "1 pint heavy cream", "1 lb butter")
- For dry goods, give standard sizes (e.g. "1 bag (16 oz) pasta", "1 container (32 oz) chicken broth")
- For spices/condiments needed in small amounts, just say "1 bottle" or "1 jar" — don't specify oz
- Consolidate: if multiple items can be bought together (e.g. a "mixed herb bundle"), suggest that
- Keep the same category as the input item

Ingredients to convert:
${ingredientList}

Return ONLY a JSON array:
[{"key":"original_key","name":"ingredient name","amount":"what to buy (e.g. '2 medium onions', '1 bag (5 oz) baby arugula', '1 lb chicken thighs')","category":"same category as input","note":"optional short tip e.g. 'freeze leftovers'"}]

The "key" must exactly match the input key for each item (format: "normalized_name|unit").`,
        {smart:true,maxTokens:4000}
      ));
      // Add manual items back as-is (they're already user-specified)
      const manualConverted=Object.values(grocery).flat().filter(i=>i.manual).map(i=>({key:i.key,name:i.name,amount:`${fmtUnit(i.quantity,i.unit)}`,category:i.category,manualId:i.manualId,manual:true}));
      setShopItems([...result,...manualConverted]);
      shopCacheKey.current=ingredientFingerprint;
    }catch(e){setShopError('Could not convert. Try again.');setShopMode(false);}
    finally{setShopLoading(false);}
  }

  // Group shop items by category maintaining orderedCats order
  const shopByCategory=useMemo(()=>{
    if(!shopItems)return{};
    const bc={};
    for(const item of shopItems){if(!bc[item.category])bc[item.category]=[];bc[item.category].push(item);}
    return bc;
  },[shopItems]);

  function handleDragStart(e,idx){dragItem.current=idx;e.dataTransfer.effectAllowed='move';}
  function handleDragEnter(idx){dragOver.current=idx;}
  function handleDragEnd(){if(dragItem.current===null||dragOver.current===null||dragItem.current===dragOver.current){dragItem.current=null;dragOver.current=null;return;}const newOrder=[...orderedCats];const[moved]=newOrder.splice(dragItem.current,1);newOrder.splice(dragOver.current,0,moved);onReorderCategories(newOrder);dragItem.current=null;dragOver.current=null;}

  function buildShareText(){
    if(shopMode&&shopItems){
      const lines=[`🛒 Grocery list — ${formatWeekRange(currentWeek)}`,`${shopItems.length} items\n`];
      for(const cat of orderedCats.filter(c=>shopByCategory[c]?.length>0)){
        lines.push(cat.toUpperCase());
        for(const item of shopByCategory[cat]){const checked=!!checks[item.key];lines.push(`${checked?'✓':'-'} ${item.amount} ${item.name}`);}
        lines.push('');
      }
      return lines.join('\n').trim();
    }
    const lines=[`🛒 Grocery list — ${formatWeekRange(currentWeek)}`,`${ti} items\n`];
    for(const cat of orderedCats.filter(c=>grocery[c]?.length>0)){lines.push(`${cat.toUpperCase()}`);for(const item of grocery[cat]){const checked=!!checks[item.key];lines.push(`${checked?'✓':'-'} ${fmtUnit(item.quantity,item.unit)} ${item.name}`);}lines.push('');}
    return lines.join('\n').trim();
  }
  async function shareList(){const text=buildShareText();if(navigator.share){try{await navigator.share({title:'Mise grocery list',text});setShareStatus('shared');}catch(e){if(e.name!=='AbortError')fallbackCopy(text);}}else{fallbackCopy(text);}setTimeout(()=>setShareStatus(null),2500);}
  function fallbackCopy(text){navigator.clipboard.writeText(text).then(()=>setShareStatus('copied')).catch(()=>{const ta=document.createElement('textarea');ta.value=text;document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);setShareStatus('copied');});}
  function handleAdd(){if(!newItem.name.trim())return;onAddManualItem({name:newItem.name.trim(),quantity:newItem.quantity||1,unit:newItem.unit.trim(),category:newItem.category});setNewItem({name:'',quantity:1,unit:'',category:'other'});setShopItems(null);setShowAdd(false);}
  function handleAddToPantry(name){
    onAddToPantry(name);
    if(pantryToastTimer.current)clearTimeout(pantryToastTimer.current);
    setPantryToast(name);
    pantryToastTimer.current=setTimeout(()=>setPantryToast(null),2500);
  }

  return(
    <div>
      {pantryToast&&(
        <div className="fixed bottom-20 sm:bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2.5 bg-stone-900 text-stone-50 rounded-full text-sm shadow-lg pointer-events-none whitespace-nowrap">
          <Package className="w-3.5 h-3.5 text-orange-400 flex-shrink-0"/>
          <span><span className="font-medium capitalize">{pantryToast}</span> added to pantry</span>
        </div>
      )}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div><h2 className="font-display text-4xl tracking-tight">Grocery list</h2><p className="text-stone-600 text-sm mt-1">{includeNextWeek?`${formatWeekRange(currentWeek)} + next week`:`${formatWeekRange(currentWeek)}`} · {ti} items · {cc} checked</p></div>
        <div className="flex items-center gap-1">
          <button onClick={()=>setCurrentWeek(shiftWeek(currentWeek,-1))} className="p-2 rounded-full hover:bg-stone-200/60 text-stone-600"><ChevronLeft className="w-5 h-5"/></button>
          <p className="font-display text-base font-medium">{formatWeekRange(currentWeek)}</p>
          <button onClick={()=>setCurrentWeek(shiftWeek(currentWeek,1))} className="p-2 rounded-full hover:bg-stone-200/60 text-stone-600"><ChevronRight className="w-5 h-5"/></button>
          <button onClick={()=>setCurrentWeek(getWeekStart())} className="px-3 py-1.5 rounded-full text-sm border border-stone-200 text-stone-600 hover:bg-stone-100">Today</button>
        </div>
      </div>

      {/* Mode toggle + action buttons */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {ti>0&&(
          <div className="flex items-center p-1 bg-stone-100 rounded-full">
            <button onClick={()=>setShopMode(false)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${!shopMode?'bg-white text-stone-900 shadow-sm':'text-stone-500 hover:text-stone-700'}`}>
              <ListOrdered className="w-3.5 h-3.5"/> Recipe amounts
            </button>
            <button onClick={convertToShopUnits} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${shopMode?'bg-white text-stone-900 shadow-sm':'text-stone-500 hover:text-stone-700'}`}>
              {shopLoading?<Loader2 className="w-3.5 h-3.5 animate-spin"/>:<ShoppingCart className="w-3.5 h-3.5"/>}
              Shopping units
            </button>
          </div>
        )}
        {ti>0&&<button onClick={shareList} className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm transition-colors ${shareStatus==='shared'||shareStatus==='copied'?'bg-emerald-50 text-emerald-700 border border-emerald-200':'bg-white border border-stone-200 text-stone-600 hover:border-stone-400'}`}>{shareStatus==='shared'?<><Check className="w-4 h-4" strokeWidth={3}/> Shared!</>:shareStatus==='copied'?<><Check className="w-4 h-4" strokeWidth={3}/> Copied!</>:<><Share2 className="w-4 h-4"/> Share list</>}</button>}
        {ti>0&&!shopMode&&<button onClick={()=>setEditingOrder(e=>!e)} className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm transition-colors ${editingOrder?'bg-stone-900 text-white':'bg-white border border-stone-200 text-stone-600 hover:border-stone-400'}`}><ListOrdered className="w-4 h-4"/> {editingOrder?'Done':'Reorder'}</button>}
        {shopMode&&shopItems&&<button onClick={()=>{setShopItems(null);shopCacheKey.current=null;convertToShopUnits();}} className="flex items-center gap-1.5 px-3 py-2 rounded-full text-sm bg-white border border-stone-200 text-stone-600 hover:border-stone-400"><RefreshCw className="w-3.5 h-3.5"/> Refresh</button>}
      </div>

      {hasNextWeekMeals&&(
        <div className={`flex items-center justify-between gap-3 px-4 py-3 rounded-xl mb-4 border ${includeNextWeek?'bg-orange-50 border-orange-200':'bg-stone-50 border-stone-200'}`}>
          <div>
            <p className="text-sm font-medium text-stone-800">Include next week</p>
            <p className="text-xs text-stone-500">You have meals planned for {formatWeekRange(nextWeekKey)}</p>
          </div>
          <button onClick={()=>{setIncludeNextWeek(v=>!v);setShopItems(null);}} className={`relative w-10 h-6 rounded-full transition-colors flex-shrink-0 ${includeNextWeek?'bg-orange-600':'bg-stone-300'}`}>
            <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${includeNextWeek?'left-5':'left-1'}`}/>
          </button>
        </div>
      )}
      {shopError&&<p className="text-sm text-red-600 mb-4">{shopError}</p>}

      {/* Shopping units mode banner */}
      {shopMode&&!shopLoading&&shopItems&&(
        <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-xl mb-4 text-xs text-emerald-700">
          <Sparkles className="w-3.5 h-3.5 flex-shrink-0"/>
          <span>Converted to US retail sizes · amounts may vary by brand</span>
        </div>
      )}
      {shopMode&&shopLoading&&(
        <div className="flex items-center gap-2 py-8 justify-center text-stone-500 mb-4">
          <Loader2 className="w-5 h-5 animate-spin text-orange-600"/>
          <span>Converting to shopping units…</span>
        </div>
      )}

      {!shopMode&&editingOrder&&(
        <div className="bg-white border border-stone-200 rounded-2xl p-4 mb-4">
          <p className="text-xs uppercase tracking-wider text-stone-500 font-medium mb-3">Drag to reorder — match your store layout</p>
          <div className="space-y-1">{orderedCats.map((cat,idx)=>(<div key={cat} draggable onDragStart={e=>handleDragStart(e,idx)} onDragEnter={()=>handleDragEnter(idx)} onDragEnd={handleDragEnd} onDragOver={e=>e.preventDefault()} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-grab active:cursor-grabbing select-none ${grocery[cat]?.length>0?'bg-stone-50 border border-stone-200':'opacity-40'}`}><GripVertical className="w-4 h-4 text-stone-400 flex-shrink-0"/><span className="text-sm capitalize flex-1">{cat}</span>{grocery[cat]?.length>0&&<span className="text-xs text-stone-400">{grocery[cat].length} item{grocery[cat].length!==1?'s':''}</span>}</div>))}</div>
        </div>
      )}

      <div className="mb-4">{!showAdd?<button onClick={()=>setShowAdd(true)} className="text-sm text-orange-700 flex items-center gap-1"><Plus className="w-3.5 h-3.5"/> Add an item</button>:(<div className="bg-white border border-stone-200 rounded-xl p-3 grid grid-cols-2 sm:grid-cols-12 gap-2"><input type="number" step="0.25" min="0" value={newItem.quantity} onChange={e=>setNewItem({...newItem,quantity:parseFloat(e.target.value)||0})} placeholder="qty" className="px-2 py-1.5 bg-stone-50 border border-stone-200 rounded-md text-sm sm:col-span-2"/><input value={newItem.unit} onChange={e=>setNewItem({...newItem,unit:e.target.value})} placeholder="unit" className="px-2 py-1.5 bg-stone-50 border border-stone-200 rounded-md text-sm sm:col-span-2"/><input value={newItem.name} onChange={e=>setNewItem({...newItem,name:e.target.value})} onKeyDown={e=>e.key==='Enter'&&handleAdd()} placeholder="item name" autoFocus className="px-2 py-1.5 bg-stone-50 border border-stone-200 rounded-md text-sm col-span-2 sm:col-span-4"/><select value={newItem.category} onChange={e=>setNewItem({...newItem,category:e.target.value})} className="px-2 py-1.5 bg-stone-50 border border-stone-200 rounded-md text-sm col-span-1 sm:col-span-2">{CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}</select><button onClick={handleAdd} disabled={!newItem.name.trim()} className="px-3 py-1.5 rounded-md bg-stone-900 text-white text-sm disabled:opacity-50 sm:col-span-1">Add</button><button onClick={()=>{setShowAdd(false);setNewItem({name:'',quantity:1,unit:'',category:'other'});}} className="text-stone-400 hover:text-stone-700 sm:col-span-1 flex items-center justify-center"><X className="w-4 h-4"/></button></div>)}</div>

      {ti===0?(
        <div className="bg-white border border-stone-200 rounded-2xl p-10 text-center"><ShoppingCart className="w-10 h-10 text-stone-300 mx-auto mb-3" strokeWidth={1.25}/><p className="text-stone-600">Your list is empty.</p></div>
      ):shopMode&&shopItems&&!shopLoading?(
        // Shopping units view
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {orderedCats.filter(c=>shopByCategory[c]?.length>0).map(cat=>(
            <div key={cat} className="bg-white border border-stone-200 rounded-2xl p-5">
              <h3 className="font-display text-lg mb-3 capitalize text-orange-800">{cat}</h3>
              <div className="space-y-1">
                {shopByCategory[cat].map(item=>{
                  const checked=!!checks[item.key];
                  return(
                    <div key={item.key} className="flex items-start">
                      <button onClick={()=>onToggleCheck(item.key)} className="flex-1 flex items-start gap-3 py-1.5 px-2 rounded-md hover:bg-stone-50 text-left">
                        <div className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${checked?'bg-emerald-700 border-emerald-700':'border-stone-300'}`}>{checked&&<Check className="w-3 h-3 text-white" strokeWidth={3}/>}</div>
                        <div className="flex-1">
                          <span className={`text-sm ${checked?'line-through text-stone-400':'text-stone-800'}`}>
                            <span className="font-medium">{item.amount}</span>{' '}{item.name}
                          </span>
                          {item.note&&!checked&&<p className="text-[10px] text-stone-400 mt-0.5">{item.note}</p>}
                        </div>
                      </button>
                      {!item.manual&&<button onClick={()=>handleAddToPantry(item.name)} title="Add to pantry staples" className="p-1.5 text-stone-300 hover:text-orange-600 mt-0.5 flex-shrink-0"><Package className="w-3.5 h-3.5"/></button>}
                      {item.manual&&<button onClick={()=>onRemoveManualItem(item.manualId)} className="p-1.5 text-stone-300 hover:text-red-600 mt-0.5"><X className="w-3.5 h-3.5"/></button>}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ):(
        // Recipe amounts view (default)
        !shopMode&&<div className="grid grid-cols-1 md:grid-cols-2 gap-4">{orderedCats.filter(c=>grocery[c]?.length>0).map(cat=>(<div key={cat} className="bg-white border border-stone-200 rounded-2xl p-5"><h3 className="font-display text-lg mb-3 capitalize text-orange-800">{cat}</h3><div className="space-y-1">{grocery[cat].map(item=>{const checked=!!checks[item.key],ig=ingredientToGrams({quantity:item.quantity,unit:item.unit,name:item.name}),gl=ig!=null?formatGrams(ig):null;return(<div key={item.key} className="flex items-center"><button onClick={()=>onToggleCheck(item.key)} className="flex-1 flex items-center gap-3 py-1.5 px-2 rounded-md hover:bg-stone-50 text-left"><div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${checked?'bg-emerald-700 border-emerald-700':'border-stone-300'}`}>{checked&&<Check className="w-3 h-3 text-white" strokeWidth={3}/>}</div><span className={`text-sm flex-1 ${checked?'line-through text-stone-400':'text-stone-800'}`}><span className="font-medium">{fmtUnit(item.quantity,item.unit)}</span>{' '}{item.name}{gl&&<span className="text-stone-400 ml-1.5 text-xs">({gl})</span>}</span></button>{!item.manual&&<button onClick={()=>handleAddToPantry(item.name)} title="Add to pantry staples" className="p-1.5 text-stone-300 hover:text-orange-600 flex-shrink-0"><Package className="w-3.5 h-3.5"/></button>}{item.manual&&<button onClick={()=>onRemoveManualItem(item.manualId)} className="p-1.5 text-stone-300 hover:text-red-600"><X className="w-3.5 h-3.5"/></button>}</div>);})}</div></div>))}</div>
      )}
    </div>
  );
}

function CookReviewCard({recipe,onClose,onSave}){
  const[rating,setRating]=useState(null);const[notes,setNotes]=useState('');
  function submit(){onSave(recipe.id,{date:Date.now(),rating,notes:notes.trim()});onClose();}
  return(
    <div className="bg-white border border-stone-200 rounded-2xl p-5 space-y-4">
      <div className="flex items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-wider text-orange-700 mb-1">Review cook</p><h3 className="font-display text-xl font-medium">{recipe.name}</h3></div><button onClick={onClose} className="p-1.5 rounded-full hover:bg-stone-100 text-stone-400"><X className="w-4 h-4"/></button></div>
      <div><p className="text-xs uppercase tracking-wider text-stone-500 font-medium mb-2">How did it go?</p><div className="flex gap-2">{[1,2,3,4,5].map(s=>(<button key={s} onClick={()=>setRating(s)} className={`w-9 h-9 rounded-full border flex items-center justify-center text-lg transition-colors ${rating>=s?'bg-orange-50 border-orange-300 text-orange-600':'border-stone-200 text-stone-300 hover:border-stone-400'}`}>★</button>))}</div></div>
      <div><p className="text-xs uppercase tracking-wider text-stone-500 font-medium mb-2">Notes (optional)</p><textarea value={notes} onChange={e=>setNotes(e.target.value)} rows={3} placeholder="Added extra garlic, used thighs instead of breasts…" className="w-full px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-lg text-sm focus:outline-none focus:border-stone-500 resize-none"/></div>
      <div className="flex gap-2 justify-end"><button onClick={onClose} className="px-4 py-2 rounded-full text-sm text-stone-600 hover:bg-stone-100">Skip</button><button onClick={submit} className="px-4 py-2 rounded-full bg-stone-900 text-stone-50 text-sm flex items-center gap-1.5"><Check className="w-3.5 h-3.5"/> Save review</button></div>
    </div>
  );
}



function MealHistorySection({mealHistory,recipes,onEditEntry,onDeleteEntry,onClearAll}){
  const cutoff=Date.now()-30*24*60*60*1000;
  const recent=(mealHistory||[]).filter(h=>h.date>cutoff).sort((a,b)=>b.date-a.date);
  const[editingId,setEditingId]=useState(null);
  const[editForm,setEditForm]=useState({});
  const[confirmClear,setConfirmClear]=useState(false);
  function startEdit(h){setEditingId(h.id);setEditForm({label:h.label||h.text||'',meal:h.meal||'dinner'});}
  function saveEdit(){onEditEntry(editingId,editForm);setEditingId(null);}
  if(recent.length===0)return(<div className="bg-white border border-stone-200 rounded-2xl p-5"><h3 className="font-display text-lg mb-2 flex items-center gap-2"><History className="w-4 h-4 text-stone-500"/> Meal history</h3><p className="text-sm text-stone-500">No meals logged yet. Use quick log or mark meals as cooked.</p></div>);
  const byDate={};for(const h of recent){const d=new Date(h.date).toLocaleDateString('en-US',{month:'short',day:'numeric',weekday:'short'});if(!byDate[d])byDate[d]=[];byDate[d].push(h);}
  return(
    <div className="bg-white border border-stone-200 rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-display text-lg flex items-center gap-2"><History className="w-4 h-4 text-stone-500"/> Last 30 days</h3>
        {!confirmClear
          ?<button onClick={()=>setConfirmClear(true)} className="text-xs text-stone-400 hover:text-red-600 flex items-center gap-1"><Trash2 className="w-3 h-3"/> Clear all</button>
          :<div className="flex items-center gap-2">
            <span className="text-xs text-stone-500">Reset cook history too?</span>
            <button onClick={()=>{onClearAll();setConfirmClear(false);}} className="text-xs px-2.5 py-1 rounded-full bg-red-600 text-white hover:bg-red-700">Yes, clear</button>
            <button onClick={()=>setConfirmClear(false)} className="text-xs px-2.5 py-1 rounded-full border border-stone-200 text-stone-600 hover:bg-stone-50">Cancel</button>
          </div>
        }
      </div>
      <div className="space-y-4">{Object.entries(byDate).slice(0,14).map(([date,entries])=>(
        <div key={date}>
          <p className="text-xs uppercase tracking-wider text-stone-400 font-medium mb-1.5">{date}</p>
          <div className="space-y-1">{entries.map((h,i)=>{
            const recipe=h.recipeId?recipes[h.recipeId]:null;
            if(editingId===h.id)return(
              <div key={i} className="bg-stone-100 rounded-xl p-3 space-y-2">
                <input value={editForm.label} onChange={e=>setEditForm(f=>({...f,label:e.target.value}))} className="w-full px-2 py-1.5 bg-white border border-stone-200 rounded-lg text-sm focus:outline-none"/>
                <div className="flex gap-2">
                  <select value={editForm.meal} onChange={e=>setEditForm(f=>({...f,meal:e.target.value}))} className="px-2 py-1.5 bg-white border border-stone-200 rounded-lg text-sm focus:outline-none flex-1">{MEALS.map(m=><option key={m} value={m}>{m.charAt(0).toUpperCase()+m.slice(1)}</option>)}</select>
                  <button onClick={saveEdit} className="px-3 py-1.5 rounded-lg bg-stone-900 text-white text-xs">Save</button>
                  <button onClick={()=>setEditingId(null)} className="px-3 py-1.5 rounded-lg border border-stone-200 text-xs text-stone-600">Cancel</button>
                </div>
              </div>
            );
            return(
              <div key={i} className="flex items-center gap-2 py-1.5 px-2 rounded-lg bg-stone-50 group">
                <span className="text-xs text-stone-400 w-14 flex-shrink-0 capitalize">{h.meal||''}</span>
                {h.slotType==='eating_out'?<UtensilsCrossed className="w-3.5 h-3.5 text-amber-500 flex-shrink-0"/>:<ChefHat className="w-3.5 h-3.5 text-orange-400 flex-shrink-0"/>}
                <span className="text-sm text-stone-700 flex-1">{recipe?.name||h.label||h.text||'Meal'}</span>
                {h.rating&&<span className="text-xs text-orange-500">{'★'.repeat(h.rating)}</span>}
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                  <button onClick={()=>startEdit(h)} className="p-1 rounded text-stone-400 hover:text-stone-700"><Edit2 className="w-3 h-3"/></button>
                  <button onClick={()=>onDeleteEntry(h.id,h.recipeId)} className="p-1 rounded text-stone-400 hover:text-red-600"><Trash2 className="w-3 h-3"/></button>
                </div>
              </div>
            );
          })}</div>
        </div>
      ))}</div>
    </div>
  );
}

function InsightsView({recipes,onSaveRecipe,mealHistory,cookLog,onEditMealHistory,onDeleteMealHistory,onClearAllMealHistory,onClearInsights}){

  const stats=useMemo(()=>{const total=recipes.length,ctm=recipes.filter(r=>r.lastCooked&&(Date.now()-r.lastCooked)/86400000<=30).length;const cc={},ic={};let tct=0,tr=0;for(const r of recipes){cc[r.cuisine||'Other']=(cc[r.cuisine||'Other']||0)+1;for(const ing of r.ingredients||[]){const n=normalizeIngredientName(ing.name);ic[n]=(ic[n]||0)+1;}const t=(r.prepTime||0)+(r.cookTime||0);if(t>0){tct+=t;tr++;}}return{total,cookedThisMonth:ctm,cuisineRanked:Object.entries(cc).sort((a,b)=>b[1]-a[1]),ingredientRanked:Object.entries(ic).sort((a,b)=>b[1]-a[1]).slice(0,10),topRated:recipes.filter(r=>r.rating==='up').slice(0,5),mostCooked:[...recipes].sort((a,b)=>(b.cookCount||0)-(a.cookCount||0)).filter(r=>r.cookCount>0).slice(0,5),avgTime:tr?Math.round(tct/tr):0};},[recipes]);


  const[confirmClearInsights,setConfirmClearInsights]=useState(false);
  if(recipes.length<3)return(<div className="text-center py-20"><Sparkles className="w-10 h-10 text-stone-300 mx-auto mb-3" strokeWidth={1.25}/><h2 className="font-display text-3xl mb-2">Insights coming soon</h2><p className="text-stone-600">Add a few more recipes to see patterns.</p></div>);
  const mx=stats.cuisineRanked[0]?.[1]||1;
  const recipeMap=useMemo(()=>Object.fromEntries(recipes.map(r=>[r.id,r])),[recipes]);
  return(
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h2 className="font-display text-4xl tracking-tight">Insights</h2>
        {!confirmClearInsights
          ?<button onClick={()=>setConfirmClearInsights(true)} className="flex items-center gap-1.5 text-xs text-stone-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5"/> Reset dashboard</button>
          :<div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
            <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0"/>
            <span className="text-xs text-red-800">Clears all cook history, ratings, meal logs. Cannot be undone.</span>
            <button onClick={()=>{onClearInsights();setConfirmClearInsights(false);}} className="flex-shrink-0 px-3 py-1 rounded-full bg-red-600 text-white text-xs hover:bg-red-700">Yes, reset</button>
            <button onClick={()=>setConfirmClearInsights(false)} className="flex-shrink-0 px-3 py-1 rounded-full border border-red-200 text-red-700 text-xs hover:bg-red-50">Cancel</button>
          </div>
        }
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6"><StatCard label="Recipes" value={stats.total}/><StatCard label="Cooked this month" value={stats.cookedThisMonth}/><StatCard label="Avg total time" value={`${stats.avgTime}m`}/><StatCard label="Top rated" value={stats.topRated.length}/></div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6"><div className="bg-white border border-stone-200 rounded-2xl p-5"><h3 className="font-display text-lg mb-3">Cuisine breakdown</h3><div className="space-y-2">{stats.cuisineRanked.slice(0,6).map(([c,n])=>(<div key={c} className="flex items-center gap-3"><span className="text-sm text-stone-600 w-32 truncate">{c}</span><div className="flex-1 bg-stone-100 rounded-full h-1.5 overflow-hidden"><div className="h-full bg-orange-700" style={{width:`${(n/mx)*100}%`}}/></div><span className="text-xs text-stone-500 w-6 text-right">{n}</span></div>))}</div></div><div className="bg-white border border-stone-200 rounded-2xl p-5"><h3 className="font-display text-lg mb-3">Most-used ingredients</h3><div className="flex flex-wrap gap-2">{stats.ingredientRanked.map(([i,n])=><span key={i} className="text-xs px-2.5 py-1 bg-stone-100 text-stone-700 rounded-full">{i} <span className="text-stone-400">·{n}</span></span>)}</div></div></div>
      {(stats.mostCooked.length>0||stats.topRated.length>0)&&<div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">{stats.mostCooked.length>0&&<div className="bg-white border border-stone-200 rounded-2xl p-5"><h3 className="font-display text-lg mb-3 flex items-center gap-2"><Flame className="w-4 h-4 text-orange-700"/> Most cooked</h3><div className="space-y-1.5">{stats.mostCooked.map(r=><div key={r.id} className="flex items-center justify-between text-sm"><span className="font-display">{r.name}</span><span className="text-stone-500">×{r.cookCount}</span></div>)}</div></div>}{stats.topRated.length>0&&<div className="bg-white border border-stone-200 rounded-2xl p-5"><h3 className="font-display text-lg mb-3 flex items-center gap-2"><ThumbsUp className="w-4 h-4 text-emerald-600"/> Loved</h3><div className="space-y-1.5">{stats.topRated.map(r=><div key={r.id} className="text-sm font-display">{r.name}</div>)}</div></div>}</div>}
      <div className="mb-6"><MealHistorySection mealHistory={mealHistory} recipes={recipeMap} onEditEntry={onEditMealHistory} onDeleteEntry={onDeleteMealHistory} onClearAll={onClearAllMealHistory}/></div>
      <div className="bg-orange-50 border border-orange-200 rounded-2xl p-5 flex items-start gap-3"><Sparkles className="w-5 h-5 text-orange-600 flex-shrink-0 mt-0.5"/><div><p className="text-sm font-medium text-orange-900 mb-1">Looking for new recipes?</p><p className="text-sm text-orange-800">Use the meal assistant on the Home tab — tell it to search the internet for a recipe that fits your taste and it will find, parse, and save it for you.</p></div></div>
    </div>
  );
}

function StatCard({label,value}){return(<div className="bg-white border border-stone-200 rounded-2xl p-4"><div className="text-xs uppercase tracking-wider text-stone-500 mb-1">{label}</div><div className="font-display text-3xl font-medium">{value}</div></div>);}

function PantryView({pantry,onToggle}){
  const[input,setInput]=useState('');
  return(<div><h2 className="font-display text-4xl tracking-tight mb-2">Pantry staples</h2><p className="text-stone-600 text-sm mb-6">Items here are excluded from your grocery list.</p><div className="bg-white border border-stone-200 rounded-2xl p-5 mb-4"><div className="flex gap-2"><input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&(onToggle(input),setInput(''))} placeholder="e.g. soy sauce" className="flex-1 px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm focus:outline-none focus:border-stone-500"/><button onClick={()=>{if(input.trim()){onToggle(input);setInput('');}}} className="px-4 py-2 rounded-lg bg-stone-900 text-stone-50 text-sm">Add</button></div></div><div className="bg-white border border-stone-200 rounded-2xl p-5"><h3 className="font-display text-lg mb-3">{pantry.length} staples</h3><div className="flex flex-wrap gap-2">{pantry.map(item=><button key={item} onClick={()=>onToggle(item)} className="text-sm px-3 py-1 bg-stone-100 text-stone-700 rounded-full hover:bg-red-50 hover:text-red-700 flex items-center gap-1.5">{item}<X className="w-3 h-3 opacity-50"/></button>)}</div></div></div>);
}

function RecipeDetailModal({recipe,onClose,onEdit,onDelete,onCook,onRate,onDuplicate,onSaveCookLog,onSaveRecipe}){
  const tt=(recipe.prepTime||0)+(recipe.cookTime||0),lct=recipe.lastCooked?new Date(recipe.lastCooked).toLocaleDateString('en-US',{month:'short',day:'numeric'}):null;
  const bs=recipe.servings||4;const[srv,setSrv]=useState(bs);const scale=bs?srv/bs:1;const[copied,setCopied]=useState(false);const[showReview,setShowReview]=useState(false);
  useEffect(()=>setSrv(recipe.servings||4),[recipe.id,recipe.servings]);
  function handleShare(){
    const lines=[recipe.name.toUpperCase(),'─'.repeat(Math.min(recipe.name.length,40))];
    if(recipe.cuisine)lines.push(recipe.cuisine);const meta=[];if(recipe.servings)meta.push(`Serves ${recipe.servings}`);if(tt)meta.push(`Total ${tt}m`);if(meta.length)lines.push(meta.join(' · '));
    lines.push('','INGREDIENTS');for(const ing of recipe.ingredients||[]){lines.push(`  ${ing.quantity?fmtUnit(ing.quantity,ing.unit):''} ${ing.name}`.trim());}
    lines.push('','INSTRUCTIONS');(recipe.instructions||[]).forEach((s,i)=>lines.push(`  ${i+1}. ${s}`));
    if(recipe.notes)lines.push('',`Notes: ${recipe.notes}`);
    const text=lines.join('\n');
    if(navigator.share){navigator.share({title:recipe.name,text}).catch(()=>{});}
    else{navigator.clipboard.writeText(text).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),2000);}).catch(()=>{const ta=document.createElement('textarea');ta.value=text;document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);setCopied(true);setTimeout(()=>setCopied(false),2000);});}
  }
  return(
    <Modal onClose={onClose} wide>
      {recipe.photoUrl&&<div className="w-full h-56 overflow-hidden rounded-xl mb-5 -mt-1"><img src={recipe.photoUrl} alt={recipe.name} className="w-full h-full object-cover"/></div>}
      <div className="flex items-start justify-between mb-4 gap-3">
        <div className="flex-1"><div className="text-xs uppercase tracking-wider text-orange-700 mb-1">{recipe.cuisine}{recipe.course&&recipe.course!=='Main'&&<span className="text-stone-400"> · {recipe.course}</span>}</div><h2 className="font-display text-3xl font-medium leading-tight">{recipe.name}</h2>{recipe.notes&&<p className="text-sm text-stone-600 italic mt-2">{recipe.notes}</p>}</div>
        <div className="flex gap-1 mr-8">
          <button onClick={onDuplicate} title="Duplicate" className="p-2 rounded-full hover:bg-stone-100 text-stone-600"><Copy className="w-4 h-4"/></button>
          <button onClick={onEdit} className="p-2 rounded-full hover:bg-stone-100 text-stone-600"><Edit2 className="w-4 h-4"/></button>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-stone-600 border-y border-stone-100 py-3 mb-5 items-center">
        {tt>0&&<span className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5"/> {tt}m total</span>}
        {bs>0&&<div className="flex items-center gap-2"><Users className="w-3.5 h-3.5"/><button onClick={()=>setSrv(Math.max(1,srv-1))} className="w-6 h-6 rounded-full bg-stone-100 hover:bg-stone-200 flex items-center justify-center"><Minus className="w-3 h-3"/></button><span className="font-medium text-stone-800 min-w-[68px] text-center">{srv} {srv===1?'serving':'servings'}</span><button onClick={()=>setSrv(srv+1)} className="w-6 h-6 rounded-full bg-stone-100 hover:bg-stone-200 flex items-center justify-center"><Plus className="w-3 h-3"/></button>{srv!==bs&&<button onClick={()=>setSrv(bs)} className="text-xs text-orange-700">reset</button>}</div>}
        {recipe.cookCount>0&&<span className="flex items-center gap-1.5"><Flame className="w-3.5 h-3.5"/> Cooked {recipe.cookCount}×</span>}
        {lct&&<span className="text-stone-400">Last: {lct}</span>}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-5 gap-6 mb-6">
        <div className="md:col-span-2"><h3 className="font-display text-lg mb-2">Ingredients</h3><ul className="space-y-1">{(recipe.ingredients||[]).map((ing,i)=>{const bg=ingredientToGrams(ing),sg=bg!=null?bg*scale:null,gl=sg!=null?formatGrams(sg):null;return(<li key={i} className="text-sm text-stone-700 flex"><span className="font-medium text-stone-900 w-20 flex-shrink-0">{fmtUnit(ing.quantity*scale,ing.unit)}</span><span className="flex-1">{ing.name}{gl&&<span className="text-stone-400 ml-1.5 text-xs">({gl})</span>}</span></li>);})}</ul></div>
        <div className="md:col-span-3"><h3 className="font-display text-lg mb-2">Instructions</h3><ol className="space-y-3">{(recipe.instructions||[]).map((step,i)=><li key={i} className="text-sm text-stone-700 flex gap-3"><span className="font-display text-lg text-orange-700 w-6 flex-shrink-0">{i+1}.</span><span className="leading-relaxed">{step}</span></li>)}</ol></div>
      </div>
      <div className="mb-5"><NutritionSection recipe={recipe} onSave={onSaveRecipe}/></div>
      {(recipe.tags||[]).length>0&&<div className="flex flex-wrap gap-1.5 mb-5">{recipe.tags.map(t=><span key={t} className="text-xs px-2 py-0.5 bg-stone-100 text-stone-600 rounded-full">{t}</span>)}</div>}
      {recipe.source&&<p className="text-xs text-stone-500 mb-5">Source: {recipe.source}</p>}
      <div className="border-t border-stone-100 pt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2"><span className="text-xs uppercase tracking-wider text-stone-500 mr-1">Rating</span><button onClick={()=>onRate(recipe.rating==='up'?null:'up')} className={`p-1.5 rounded-full ${recipe.rating==='up'?'bg-emerald-50 text-emerald-700':'hover:bg-stone-100 text-stone-400'}`}><ThumbsUp className="w-4 h-4" fill={recipe.rating==='up'?'currentColor':'none'}/></button><button onClick={()=>onRate(recipe.rating==='down'?null:'down')} className={`p-1.5 rounded-full ${recipe.rating==='down'?'bg-red-50 text-red-600':'hover:bg-stone-100 text-stone-400'}`}><ThumbsDown className="w-4 h-4" fill={recipe.rating==='down'?'currentColor':'none'}/></button></div>
        <div className="flex items-center gap-2">
          <button onClick={handleShare} className={`px-3 py-2 rounded-full border text-sm flex items-center gap-1.5 ${copied?'border-emerald-300 bg-emerald-50 text-emerald-700':'border-stone-200 bg-white text-stone-600 hover:border-stone-400'}`}>{copied?<><Check className="w-3.5 h-3.5" strokeWidth={3}/> Copied!</>:<><Share2 className="w-3.5 h-3.5"/> Share</>}</button>
          <button onClick={()=>{onCook();setShowReview(true);}} className="px-4 py-2 rounded-full bg-orange-700 text-white text-sm hover:bg-orange-800 flex items-center gap-2"><ChefHat className="w-4 h-4"/> I made this</button>
        </div>
      </div>
      {showReview&&<div className="mt-4"><CookReviewCard recipe={recipe} onClose={()=>setShowReview(false)} onSave={(id,log)=>{onSaveCookLog(id,log);setShowReview(false);}}/></div>}
    </Modal>
  );
}

function EditRecipeModal({recipe,onSave,onCancel,onDelete}){return(<Modal onClose={onCancel} wide><h2 className="font-display text-2xl mb-4">Edit recipe</h2><RecipeForm initial={recipe} onSave={onSave} onCancel={onCancel} onDelete={onDelete}/></Modal>);}


function CookingOverlay({overlay,onClose,onLogCook,onSaveCookLog,onSaveRecipeGuide,recipes}){
  const{recipe,stepIdx,isMealPrep,multiplier}=overlay;
  const[showIngredients,setShowIngredients]=useState(false);
  const[cookReview,setCookReview]=useState(null);
  const steps=recipe.instructions||[];
  const step=steps[stepIdx];
  const isLast=stepIdx===steps.length-1;
  const allIngs=recipe.ingredients||[];

  if(cookReview){
    return(
      <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div className="bg-stone-50 rounded-2xl w-full max-w-lg p-6">
          <p className="text-xs uppercase tracking-wider text-emerald-700 font-medium mb-4 flex items-center gap-2"><Check className="w-3.5 h-3.5" strokeWidth={3}/> Nice work!</p>
          <CookReviewCard recipe={cookReview} onClose={()=>{setCookReview(null);onClose();}} onSave={(id,log)=>{if(onSaveCookLog)onSaveCookLog(id,log);setCookReview(null);onClose();}}/>
        </div>
      </div>
    );
  }

  return(
    <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-stone-50 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <span className="text-xs uppercase tracking-wider text-orange-700 font-medium">{recipe.name}</span>
              {isMealPrep&&multiplier>1&&<span className="ml-2 text-xs text-stone-400">×{multiplier}</span>}
            </div>
            <button onClick={onClose} className="p-2 rounded-full hover:bg-stone-200 text-stone-500"><X className="w-4 h-4"/></button>
          </div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-stone-400">Step {stepIdx+1} of {steps.length}</span>
          </div>
          <div className="w-full bg-stone-100 rounded-full h-1.5 mb-6">
            <div className="h-full bg-orange-700 rounded-full transition-all" style={{width:`${((stepIdx+1)/steps.length)*100}%`}}/>
          </div>
          <div className="bg-white border border-stone-200 rounded-2xl p-6 mb-4 min-h-[160px] flex flex-col justify-center">
            <span className="font-display text-5xl text-orange-100 font-medium mb-3">{stepIdx+1}.</span>
            <p className="text-stone-800 text-lg leading-relaxed">{step}</p>
          </div>
          <div className="mb-4 bg-white border border-stone-200 rounded-2xl overflow-hidden">
            <button onClick={()=>setShowIngredients(v=>!v)} className="w-full flex items-center justify-between px-4 py-3 text-sm text-stone-600 hover:bg-stone-50">
              <span className="flex items-center gap-2"><Package className="w-3.5 h-3.5"/> All ingredients ({allIngs.length})</span>
              {showIngredients?<ChevronUp className="w-4 h-4"/>:<ChevronDown className="w-4 h-4"/>}
            </button>
            {showIngredients&&<div className="px-4 pb-4 border-t border-stone-100">
              <div className="mt-3 space-y-1">{allIngs.map((ing,i)=>(
                <div key={i} className="flex items-center gap-2 text-sm">
                  <span className="font-medium text-stone-900 w-20 flex-shrink-0 text-xs">{fmtUnit(ing.quantity,ing.unit)}</span>
                  <span className="text-stone-700">{ing.name}</span>
                </div>
              ))}</div>
            </div>}
          </div>
          <div className="flex gap-3">
            <button
              disabled={stepIdx===0}
              onClick={()=>{if(stepIdx>0)onClose({...overlay,stepIdx:stepIdx-1});}}
              className="flex-1 py-3 rounded-full border border-stone-200 text-sm text-stone-600 disabled:opacity-30 hover:bg-stone-50"
            >← Back</button>
            {isLast?(
              <button onClick={()=>{onLogCook&&onLogCook(recipe.id);setCookReview(recipe);}} className="flex-1 py-3 rounded-full bg-emerald-700 text-white text-sm hover:bg-emerald-800 flex items-center justify-center gap-2"><Check className="w-4 h-4"/> Done!</button>
            ):(
              <button onClick={()=>onClose({...overlay,stepIdx:stepIdx+1})} className="flex-1 py-3 rounded-full bg-stone-900 text-white text-sm hover:bg-stone-800">Next step →</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App(){
  const[state,setState,loaded,setLoaded,syncStatus,syncError,lastSynced,manualSync]=useAppState();
  const[view,setView]=useState('home');
  const[selectedRecipeId,setSelectedRecipeId]=useState(null);
  const[cookingOverlay,setCookingOverlay]=useState(null);
  const[editingRecipe,setEditingRecipe]=useState(null);
  const[planTarget,setPlanTarget]=useState(null);
  const[currentWeek,setCurrentWeek]=useState(getWeekStart());

  const recipes=state.recipes;
  const recipeList=useMemo(()=>Object.values(recipes),[recipes]);

  const unreviewedCount=useMemo(()=>{
    const cookLog=state.cookLog||{};let count=0;
    for(const r of recipeList){if(!r.lastCooked)continue;const age=(Date.now()-r.lastCooked)/86400000;if(age>7)continue;const logs=(cookLog[r.id]||[]);const lastLogDate=logs.length>0?logs[logs.length-1].date:0;if(r.lastCooked>lastLogDate)count++;}
    return count;
  },[recipeList,state.cookLog]);

  function saveRecipe(recipe){const id=recipe.id||generateId(),now=Date.now(),existing=recipes[id];setState(s=>({...s,recipes:{...s.recipes,[id]:{cookCount:0,lastCooked:null,rating:null,createdAt:now,...existing,...recipe,id}}}));return id;}
  function deleteRecipe(id){setState(s=>{const{[id]:_,...rest}=s.recipes;return{...s,recipes:rest};});}
  function logCook(id){setState(s=>({...s,recipes:{...s.recipes,[id]:{...s.recipes[id],cookCount:(s.recipes[id].cookCount||0)+1,lastCooked:Date.now()}}}));const recipe=recipes[id];if(recipe)addMealHistory({date:Date.now(),recipeId:id,label:recipe.name,meal:'dinner',slotType:'recipe'});}
  function setRating(id,rating){setState(s=>({...s,recipes:{...s.recipes,[id]:{...s.recipes[id],rating}}}));}
  function saveRecipeGuide(recipeId,guide,isMealPrep){setState(s=>({...s,recipes:{...s.recipes,[recipeId]:{...s.recipes[recipeId],[isMealPrep?'mealPrepGuide':'prepGuide']:guide}}}));}
  function duplicateRecipe(id){const orig=recipes[id];if(!orig)return;const newId=generateId();setState(s=>({...s,recipes:{...s.recipes,[newId]:{...orig,id:newId,name:`${orig.name} (copy)`,createdAt:Date.now(),cookCount:0,lastCooked:null,rating:null}}}));return newId;}
  function saveCookLog(recipeId,logEntry){setState(s=>{const prev=s.cookLog||{};const entries=prev[recipeId]||[];return{...s,cookLog:{...prev,[recipeId]:[...entries,logEntry]}};});}
  function addMealHistory(entry){setState(s=>({...s,mealHistory:[...(s.mealHistory||[]),{...entry,id:generateId()}]}));}
  function editMealHistory(id,updates){setState(s=>({...s,mealHistory:(s.mealHistory||[]).map(h=>h.id===id?{...h,...updates}:h)}));}
  function deleteMealHistory(id,recipeId){
    setState(s=>{
      const newHistory=(s.mealHistory||[]).filter(h=>h.id!==id);
      let rs=s.recipes;
      // Recompute cookCount + lastCooked for affected recipe from remaining history
      if(recipeId&&rs[recipeId]){
        const remaining=newHistory.filter(h=>h.recipeId===recipeId);
        const newCount=remaining.length;
        const newLastCooked=remaining.length>0?Math.max(...remaining.map(h=>h.date)):null;
        rs={...rs,[recipeId]:{...rs[recipeId],cookCount:newCount,lastCooked:newLastCooked}};
      }
      return{...s,mealHistory:newHistory,recipes:rs};
    });
  }
  function clearInsights(){
    setState(s=>{
      const clearedRecipes=Object.fromEntries(Object.entries(s.recipes).map(([id,r])=>[id,{...r,cookCount:0,lastCooked:null,rating:null}]));
      return{...s,recipes:clearedRecipes,mealHistory:[],cookLog:{}};
    });
  }
  function clearAllMealHistory(){
    setState(s=>{
      // Reset cookCount and lastCooked on every recipe that has history
      const affectedIds=new Set((s.mealHistory||[]).map(h=>h.recipeId).filter(Boolean));
      let rs=s.recipes;
      for(const id of affectedIds){
        if(rs[id])rs={...rs,[id]:{...rs[id],cookCount:0,lastCooked:null}};
      }
      return{...s,mealHistory:[],recipes:rs};
    });
  }
  function reorderGroceryCategories(newOrder){setState(s=>({...s,groceryCategoryOrder:newOrder}));}

  // ---------- Prep guide state functions ----------
  function togglePrepCheck(taskId){
    setState(s=>{
      const checks={...(s.weekPrepChecks||{})};
      if(checks[taskId])delete checks[taskId];
      else checks[taskId]=true;
      return{...s,weekPrepChecks:checks};
    });
  }
  function saveWeekPrepGuide(guide){
    setState(s=>({...s,weekPrepGuide:guide,weekPrepChecks:{}}));
  }
  function clearWeekPrepGuide(){
    setState(s=>({...s,weekPrepGuide:null,weekPrepChecks:{}}));
  }

  // ---------- Generate weekly prep guide (7-day lookahead, no day assumption) ----------
  async function generateWeekPrepGuide(){
    // Collect unique recipe IDs from today + next 7 days across current + next week
    const recipeIds=new Set();
    const thisWeekPlan=state.mealPlan[currentWeek]||{};
    const nextWeek=shiftWeek(currentWeek,1);
    const nextWeekPlan=state.mealPlan[nextWeek]||{};

    // Figure out which DAYS keys fall within the next 7 days from today
    const todayKey=getTodayDayKey();
    const dkOrder=['mon','tue','wed','thu','fri','sat','sun'];
    const todayIdx=dkOrder.indexOf(todayKey);

    // Scan from today through 7 days — may span into next week
    for(let i=0;i<7;i++){
      const idx=(todayIdx+i)%7;
      const dk=dkOrder[idx];
      // First 7-todayIdx days come from currentWeek, rest from next week
      const plan=i<(7-todayIdx)?thisWeekPlan:nextWeekPlan;
      const dp=plan[dk]||{};
      for(const m of MEALS){
        const s=normalizeSlot(dp[m]);
        if(s?.recipeId&&!s.leftoverFrom)recipeIds.add(s.recipeId);
      }
    }

    const weekRecipes=[...recipeIds].map(id=>recipes[id]).filter(Boolean);
    if(!weekRecipes.length){
      saveWeekPrepGuide({empty:true});
      return;
    }

    const recipeSummaries=weekRecipes.map(r=>{
      const ings=(r.ingredients||[]).slice(0,6).map(i=>`${fmtUnit(i.quantity,i.unit)} ${i.name}`).join(', ');
      const steps=(r.instructions||[]).slice(0,3).join(' ');
      return`${r.name}: ingredients: ${ings}. Steps: ${steps}`;
    }).join('\n\n');

    try{
      const result=extractJSON(await callAI(
        `You are a meal prep planner. Given the recipes planned for the next 7 days, identify prep tasks that can be done ahead of time to make cooking easier throughout the week. Do NOT assign prep to a specific day — just describe what to prep, how far ahead it can be done, and how to store it.\n\nRecipes:\n${recipeSummaries}\n\nReturn ONLY JSON:\n{"intro":"string","tasks":[{"id":"string","recipe":"string","task":"string","duration":"string","storedUntil":"string","howFarAhead":"string"}]}\n\nMake each task "id" a unique short slug like "task-1", "task-2" etc.`,
        {smart:true}
      ));
      // Ensure all tasks have unique IDs
      if(result.tasks){
        result.tasks=result.tasks.map((t,i)=>({...t,id:t.id||`task-${i+1}`}));
      }
      saveWeekPrepGuide(result);
    }catch(e){
      saveWeekPrepGuide({error:'Could not generate guide. Try again.'});
    }
  }

  // Regenerate: clear then re-generate
  function handleRegeneratePrepGuide(){
    clearWeekPrepGuide();
    generateWeekPrepGuide();
  }



  function copyLastWeekPlan(){
    const lastWeek=shiftWeek(currentWeek,-1);
    const lastPlan=state.mealPlan[lastWeek];
    if(!lastPlan||Object.keys(lastPlan).length===0)return;
    setState(s=>({...s,mealPlan:{...s.mealPlan,[currentWeek]:{...lastPlan}}}));
  }
  function applyWeekPlanFromAI(weekKey,aiPlan){setState(s=>{const existing=s.mealPlan[weekKey]||{};const merged={...existing};for(const dk of DAYS.map(d=>d.key)){if(!aiPlan[dk])continue;merged[dk]={...(merged[dk]||{})};for(const meal of MEALS){const slot=aiPlan[dk][meal];if(slot===undefined)continue;if(slot===null){delete merged[dk][meal];}else if(typeof slot==='string'){merged[dk][meal]={recipeId:slot,multiplier:1,slotType:'recipe'};}else{merged[dk][meal]={multiplier:1,slotType:'recipe',...slot};}}}return{...s,mealPlan:{...s.mealPlan,[weekKey]:merged}};});}
  function planMeal(week,day,meal,slotValue){setState(s=>{const wp=s.mealPlan[week]||{},slotKey=`${day}_${meal}`;const wc=s.cookedSlots[week]||{},newCooked={...wc};delete newCooked[slotKey];const newWeek={...wp};if(slotValue===null){const dp=newWeek[day]||{},nd={...dp};delete nd[meal];newWeek[day]=nd;for(const d of Object.keys(newWeek)){const dm=newWeek[d];if(!dm)continue;for(const m of Object.keys(dm)){const n=normalizeSlot(dm[m]);if(n?.leftoverFrom?.day===day&&n.leftoverFrom.meal===meal){const u={...newWeek[d]};delete u[m];newWeek[d]=u;delete newCooked[`${d}_${m}`];}}}}else{const ns=typeof slotValue==='string'?{recipeId:slotValue,multiplier:1,slotType:'recipe'}:{multiplier:1,slotType:'recipe',...slotValue};newWeek[day]={...(newWeek[day]||{}),[meal]:ns};}return{...s,mealPlan:{...s.mealPlan,[week]:newWeek},cookedSlots:{...s.cookedSlots,[week]:newCooked}};});}
  function setSlotMultiplier(week,day,meal,multiplier){setState(s=>{const wp=s.mealPlan[week]||{},dp=wp[day]||{},slot=normalizeSlot(dp[meal]);if(!slot||slot.leftoverFrom)return s;return{...s,mealPlan:{...s.mealPlan,[week]:{...wp,[day]:{...dp,[meal]:{...slot,multiplier:Math.max(1,Math.min(6,multiplier))}}}}}});}
  function markSlotCooked(week,day,meal,recipeId,currentlyCooked){
    const slotKey=`${day}_${meal}`;
    setState(s=>{const wc=s.cookedSlots[week]||{},newCooked={...wc};if(currentlyCooked){delete newCooked[slotKey];return{...s,cookedSlots:{...s.cookedSlots,[week]:newCooked}};}newCooked[slotKey]={date:Date.now()};const r=s.recipes[recipeId];const ur=r?{...s.recipes,[recipeId]:{...r,cookCount:(r.cookCount||0)+1,lastCooked:Date.now()}}:s.recipes;return{...s,cookedSlots:{...s.cookedSlots,[week]:newCooked},recipes:ur};});
    const recipe=recipes[recipeId];if(recipe&&!currentlyCooked)addMealHistory({date:Date.now(),recipeId,label:recipe.name,meal,slotType:'recipe'});
  }
  function addManualGroceryItem(week,item){setState(s=>{const l=s.manualGrocery[week]||[];return{...s,manualGrocery:{...s.manualGrocery,[week]:[...l,{...item,id:generateId()}]}};});}
  function removeManualGroceryItem(week,id){setState(s=>{const l=s.manualGrocery[week]||[];return{...s,manualGrocery:{...s.manualGrocery,[week]:l.filter(x=>x.id!==id)}};});}
  function togglePantry(item){const n=item.toLowerCase().trim();if(!n)return;setState(s=>({...s,pantry:s.pantry.includes(n)?s.pantry.filter(p=>p!==n):[...s.pantry,n]}));}
  function toggleGroceryCheck(week,key){setState(s=>{const wc=s.groceryChecks[week]||{},nc={...wc};if(nc[key])delete nc[key];else nc[key]=true;return{...s,groceryChecks:{...s.groceryChecks,[week]:nc}};});}

  if(!loaded)return<LoadingScreen onSkip={()=>setLoaded(true)}/>;

  const selectedRecipe=selectedRecipeId?recipes[selectedRecipeId]:null;

  const tabs=[
    {id:'home',label:'Home',icon:Home},
    {id:'library',label:'Library',icon:BookOpen},
    {id:'week',label:'This Week',icon:Calendar},
    {id:'grocery',label:'Grocery',icon:ShoppingCart},
    {id:'insights',label:'Insights',icon:Sparkles,badge:unreviewedCount>0},
    {id:'pantry',label:'Pantry',icon:Package},
  ];
  const mobTabs=[
    {id:'home',label:'Home',icon:Home},
    {id:'library',label:'Library',icon:BookOpen},
    {id:'week',label:'Week',icon:Calendar},
    {id:'grocery',label:'Grocery',icon:ShoppingCart},
    {id:'insights',label:'Insights',icon:Sparkles,badge:unreviewedCount>0},
  ];

  return(
    <div className="paper-bg min-h-screen text-stone-900">
      <header className="border-b border-stone-200 bg-stone-50/80 backdrop-blur sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5"><ChefHat className="w-6 h-6 text-orange-700" strokeWidth={1.75}/><h1 className="font-display text-2xl font-medium tracking-tight">Mise</h1></div>
          <div className="flex items-center gap-3">
            <SyncBadge status={syncStatus} lastSynced={lastSynced} onSync={manualSync}/>
            <span className="text-xs text-stone-400 hidden sm:inline">{recipeList.length} {recipeList.length===1?'recipe':'recipes'}</span>
          </div>
        </div>
        <nav className="hidden sm:flex max-w-6xl mx-auto px-5 pb-3 gap-1 overflow-x-auto">
          {tabs.map(tab=>{const Icon=tab.icon;const active=view===tab.id;return(
            <button key={tab.id} onClick={()=>setView(tab.id)} className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm whitespace-nowrap ${active?'bg-stone-900 text-stone-50':'text-stone-600 hover:bg-stone-200/60'}`}>
              <Icon className="w-3.5 h-3.5" strokeWidth={2}/>{tab.label}
              {tab.badge&&<span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-orange-600 text-white text-[9px] flex items-center justify-center font-bold animate-pulse">{unreviewedCount}</span>}
            </button>
          );})}
        </nav>
      </header>
      {syncStatus==='error'&&<div className="bg-amber-50 border-b border-amber-200 px-5 py-2 text-xs text-amber-800 flex items-center justify-between"><span>⚠️ Sync failed{syncError?`: ${syncError}`:''}.</span><button onClick={manualSync} className="font-medium underline ml-2">Retry</button></div>}
      <main className="max-w-6xl mx-auto px-4 sm:px-5 py-6 sm:py-8 pb-24 sm:pb-8">
        {view==='home'&&<HomeView
          recipes={recipes}
          mealPlan={state.mealPlan}
          currentWeek={currentWeek}
          weekPrepGuide={state.weekPrepGuide}
          weekPrepChecks={state.weekPrepChecks||{}}
          onSelectRecipe={id=>setSelectedRecipeId(id)}
          onGoToWeek={()=>setView('week')}
          onStartCookingOverlay={(recipe,isMealPrep,mul)=>setCookingOverlay({recipe,stepIdx:0,isMealPrep,multiplier:mul||1})}
          onSaveRecipeGuide={saveRecipeGuide}
          onPrepWeek={generateWeekPrepGuide}
          onTogglePrepCheck={togglePrepCheck}
          onRegeneratePrepGuide={handleRegeneratePrepGuide}
          onSaveCookLog={saveCookLog}
          onLogCook={logCook}
          mealHistory={state.mealHistory}
          onApplyWeekPlan={applyWeekPlanFromAI}
          onAddMealHistory={addMealHistory}
          onSaveRecipe={saveRecipe}
          onPlanMeal={planMeal}
        />}
        {view==='library'&&<LibraryView recipes={recipeList} onSelect={id=>setSelectedRecipeId(id)} onAdd={()=>{}} onSave={recipe=>{saveRecipe(recipe);}} onImport={imported=>{setState(s=>({...s,recipes:{...s.recipes,...Object.fromEntries(Object.entries(imported).map(([id,r])=>[id,{...r,id}]))}}));}}/>}
        {view==='week'&&<WeekPlanView recipes={recipes} mealPlan={state.mealPlan} currentWeek={currentWeek} setCurrentWeek={setCurrentWeek} cookedSlots={state.cookedSlots[currentWeek]||{}} onPickSlot={(d,m)=>setPlanTarget({week:currentWeek,day:d,meal:m})} onClearSlot={(d,m)=>planMeal(currentWeek,d,m,null)} onSelectRecipe={id=>setSelectedRecipeId(id)} onMarkCooked={(d,m,rid,c)=>markSlotCooked(currentWeek,d,m,rid,c)} onSetMultiplier={(d,m,mul)=>setSlotMultiplier(currentWeek,d,m,mul)} onCopyLastWeek={copyLastWeekPlan}/>}
        {view==='grocery'&&<GroceryView recipes={recipes} mealPlan={state.mealPlan} currentWeek={currentWeek} setCurrentWeek={setCurrentWeek} pantry={state.pantry} checks={state.groceryChecks[currentWeek]||{}} manualItems={state.manualGrocery[currentWeek]||[]} onToggleCheck={k=>toggleGroceryCheck(currentWeek,k)} onAddManualItem={item=>addManualGroceryItem(currentWeek,item)} onRemoveManualItem={id=>removeManualGroceryItem(currentWeek,id)} categoryOrder={state.groceryCategoryOrder||CATEGORIES} onReorderCategories={reorderGroceryCategories} onAddToPantry={togglePantry}/>}
        {view==='insights'&&<InsightsView recipes={recipeList} onSaveRecipe={r=>saveRecipe(r)} mealHistory={state.mealHistory||[]} cookLog={state.cookLog||{}} onEditMealHistory={editMealHistory} onDeleteMealHistory={deleteMealHistory} onClearAllMealHistory={clearAllMealHistory} onClearInsights={clearInsights}/>}
        {view==='pantry'&&<PantryView pantry={state.pantry} onToggle={togglePantry}/>}
      </main>
      <nav className="sm:hidden fixed bottom-0 left-0 right-0 bg-stone-50/95 backdrop-blur border-t border-stone-200 z-30" style={{paddingBottom:'env(safe-area-inset-bottom,0)'}}>
        <div className="grid grid-cols-5">
          {mobTabs.map(tab=>{const Icon=tab.icon;const active=view===tab.id;return(
            <button key={tab.id} onClick={()=>setView(tab.id)} className={`relative flex flex-col items-center justify-center gap-0.5 py-2 px-1 ${active?'text-orange-700':'text-stone-500 hover:text-stone-700'}`}>
              <Icon className="w-5 h-5" strokeWidth={active?2:1.75}/>
              <span className="text-[10px] font-medium">{tab.label}</span>
              {tab.badge&&<span className="absolute top-1 right-2 w-3.5 h-3.5 rounded-full bg-orange-600 text-white text-[8px] flex items-center justify-center font-bold animate-pulse">{unreviewedCount}</span>}
            </button>
          );})}
        </div>
      </nav>
      {selectedRecipe&&!editingRecipe&&<RecipeDetailModal recipe={selectedRecipe} onClose={()=>setSelectedRecipeId(null)} onEdit={()=>setEditingRecipe(selectedRecipe)} onDelete={()=>{if(confirm(`Delete "${selectedRecipe.name}"?`)){deleteRecipe(selectedRecipe.id);setSelectedRecipeId(null);}}} onCook={()=>logCook(selectedRecipe.id)} onRate={rating=>setRating(selectedRecipe.id,rating)} onDuplicate={()=>{duplicateRecipe(selectedRecipe.id);setSelectedRecipeId(null);}} onSaveCookLog={saveCookLog} onSaveRecipe={saveRecipe}/>}
      {editingRecipe&&<EditRecipeModal recipe={editingRecipe} onSave={r=>{saveRecipe(r);setEditingRecipe(null);}} onCancel={()=>setEditingRecipe(null)} onDelete={()=>{if(confirm(`Delete "${editingRecipe.name}"?`)){deleteRecipe(editingRecipe.id);setEditingRecipe(null);setSelectedRecipeId(null);}}}/>}
      {cookingOverlay&&<CookingOverlay overlay={cookingOverlay} onClose={(updated)=>updated?setCookingOverlay(updated):setCookingOverlay(null)} onLogCook={logCook} onSaveCookLog={saveCookLog} onSaveRecipeGuide={saveRecipeGuide} recipes={recipes}/>}
      {planTarget&&<RecipePickerModal recipes={recipeList} recipeMap={recipes} title={`${planTarget.day} ${planTarget.meal}`} currentWeekPlan={state.mealPlan[planTarget.week]||{}} prevWeekPlan={state.mealPlan[shiftWeek(planTarget.week,-1)]||{}} targetSlot={{day:planTarget.day,meal:planTarget.meal}} onPick={id=>{planMeal(planTarget.week,planTarget.day,planTarget.meal,id);setPlanTarget(null);}} onPickLeftover={(od,om)=>{planMeal(planTarget.week,planTarget.day,planTarget.meal,{leftoverFrom:{day:od,meal:om}});setPlanTarget(null);}} onPickEatingOut={(label)=>{planMeal(planTarget.week,planTarget.day,planTarget.meal,{slotType:'eating_out',label});setPlanTarget(null);}} onClose={()=>setPlanTarget(null)}/>}
    </div>
  );
}
