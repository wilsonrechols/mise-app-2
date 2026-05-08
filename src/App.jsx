import { useState, useEffect, useMemo, useRef } from 'react';
import {
  BookOpen, Calendar, ShoppingCart, Sparkles, Package,
  Plus, Minus, Search, X, Camera, Link as LinkIcon, FileText, Edit2,
  Trash2, ThumbsUp, ThumbsDown, Clock, Users, ChefHat, Loader2,
  Check, ChevronLeft, ChevronRight, Upload, Save, RefreshCw,
  Flame, Cloud, CloudOff, Download, Copy
} from 'lucide-react';

// ---------- Config ----------
const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'https://mise-sync-311883254950.us-central1.run.app';
const SECRET_KEY = import.meta.env.VITE_SECRET_KEY || 'mise-wilson-2026';
const STORAGE_KEY = 'mise:state:v1';

// ---------- Constants ----------
const CATEGORIES = ['produce','dairy','meat','seafood','pantry','spices','frozen','bakery','beverages','other'];
const CUISINES = ['American','Italian','Mexican','Asian','Mediterranean','Indian','French','Middle Eastern','BBQ','Comfort','Other'];
const COURSES = ['Main','Side','Dessert','Breakfast','Snack','Drink','Sauce','Other'];
const DAYS = [
  {key:'mon',label:'Monday'},{key:'tue',label:'Tuesday'},{key:'wed',label:'Wednesday'},
  {key:'thu',label:'Thursday'},{key:'fri',label:'Friday'},{key:'sat',label:'Saturday'},{key:'sun',label:'Sunday'}
];
const MEALS = ['breakfast','lunch','dinner'];
const DEFAULT_STATE = {
  recipes:{}, mealPlan:{}, cookedSlots:{}, manualGrocery:{}, groceryChecks:{},
  pantry:['salt','black pepper','olive oil','butter','garlic','sugar','flour'],
  settings:{defaultServings:4}
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
function normalizeSlot(slot){if(!slot)return null;if(typeof slot==='string')return{recipeId:slot,multiplier:1};return{multiplier:1,...slot};}
function getOriginSlot(weekPlan,slot){const norm=normalizeSlot(slot);if(!norm)return null;if(norm.leftoverFrom){const{day,meal}=norm.leftoverFrom;return normalizeSlot(weekPlan?.[day]?.[meal]);}return norm;}
function listOriginSlots(weekPlan){const result=[];for(const d of DAYS){const dp=weekPlan?.[d.key]||{};for(const m of MEALS){const n=normalizeSlot(dp[m]);if(n&&n.recipeId&&!n.leftoverFrom)result.push({day:d.key,dayLabel:d.label,meal:m,recipeId:n.recipeId,multiplier:n.multiplier});}}return result;}

// ---------- Gram conversion ----------
const GPW={g:1,gram:1,grams:1,kg:1000,oz:28.35,ounce:28.35,ounces:28.35,lb:453.6,lbs:453.6,pound:453.6,pounds:453.6};
const VTC={cup:1,cups:1,tbsp:1/16,tablespoon:1/16,tablespoons:1/16,tsp:1/48,teaspoon:1/48,teaspoons:1/48,ml:1/237,l:1000/237,'fl oz':1/8};
const GPC={flour:125,'all-purpose flour':125,sugar:200,'brown sugar':220,butter:227,'olive oil':218,oil:218,water:237,milk:240,cream:240,'heavy cream':240,rice:200,salt:273,'kosher salt':220,honey:340,'soy sauce':245,broth:240,stock:240,cheese:113,parmesan:100,onion:160,garlic:136,tomato:180};
const GPI={egg:56,onion:150,garlic:5,tomato:120,potato:213,carrot:60,apple:180,lemon:65,lime:45,avocado:150,'chicken breast':200,'chicken thigh':100,'garlic clove':5};
function lookupBySub(table,name){const n=(name||'').toLowerCase().trim();if(!n)return null;if(table[n]!=null)return table[n];const keys=Object.keys(table).sort((a,b)=>b.length-a.length);for(const k of keys){if(n.includes(k))return table[k];}return null;}
function ingredientToGrams(ing){if(!ing)return null;if(typeof ing.grams==='number'&&ing.grams>0)return ing.grams;const qty=ing.quantity;if(!qty||qty<=0)return null;const unit=(ing.unit||'').toLowerCase().trim();if(GPW[unit]!=null)return qty*GPW[unit];if(VTC[unit]!=null){const cups=qty*VTC[unit];const d=lookupBySub(GPC,ing.name);return d!=null?cups*d:null;}if(!unit){const ig=lookupBySub(GPI,ing.name);return ig!=null?qty*ig:null;}return null;}
function formatGrams(g){if(g==null||isNaN(g))return null;return g<10?`${Math.round(g*10)/10}g`:`${Math.round(g)}g`;}
function extractJSON(text){let clean=text.replace(/```json\s*/gi,'').replace(/```/g,'').trim();const am=clean.match(/\[[\s\S]*\]/),om=clean.match(/\{[\s\S]*\}/);if(am&&(!om||am.index<om.index))clean=am[0];else if(om)clean=om[0];return JSON.parse(clean);}

// ---------- API ----------
async function callAI(prompt,options={}){
  const body={model:'claude-sonnet-4-20250514',max_tokens:2000,messages:[{role:'user',content:prompt}]};
  if(options.tools)body.tools=options.tools;
  if(options.imageData)body.messages=[{role:'user',content:[{type:'image',source:{type:'base64',media_type:options.imageType,data:options.imageData}},{type:'text',text:prompt}]}];
  const r=await fetch(`${SERVER_URL}/ai`,{method:'POST',headers:{'Content-Type':'application/json','X-Secret-Key':SECRET_KEY},body:JSON.stringify(body)});
  if(!r.ok)throw new Error(`AI error ${r.status}`);
  const d=await r.json();
  return d.content.filter(b=>b.type==='text').map(b=>b.text).join('\n');
}
async function syncRead(){const r=await fetch(`${SERVER_URL}/data`,{headers:{'X-Secret-Key':SECRET_KEY}});if(r.status===404)return null;if(!r.ok)throw new Error(`Sync read error ${r.status}`);return r.json();}
async function syncWrite(data){const r=await fetch(`${SERVER_URL}/data`,{method:'PUT',headers:{'Content-Type':'application/json','X-Secret-Key':SECRET_KEY},body:JSON.stringify(data)});if(!r.ok)throw new Error(`Sync write error ${r.status}`);}

// ---------- Export/Import/Share ----------
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

// ---------- SyncBadge ----------
function SyncBadge({status,lastSynced,onSync}){
  const ago=lastSynced?(()=>{const m=Math.floor((Date.now()-lastSynced)/60000);if(m<1)return'just now';if(m===1)return'1m ago';if(m<60)return`${m}m ago`;return`${Math.floor(m/60)}h ago`;})():null;
  if(status==='syncing')return<div className="flex items-center gap-1.5 text-xs text-stone-500"><Loader2 className="w-3.5 h-3.5 animate-spin text-orange-600"/><span className="hidden sm:inline">Syncing…</span></div>;
  if(status==='synced')return<div className="flex items-center gap-1.5 text-xs text-stone-500"><Cloud className="w-3.5 h-3.5 text-emerald-600"/><span className="hidden sm:inline">Synced {ago}</span></div>;
  if(status==='error')return<button onClick={onSync} className="flex items-center gap-1.5 text-xs text-red-600 hover:text-red-700"><CloudOff className="w-3.5 h-3.5"/><span className="hidden sm:inline">Sync failed · retry</span></button>;
  return<button onClick={onSync} className="flex items-center gap-1.5 text-xs text-stone-400 hover:text-stone-600"><RefreshCw className="w-3.5 h-3.5"/><span className="hidden sm:inline">Sync</span></button>;
}

// ---------- Loading Screen ----------
function LoadingScreen({onSkip}){
  const[elapsed,setElapsed]=useState(0);
  useEffect(()=>{const t=setInterval(()=>setElapsed(e=>e+1),1000);return()=>clearInterval(t);},[]);
  const msgs=['Loading your recipes…','Connecting…','Almost there…','Just a moment more…'];
  return(
    <div className="paper-bg min-h-screen flex flex-col items-center justify-center gap-4 px-6">
      <ChefHat className="w-8 h-8 text-orange-700" strokeWidth={1.5}/>
      <h1 className="font-display text-2xl font-medium">Mise</h1>
      <div className="flex items-center gap-2 text-sm text-stone-500">
        <Loader2 className="w-4 h-4 animate-spin text-orange-600"/>
        <span>{msgs[Math.min(Math.floor(elapsed/6),msgs.length-1)]}</span>
      </div>
      {elapsed>=10&&<div className="text-center mt-2">
        <p className="text-xs text-stone-400 mb-2">Taking a while. Open without sync?</p>
        <button onClick={onSkip} className="px-4 py-2 rounded-full bg-stone-900 text-stone-50 text-sm">Open anyway</button>
      </div>}
    </div>
  );
}

// ---------- Modal ----------
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

// ---------- RecipeCard ----------
function RecipeCard({recipe,onClick}){
  const tt=(recipe.prepTime||0)+(recipe.cookTime||0);
  return(
    <button onClick={onClick} className="rcs text-left bg-white border border-stone-200 rounded-2xl p-5 transition-all hover:-translate-y-0.5 w-full">
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
      <div className="flex flex-wrap gap-1.5">{(recipe.tags||[]).slice(0,3).map(t=><span key={t} className="text-xs px-2 py-0.5 bg-stone-100 text-stone-600 rounded-full">{t}</span>)}</div>
    </button>
  );
}

// ---------- RecipeForm ----------
function RecipeForm({initial,onSave,onCancel}){
  const[recipe,setRecipe]=useState(()=>initial||{name:'',servings:4,prepTime:15,cookTime:30,cuisine:'American',course:'Main',tags:[],ingredients:[{name:'',quantity:1,unit:'',category:'produce'}],instructions:[''],source:'',notes:''});
  const u=(f,v)=>setRecipe(r=>({...r,[f]:v}));
  const ui=(i,f,v)=>setRecipe(r=>{const a=[...r.ingredients];a[i]={...a[i],[f]:v};return{...r,ingredients:a};});
  const un=(i,v)=>setRecipe(r=>{const a=[...r.instructions];a[i]=v;return{...r,instructions:a};});
  function handleSave(){if(!recipe.name.trim()){alert('Recipe needs a name.');return;}onSave({...recipe,ingredients:recipe.ingredients.filter(i=>i.name.trim()),instructions:recipe.instructions.filter(s=>s.trim())});}
  const ic='w-full px-3 py-2 bg-white border border-stone-200 rounded-lg text-sm focus:outline-none focus:border-stone-500';
  const lc='text-xs uppercase tracking-wider text-stone-500 font-medium mb-1.5 block';
  return(
    <div className="bg-white border border-stone-200 rounded-2xl p-6 space-y-6">
      <div><label className={lc}>Recipe name</label><input value={recipe.name} onChange={e=>u('name',e.target.value)} placeholder="e.g. Sheet pan harissa chicken" className={`${ic} font-display text-lg`}/></div>
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
      <div className="flex gap-3 justify-end pt-2 border-t border-stone-100">
        {onCancel&&<button onClick={onCancel} className="px-4 py-2 rounded-full text-sm text-stone-600 hover:bg-stone-100">Cancel</button>}
        <button onClick={handleSave} className="px-5 py-2 rounded-full bg-stone-900 text-stone-50 text-sm hover:bg-stone-800 flex items-center gap-2"><Save className="w-4 h-4"/> Save recipe</button>
      </div>
    </div>
  );
}

// ---------- Add inputs ----------
function PasteInput({onParsed}){
  const[text,setText]=useState('');const[loading,setLoading]=useState(false);const[error,setError]=useState(null);
  async function parse(){if(!text.trim())return;setLoading(true);setError(null);try{onParsed(extractJSON(await callAI(`${SCHEMA}\n\nParse this recipe:\n\n${text}`)));}catch(e){setError(e.message);}finally{setLoading(false);}}
  return(<div className="bg-white border border-stone-200 rounded-2xl p-6"><textarea value={text} onChange={e=>setText(e.target.value)} rows={10} placeholder="Paste recipe text here..." className="w-full px-3 py-3 bg-stone-50 border border-stone-200 rounded-lg text-sm focus:outline-none focus:border-stone-500 resize-none mb-3"/>{error&&<p className="text-sm text-red-600 mb-3">{error}</p>}<button onClick={parse} disabled={!text.trim()||loading} className="px-5 py-2 rounded-full bg-stone-900 text-stone-50 text-sm disabled:opacity-50 flex items-center gap-2">{loading?<Loader2 className="w-4 h-4 animate-spin"/>:<Sparkles className="w-4 h-4"/>}{loading?'Parsing…':'Parse recipe'}</button></div>);
}

function URLInput({onParsed}){
  const[url,setUrl]=useState('');const[loading,setLoading]=useState(false);const[error,setError]=useState(null);
  async function parse(){if(!url.trim())return;setLoading(true);setError(null);try{const r=extractJSON(await callAI(`Search for and read this recipe URL: ${url}\n\nReturn ONLY JSON. ${SCHEMA}`,{tools:[{type:'web_search_20250305',name:'web_search'}]}));r.source=url;onParsed(r);}catch(e){setError(e.message);}finally{setLoading(false);}}
  return(<div className="bg-white border border-stone-200 rounded-2xl p-6"><input value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://..." className="w-full px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-lg text-sm focus:outline-none focus:border-stone-500 mb-3"/>{error&&<p className="text-sm text-red-600 mb-3">{error}</p>}<button onClick={parse} disabled={!url.trim()||loading} className="px-5 py-2 rounded-full bg-stone-900 text-stone-50 text-sm disabled:opacity-50 flex items-center gap-2">{loading?<Loader2 className="w-4 h-4 animate-spin"/>:<LinkIcon className="w-4 h-4"/>}{loading?'Fetching…':'Fetch recipe'}</button><p className="text-xs text-stone-400 mt-3">This can take 10–20 seconds.</p></div>);
}

function PhotoInput({onParsed}){
  const[imageData,setImageData]=useState(null);const[imageType,setImageType]=useState(null);const[preview,setPreview]=useState(null);const[loading,setLoading]=useState(false);const[error,setError]=useState(null);const fileRef=useRef(null);
  function handleFile(e){const f=e.target.files?.[0];if(!f)return;const r=new FileReader();r.onload=()=>{const res=r.result;setImageData(res.split(',')[1]);setImageType(f.type);setPreview(res);};r.readAsDataURL(f);}
  async function parse(){if(!imageData)return;setLoading(true);setError(null);try{onParsed(extractJSON(await callAI(`Extract the recipe from this image. ${SCHEMA}`,{imageData,imageType})));}catch(e){setError(e.message);}finally{setLoading(false);}}
  return(<div className="bg-white border border-stone-200 rounded-2xl p-6"><input ref={fileRef} type="file" accept="image/*" onChange={handleFile} className="hidden"/>{!preview&&<button onClick={()=>fileRef.current?.click()} className="w-full py-12 border-2 border-dashed border-stone-300 rounded-xl text-stone-500 flex flex-col items-center gap-2"><Upload className="w-6 h-6" strokeWidth={1.5}/><span className="text-sm">Tap to upload a photo</span></button>}{preview&&<div className="space-y-3"><img src={preview} alt="recipe" className="w-full max-h-80 object-contain rounded-lg border border-stone-200"/><div className="flex gap-2"><button onClick={()=>fileRef.current?.click()} className="px-4 py-2 rounded-full text-sm text-stone-600 hover:bg-stone-100">Change photo</button><button onClick={parse} disabled={loading} className="px-5 py-2 rounded-full bg-stone-900 text-stone-50 text-sm disabled:opacity-50 flex items-center gap-2">{loading?<Loader2 className="w-4 h-4 animate-spin"/>:<Sparkles className="w-4 h-4"/>}{loading?'Reading…':'Extract recipe'}</button></div></div>}{error&&<p className="text-sm text-red-600 mt-3">{error}</p>}</div>);
}

// ---------- Add Recipe View ----------
function AddRecipeView({onSave}){
  const[method,setMethod]=useState('form');const[draft,setDraft]=useState(null);
  if(draft)return(<div><div className="flex items-center justify-between mb-6"><h2 className="font-display text-4xl tracking-tight">Review recipe</h2><button onClick={()=>setDraft(null)} className="text-sm text-stone-600 flex items-center gap-1"><ChevronLeft className="w-4 h-4"/> Start over</button></div><RecipeForm initial={draft} onSave={onSave} onCancel={()=>setDraft(null)}/></div>);
  const methods=[{id:'form',label:'Quick form',icon:Edit2,hint:'Type it in'},{id:'paste',label:'Paste text',icon:FileText,hint:'AI structures it'},{id:'url',label:'From URL',icon:LinkIcon,hint:'Fetch & parse'},{id:'photo',label:'From photo',icon:Camera,hint:'OCR & parse'}];
  return(
    <div>
      <h2 className="font-display text-4xl tracking-tight mb-2">Add a recipe</h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-8">
        {methods.map(m=>{const Icon=m.icon;const active=method===m.id;return(<button key={m.id} onClick={()=>setMethod(m.id)} className={`p-4 rounded-2xl border text-left ${active?'bg-stone-900 text-stone-50 border-stone-900':'bg-white border-stone-200 hover:border-stone-400'}`}><Icon className="w-4 h-4 mb-2" strokeWidth={1.75}/><div className="text-sm font-medium">{m.label}</div><div className={`text-xs mt-0.5 ${active?'text-stone-300':'text-stone-500'}`}>{m.hint}</div></button>);})}
      </div>
      {method==='form'&&<RecipeForm onSave={onSave}/>}
      {method==='paste'&&<PasteInput onParsed={setDraft}/>}
      {method==='url'&&<URLInput onParsed={setDraft}/>}
      {method==='photo'&&<PhotoInput onParsed={setDraft}/>}
    </div>
  );
}

// ---------- Library ----------
function LibraryView({recipes,onSelect,onAdd,onImport}){
  const[search,setSearch]=useState('');const[cuisineFilter,setCuisineFilter]=useState('');const[courseFilter,setCourseFilter]=useState('All');const[sort,setSort]=useState('recent');const[importError,setImportError]=useState(null);const importRef=useRef(null);
  const courseCounts=useMemo(()=>{const c={All:recipes.length};for(const x of COURSES)c[x]=0;for(const r of recipes){const x=r.course||'Main';c[x]=(c[x]||0)+1;}return c;},[recipes]);
  const filtered=useMemo(()=>{let r=[...recipes];if(search.trim()){const q=search.toLowerCase();r=r.filter(x=>x.name.toLowerCase().includes(q)||(x.tags||[]).some(t=>t.toLowerCase().includes(q))||(x.ingredients||[]).some(i=>i.name.toLowerCase().includes(q)));}if(cuisineFilter)r=r.filter(x=>x.cuisine===cuisineFilter);if(courseFilter!=='All')r=r.filter(x=>(x.course||'Main')===courseFilter);if(sort==='recent')r.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));if(sort==='cooked')r.sort((a,b)=>(b.cookCount||0)-(a.cookCount||0));if(sort==='name')r.sort((a,b)=>a.name.localeCompare(b.name));return r;},[recipes,search,cuisineFilter,courseFilter,sort]);
  if(recipes.length===0)return(<div className="text-center py-20"><ChefHat className="w-12 h-12 text-stone-300 mx-auto mb-4" strokeWidth={1.25}/><h2 className="font-display text-3xl mb-2">Your library is empty</h2><p className="text-stone-600 mb-6">Add your first recipe.</p><button onClick={onAdd} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-stone-900 text-stone-50"><Plus className="w-4 h-4"/> Add a recipe</button></div>);
  const vc=['All',...COURSES.filter(c=>courseCounts[c]>0||c===courseFilter)];
  return(
    <div>
      <input ref={importRef} type="file" accept=".json" className="hidden" onChange={e=>{const f=e.target.files?.[0];if(!f)return;importRecipesFromFile(f,imported=>{onImport(imported);setImportError(null);e.target.value='';},err=>setImportError(err));}}/>
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <h2 className="font-display text-4xl tracking-tight">Library</h2>
        <div className="flex items-center gap-2">
          {importError&&<span className="text-xs text-red-600">{importError}</span>}
          <span className="text-sm text-stone-500">{filtered.length} of {recipes.length}</span>
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

// ---------- Week Plan ----------
function WeekPlanView({recipes,mealPlan,currentWeek,setCurrentWeek,cookedSlots,onPickSlot,onClearSlot,onSelectRecipe,onMarkCooked,onSetMultiplier}){
  const week=mealPlan[currentWeek]||{};
  const dkm=['sun','mon','tue','wed','thu','fri','sat'];
  const[selDay,setSelDay]=useState(()=>{const t=new Date();return getWeekStart(t)===currentWeek?dkm[t.getDay()]:'mon';});
  useEffect(()=>{const t=new Date();setSelDay(getWeekStart(t)===currentWeek?dkm[t.getDay()]:'mon');},[currentWeek]);
  function renderDay(d){
    const dp=week[d.key]||{};
    return(<div className="bg-white border border-stone-200 rounded-2xl p-3"><div className="text-xs uppercase tracking-wider text-stone-500 font-medium mb-2 px-1">{d.label}</div><div className="space-y-2">{MEALS.map(m=>{const slot=normalizeSlot(dp[m]),isLO=!!slot?.leftoverFrom,origin=isLO?getOriginSlot(week,slot):slot;const rid=origin?.recipeId,recipe=rid?recipes[rid]:null,orphaned=isLO&&!recipe;const sk=`${d.key}_${m}`,ck=isLO&&slot?.leftoverFrom?`${slot.leftoverFrom.day}_${slot.leftoverFrom.meal}`:sk;const isCooked=!!cookedSlots[ck],mul=origin?.multiplier||1;const olabel=isLO&&slot?.leftoverFrom?`${DAYS.find(x=>x.key===slot.leftoverFrom.day)?.label.slice(0,3)} ${slot.leftoverFrom.meal}`:null;return(<div key={m} className={`border rounded-lg p-2 min-h-[64px] ${isCooked?'border-emerald-200 bg-emerald-50/40':isLO?'border-stone-100 bg-stone-50/40':'border-stone-100'}`}><div className="flex items-center justify-between mb-1 gap-1"><span className="text-[10px] uppercase tracking-wider text-stone-400">{m}</span><div className="flex items-center gap-1">{isLO&&!orphaned&&<span className="text-[9px] uppercase text-stone-500 font-medium px-1.5 py-0.5 bg-stone-100 rounded-full">leftover</span>}{!isLO&&mul>1&&<span className="text-[10px] font-bold text-orange-700 px-1.5 py-0.5 bg-orange-50 rounded-full">×{mul}</span>}{isCooked&&<Check className="w-3 h-3 text-emerald-700" strokeWidth={3}/>}</div></div>{recipe||orphaned?(<div className="flex items-start justify-between gap-1"><button onClick={()=>recipe&&onSelectRecipe(rid)} disabled={orphaned} className={`font-display text-sm text-left leading-tight hover:text-orange-700 flex-1 ${isCooked?'text-stone-500 line-through':''} ${isLO?'italic text-stone-700':''} ${orphaned?'text-stone-400':''}`}>{orphaned?'(origin deleted)':recipe.name}{olabel&&!orphaned&&<span className="block text-[10px] not-italic text-stone-400 mt-0.5">from {olabel}</span>}</button><div className="flex flex-col gap-1.5 flex-shrink-0">{!isLO&&<><button onClick={()=>onSetMultiplier(d.key,m,mul>=4?1:mul+1)} className="text-[10px] text-stone-500 hover:text-orange-700 font-bold">×{mul}</button><button onClick={()=>onMarkCooked(d.key,m,rid,isCooked)} className={isCooked?'text-emerald-700':'text-stone-300 hover:text-emerald-700'}><ChefHat className="w-3.5 h-3.5"/></button></>}<button onClick={()=>onClearSlot(d.key,m)} className="text-stone-300 hover:text-red-500"><X className="w-3 h-3"/></button></div></div>):<button onClick={()=>onPickSlot(d.key,m)} className="w-full text-xs text-stone-400 hover:text-stone-700 py-2 rounded-md border border-dashed border-stone-200 hover:border-stone-400">+ Add</button>}</div>);}}</div></div>);
  }
  const sel=DAYS.find(d=>d.key===selDay)||DAYS[0];
  return(<div><div className="flex items-center justify-between mb-6 flex-wrap gap-3"><div><h2 className="font-display text-4xl tracking-tight">This week</h2><p className="text-stone-600 text-sm mt-1">{formatWeekRange(currentWeek)}</p></div><div className="flex items-center gap-1"><button onClick={()=>setCurrentWeek(shiftWeek(currentWeek,-1))} className="p-2 rounded-full hover:bg-stone-200/60 text-stone-600"><ChevronLeft className="w-4 h-4"/></button><button onClick={()=>setCurrentWeek(getWeekStart())} className="px-3 py-1.5 rounded-full text-sm text-stone-600 hover:bg-stone-200/60">Today</button><button onClick={()=>setCurrentWeek(shiftWeek(currentWeek,1))} className="p-2 rounded-full hover:bg-stone-200/60 text-stone-600"><ChevronRight className="w-4 h-4"/></button></div></div><div className="lg:hidden"><div className="flex gap-1.5 mb-4 overflow-x-auto -mx-4 px-4 pb-1">{DAYS.map(d=>{const dp=week[d.key]||{},filled=MEALS.filter(m=>dp[m]).length,active=selDay===d.key;return(<button key={d.key} onClick={()=>setSelDay(d.key)} className={`flex flex-col items-center gap-0.5 px-3.5 py-2 rounded-xl text-xs whitespace-nowrap flex-shrink-0 ${active?'bg-stone-900 text-stone-50':'bg-white border border-stone-200 text-stone-600'}`}><span className="font-medium">{d.label.slice(0,3)}</span><span className="text-[10px] text-stone-400">{filled>0?filled:'–'}</span></button>);})}</div>{renderDay(sel)}</div><div className="hidden lg:grid lg:grid-cols-7 gap-3">{DAYS.map(d=><div key={d.key}>{renderDay(d)}</div>)}</div></div>);
}

// ---------- Recipe Picker ----------
function RecipePickerModal({recipes,recipeMap,title,currentWeekPlan,targetSlot,onPick,onPickLeftover,onClose}){
  const[search,setSearch]=useState('');const[mode,setMode]=useState('library');
  const filtered=recipes.filter(r=>!search.trim()||r.name.toLowerCase().includes(search.toLowerCase()));
  const origins=useMemo(()=>listOriginSlots(currentWeekPlan||{}).filter(o=>!(o.day===targetSlot?.day&&o.meal===targetSlot?.meal)),[currentWeekPlan,targetSlot]);
  return(<Modal onClose={onClose}><h3 className="font-display text-2xl mb-3">{title}</h3>{origins.length>0&&<div className="flex gap-1 mb-4 p-1 bg-stone-100 rounded-full"><button onClick={()=>setMode('library')} className={`flex-1 px-3 py-1.5 rounded-full text-xs font-medium ${mode==='library'?'bg-white text-stone-900 shadow-sm':'text-stone-600'}`}>From library</button><button onClick={()=>setMode('leftover')} className={`flex-1 px-3 py-1.5 rounded-full text-xs font-medium ${mode==='leftover'?'bg-white text-stone-900 shadow-sm':'text-stone-600'}`}>Leftovers ({origins.length})</button></div>}{mode==='library'&&<><input autoFocus value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search recipes..." className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm focus:outline-none focus:border-stone-500 mb-4"/><div className="max-h-96 overflow-y-auto space-y-1">{filtered.length===0&&<p className="text-sm text-stone-500 py-6 text-center">No recipes match.</p>}{filtered.map(r=><button key={r.id} onClick={()=>onPick(r.id)} className="w-full text-left p-3 rounded-lg hover:bg-stone-100 flex items-center justify-between"><div><div className="font-display text-base">{r.name}</div><div className="text-xs text-stone-500">{r.cuisine} · {((r.prepTime||0)+(r.cookTime||0))}m</div></div>{r.rating==='up'&&<ThumbsUp className="w-3.5 h-3.5 text-emerald-600" fill="currentColor"/>}</button>)}</div></>}{mode==='leftover'&&<div className="max-h-96 overflow-y-auto space-y-1">{origins.map(o=>{const r=recipeMap[o.recipeId];if(!r)return null;return(<button key={`${o.day}_${o.meal}`} onClick={()=>onPickLeftover(o.day,o.meal)} className="w-full text-left p-3 rounded-lg hover:bg-stone-100"><div className="text-[10px] uppercase tracking-wider text-stone-500">{o.dayLabel} · {o.meal}</div><div className="font-display text-base">{r.name}</div></button>);})}</div>}</Modal>);
}

// ---------- Grocery ----------
function GroceryView({recipes,mealPlan,currentWeek,setCurrentWeek,pantry,checks,manualItems,onToggleCheck,onAddManualItem,onRemoveManualItem}){
  const[showAdd,setShowAdd]=useState(false);const[newItem,setNewItem]=useState({name:'',quantity:1,unit:'',category:'other'});
  const grocery=useMemo(()=>{const week=mealPlan[currentWeek]||{},agg={};for(const day of DAYS){const dp=week[day.key]||{};for(const meal of MEALS){const slot=normalizeSlot(dp[meal]);if(!slot||slot.leftoverFrom)continue;const rid=slot.recipeId;if(!rid)continue;const rec=recipes[rid];if(!rec)continue;const mul=slot.multiplier||1;for(const ing of rec.ingredients||[]){const n=normalizeIngredientName(ing.name);if(pantry.some(p=>normalizeIngredientName(p)===n))continue;const key=`${n}|${(ing.unit||'').toLowerCase()}`;const qty=(ing.quantity||0)*mul;if(agg[key])agg[key].quantity+=qty;else agg[key]={key,name:ing.name,quantity:qty,unit:ing.unit||'',category:ing.category||'other',manual:false};}}}for(const item of manualItems){const key=`manual:${item.id}`;agg[key]={key,name:item.name,quantity:item.quantity||0,unit:item.unit||'',category:item.category||'other',manual:true,manualId:item.id};}const bc={};for(const item of Object.values(agg)){if(!bc[item.category])bc[item.category]=[];bc[item.category].push(item);}for(const c of Object.keys(bc))bc[c].sort((a,b)=>a.name.localeCompare(b.name));return bc;},[recipes,mealPlan,currentWeek,pantry,manualItems]);
  const ti=Object.values(grocery).reduce((s,i)=>s+i.length,0),cc=Object.keys(checks).length;
  function handleAdd(){if(!newItem.name.trim())return;onAddManualItem({name:newItem.name.trim(),quantity:newItem.quantity||1,unit:newItem.unit.trim(),category:newItem.category});setNewItem({name:'',quantity:1,unit:'',category:'other'});setShowAdd(false);}
  return(<div><div className="flex items-center justify-between mb-6 flex-wrap gap-3"><div><h2 className="font-display text-4xl tracking-tight">Grocery list</h2><p className="text-stone-600 text-sm mt-1">{formatWeekRange(currentWeek)} · {ti} items · {cc} checked</p></div><div className="flex items-center gap-1"><button onClick={()=>setCurrentWeek(shiftWeek(currentWeek,-1))} className="p-2 rounded-full hover:bg-stone-200/60 text-stone-600"><ChevronLeft className="w-4 h-4"/></button><button onClick={()=>setCurrentWeek(getWeekStart())} className="px-3 py-1.5 rounded-full text-sm text-stone-600 hover:bg-stone-200/60">Today</button><button onClick={()=>setCurrentWeek(shiftWeek(currentWeek,1))} className="p-2 rounded-full hover:bg-stone-200/60 text-stone-600"><ChevronRight className="w-4 h-4"/></button></div></div><div className="mb-4">{!showAdd?<button onClick={()=>setShowAdd(true)} className="text-sm text-orange-700 flex items-center gap-1"><Plus className="w-3.5 h-3.5"/> Add an item</button>:(<div className="bg-white border border-stone-200 rounded-xl p-3 grid grid-cols-2 sm:grid-cols-12 gap-2"><input type="number" step="0.25" min="0" value={newItem.quantity} onChange={e=>setNewItem({...newItem,quantity:parseFloat(e.target.value)||0})} placeholder="qty" className="px-2 py-1.5 bg-stone-50 border border-stone-200 rounded-md text-sm sm:col-span-2"/><input value={newItem.unit} onChange={e=>setNewItem({...newItem,unit:e.target.value})} placeholder="unit" className="px-2 py-1.5 bg-stone-50 border border-stone-200 rounded-md text-sm sm:col-span-2"/><input value={newItem.name} onChange={e=>setNewItem({...newItem,name:e.target.value})} onKeyDown={e=>e.key==='Enter'&&handleAdd()} placeholder="item name" autoFocus className="px-2 py-1.5 bg-stone-50 border border-stone-200 rounded-md text-sm col-span-2 sm:col-span-4"/><select value={newItem.category} onChange={e=>setNewItem({...newItem,category:e.target.value})} className="px-2 py-1.5 bg-stone-50 border border-stone-200 rounded-md text-sm col-span-1 sm:col-span-2">{CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}</select><button onClick={handleAdd} disabled={!newItem.name.trim()} className="px-3 py-1.5 rounded-md bg-stone-900 text-white text-sm disabled:opacity-50 sm:col-span-1">Add</button><button onClick={()=>{setShowAdd(false);setNewItem({name:'',quantity:1,unit:'',category:'other'});}} className="text-stone-400 hover:text-stone-700 sm:col-span-1 flex items-center justify-center"><X className="w-4 h-4"/></button></div>)}</div>{ti===0?(<div className="bg-white border border-stone-200 rounded-2xl p-10 text-center"><ShoppingCart className="w-10 h-10 text-stone-300 mx-auto mb-3" strokeWidth={1.25}/><p className="text-stone-600">Your list is empty.</p></div>):(<div className="grid grid-cols-1 md:grid-cols-2 gap-4">{CATEGORIES.filter(c=>grocery[c]?.length>0).map(cat=>(<div key={cat} className="bg-white border border-stone-200 rounded-2xl p-5"><h3 className="font-display text-lg mb-3 capitalize text-orange-800">{cat}</h3><div className="space-y-1">{grocery[cat].map(item=>{const checked=!!checks[item.key],ig=ingredientToGrams({quantity:item.quantity,unit:item.unit,name:item.name}),gl=ig!=null?formatGrams(ig):null;return(<div key={item.key} className="flex items-center"><button onClick={()=>onToggleCheck(item.key)} className="flex-1 flex items-center gap-3 py-1.5 px-2 rounded-md hover:bg-stone-50 text-left"><div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${checked?'bg-emerald-700 border-emerald-700':'border-stone-300'}`}>{checked&&<Check className="w-3 h-3 text-white" strokeWidth={3}/>}</div><span className={`text-sm flex-1 ${checked?'line-through text-stone-400':'text-stone-800'}`}><span className="font-medium">{formatQuantity(item.quantity)}{item.unit&&` ${item.unit}`}</span>{' '}{item.name}{gl&&<span className="text-stone-400 ml-1.5 text-xs">({gl})</span>}</span></button>{item.manual&&<button onClick={()=>onRemoveManualItem(item.manualId)} className="p-1.5 text-stone-300 hover:text-red-600"><X className="w-3.5 h-3.5"/></button>}</div>);})}</div></div>))}</div>)}</div>);
}

// ---------- Insights ----------
function InsightsView({recipes,onSaveRecipe}){
  const[suggestions,setSuggestions]=useState([]);const[loading,setLoading]=useState(false);const[error,setError]=useState(null);
  const stats=useMemo(()=>{const total=recipes.length,ctm=recipes.filter(r=>r.lastCooked&&(Date.now()-r.lastCooked)/86400000<=30).length;const cc={},ic={};let tct=0,tr=0;for(const r of recipes){cc[r.cuisine||'Other']=(cc[r.cuisine||'Other']||0)+1;for(const ing of r.ingredients||[]){const n=normalizeIngredientName(ing.name);ic[n]=(ic[n]||0)+1;}const t=(r.prepTime||0)+(r.cookTime||0);if(t>0){tct+=t;tr++;}}return{total,cookedThisMonth:ctm,cuisineRanked:Object.entries(cc).sort((a,b)=>b[1]-a[1]),ingredientRanked:Object.entries(ic).sort((a,b)=>b[1]-a[1]).slice(0,10),topRated:recipes.filter(r=>r.rating==='up').slice(0,5),mostCooked:[...recipes].sort((a,b)=>(b.cookCount||0)-(a.cookCount||0)).filter(r=>r.cookCount>0).slice(0,5),avgTime:tr?Math.round(tct/tr):0};},[recipes]);
  async function suggest(){setLoading(true);setError(null);try{setSuggestions(extractJSON(await callAI(`Suggest 5 NEW recipes for: cuisines: ${stats.cuisineRanked.slice(0,3).map(([c,n])=>`${c}(${n})`).join(',')}, ingredients: ${stats.ingredientRanked.slice(0,8).map(([i])=>i).join(',')}, avg time: ${stats.avgTime||30}min, already has: ${recipes.map(r=>r.name).join(',').slice(0,500)}. Return ONLY JSON: [{"name":"string","cuisine":"string","why":"string","totalTime":number,"highlights":["string"]}]`)));}catch(e){setError(e.message);}finally{setLoading(false);}}
  async function expand(s){try{onSaveRecipe(extractJSON(await callAI(`Generate the full recipe for: "${s.name}" (${s.cuisine}). ${SCHEMA}`)));setSuggestions(p=>p.filter(x=>x.name!==s.name));}catch{alert('Could not expand that recipe.');}}
  if(recipes.length<3)return(<div className="text-center py-20"><Sparkles className="w-10 h-10 text-stone-300 mx-auto mb-3" strokeWidth={1.25}/><h2 className="font-display text-3xl mb-2">Insights coming soon</h2><p className="text-stone-600">Add a few more recipes to see patterns.</p></div>);
  const mx=stats.cuisineRanked[0]?.[1]||1;
  return(<div><h2 className="font-display text-4xl tracking-tight mb-6">Insights</h2><div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6"><StatCard label="Recipes" value={stats.total}/><StatCard label="Cooked this month" value={stats.cookedThisMonth}/><StatCard label="Avg total time" value={`${stats.avgTime}m`}/><StatCard label="Top rated" value={stats.topRated.length}/></div><div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6"><div className="bg-white border border-stone-200 rounded-2xl p-5"><h3 className="font-display text-lg mb-3">Cuisine breakdown</h3><div className="space-y-2">{stats.cuisineRanked.slice(0,6).map(([c,n])=>(<div key={c} className="flex items-center gap-3"><span className="text-sm text-stone-600 w-32 truncate">{c}</span><div className="flex-1 bg-stone-100 rounded-full h-1.5 overflow-hidden"><div className="h-full bg-orange-700" style={{width:`${(n/mx)*100}%`}}/></div><span className="text-xs text-stone-500 w-6 text-right">{n}</span></div>))}</div></div><div className="bg-white border border-stone-200 rounded-2xl p-5"><h3 className="font-display text-lg mb-3">Most-used ingredients</h3><div className="flex flex-wrap gap-2">{stats.ingredientRanked.map(([i,n])=><span key={i} className="text-xs px-2.5 py-1 bg-stone-100 text-stone-700 rounded-full">{i} <span className="text-stone-400">·{n}</span></span>)}</div></div></div>{(stats.mostCooked.length>0||stats.topRated.length>0)&&<div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">{stats.mostCooked.length>0&&<div className="bg-white border border-stone-200 rounded-2xl p-5"><h3 className="font-display text-lg mb-3 flex items-center gap-2"><Flame className="w-4 h-4 text-orange-700"/> Most cooked</h3><div className="space-y-1.5">{stats.mostCooked.map(r=><div key={r.id} className="flex items-center justify-between text-sm"><span className="font-display">{r.name}</span><span className="text-stone-500">×{r.cookCount}</span></div>)}</div></div>}{stats.topRated.length>0&&<div className="bg-white border border-stone-200 rounded-2xl p-5"><h3 className="font-display text-lg mb-3 flex items-center gap-2"><ThumbsUp className="w-4 h-4 text-emerald-600"/> Loved</h3><div className="space-y-1.5">{stats.topRated.map(r=><div key={r.id} className="text-sm font-display">{r.name}</div>)}</div></div>}</div>}<div className="bg-white border border-stone-200 rounded-2xl p-5"><div className="flex items-center justify-between mb-3 flex-wrap gap-2"><h3 className="font-display text-xl flex items-center gap-2"><Sparkles className="w-4 h-4 text-orange-700"/> Recommendations</h3><button onClick={suggest} disabled={loading} className="px-4 py-1.5 rounded-full bg-stone-900 text-stone-50 text-sm disabled:opacity-50 flex items-center gap-2">{loading?<Loader2 className="w-3.5 h-3.5 animate-spin"/>:<RefreshCw className="w-3.5 h-3.5"/>}{loading?'Thinking…':suggestions.length?'Refresh':'Suggest recipes'}</button></div>{error&&<p className="text-sm text-red-600 mb-3">{error}</p>}{suggestions.length===0&&!loading&&<p className="text-sm text-stone-500">Based on your library, we'll suggest 5 new recipes you'd likely enjoy.</p>}<div className="space-y-3 mt-3">{suggestions.map((s,i)=><div key={i} className="border border-stone-200 rounded-xl p-4"><div className="flex items-start justify-between gap-3 mb-2"><div className="flex-1"><div className="text-xs uppercase tracking-wider text-orange-700 mb-1">{s.cuisine} · {s.totalTime}m</div><h4 className="font-display text-lg leading-tight">{s.name}</h4></div><button onClick={()=>expand(s)} className="px-3 py-1.5 rounded-full bg-emerald-700 text-white text-xs hover:bg-emerald-800 flex items-center gap-1 flex-shrink-0"><Plus className="w-3 h-3"/> Save</button></div><p className="text-sm text-stone-600 mb-2">{s.why}</p><div className="flex flex-wrap gap-1.5">{(s.highlights||[]).map(h=><span key={h} className="text-xs px-2 py-0.5 bg-stone-100 text-stone-600 rounded-full">{h}</span>)}</div></div>)}</div></div></div>);
}

function StatCard({label,value}){return(<div className="bg-white border border-stone-200 rounded-2xl p-4"><div className="text-xs uppercase tracking-wider text-stone-500 mb-1">{label}</div><div className="font-display text-3xl font-medium">{value}</div></div>);}

// ---------- Pantry ----------
function PantryView({pantry,onToggle}){
  const[input,setInput]=useState('');
  return(<div><h2 className="font-display text-4xl tracking-tight mb-2">Pantry staples</h2><p className="text-stone-600 text-sm mb-6">Items here are excluded from your grocery list.</p><div className="bg-white border border-stone-200 rounded-2xl p-5 mb-4"><div className="flex gap-2"><input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&(onToggle(input),setInput(''))} placeholder="e.g. soy sauce" className="flex-1 px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm focus:outline-none focus:border-stone-500"/><button onClick={()=>{if(input.trim()){onToggle(input);setInput('');}}} className="px-4 py-2 rounded-lg bg-stone-900 text-stone-50 text-sm">Add</button></div></div><div className="bg-white border border-stone-200 rounded-2xl p-5"><h3 className="font-display text-lg mb-3">{pantry.length} staples</h3><div className="flex flex-wrap gap-2">{pantry.map(item=><button key={item} onClick={()=>onToggle(item)} className="text-sm px-3 py-1 bg-stone-100 text-stone-700 rounded-full hover:bg-red-50 hover:text-red-700 flex items-center gap-1.5">{item}<X className="w-3 h-3 opacity-50"/></button>)}</div></div></div>);
}

// ---------- Recipe Detail ----------
function RecipeDetailModal({recipe,onClose,onEdit,onDelete,onCook,onRate}){
  const tt=(recipe.prepTime||0)+(recipe.cookTime||0),lct=recipe.lastCooked?new Date(recipe.lastCooked).toLocaleDateString('en-US',{month:'short',day:'numeric'}):null;
  const bs=recipe.servings||4;const[srv,setSrv]=useState(bs);const scale=bs?srv/bs:1;const[copied,setCopied]=useState(false);
  useEffect(()=>setSrv(recipe.servings||4),[recipe.id,recipe.servings]);
  function handleShare(){
    const lines=[recipe.name.toUpperCase(),'─'.repeat(Math.min(recipe.name.length,40))];
    if(recipe.cuisine)lines.push(recipe.cuisine);const meta=[];if(recipe.servings)meta.push(`Serves ${recipe.servings}`);if(tt)meta.push(`Total ${tt}m`);if(meta.length)lines.push(meta.join(' · '));
    lines.push('','INGREDIENTS');for(const ing of recipe.ingredients||[]){lines.push(`  ${ing.quantity?formatQuantity(ing.quantity):''}${ing.unit?' '+ing.unit:''} ${ing.name}`.trim());}
    lines.push('','INSTRUCTIONS');(recipe.instructions||[]).forEach((s,i)=>lines.push(`  ${i+1}. ${s}`));
    if(recipe.notes)lines.push('',`Notes: ${recipe.notes}`);
    const text=lines.join('\n');
    navigator.clipboard.writeText(text).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),2000);}).catch(()=>{const ta=document.createElement('textarea');ta.value=text;document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);setCopied(true);setTimeout(()=>setCopied(false),2000);});
  }
  return(
    <Modal onClose={onClose} wide>
      <div className="flex items-start justify-between mb-4 gap-3"><div className="flex-1"><div className="text-xs uppercase tracking-wider text-orange-700 mb-1">{recipe.cuisine}{recipe.course&&recipe.course!=='Main'&&<span className="text-stone-400"> · {recipe.course}</span>}</div><h2 className="font-display text-3xl font-medium leading-tight">{recipe.name}</h2>{recipe.notes&&<p className="text-sm text-stone-600 italic mt-2">{recipe.notes}</p>}</div><div className="flex gap-1"><button onClick={onEdit} className="p-2 rounded-full hover:bg-stone-100 text-stone-600"><Edit2 className="w-4 h-4"/></button><button onClick={onDelete} className="p-2 rounded-full hover:bg-red-50 text-stone-600 hover:text-red-600"><Trash2 className="w-4 h-4"/></button></div></div>
      <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-stone-600 border-y border-stone-100 py-3 mb-5 items-center">
        {tt>0&&<span className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5"/> {tt}m total</span>}
        {bs>0&&<div className="flex items-center gap-2"><Users className="w-3.5 h-3.5"/><button onClick={()=>setSrv(Math.max(1,srv-1))} className="w-6 h-6 rounded-full bg-stone-100 hover:bg-stone-200 flex items-center justify-center"><Minus className="w-3 h-3"/></button><span className="font-medium text-stone-800 min-w-[68px] text-center">{srv} {srv===1?'serving':'servings'}</span><button onClick={()=>setSrv(srv+1)} className="w-6 h-6 rounded-full bg-stone-100 hover:bg-stone-200 flex items-center justify-center"><Plus className="w-3 h-3"/></button>{srv!==bs&&<button onClick={()=>setSrv(bs)} className="text-xs text-orange-700">reset</button>}</div>}
        {recipe.cookCount>0&&<span className="flex items-center gap-1.5"><Flame className="w-3.5 h-3.5"/> Cooked {recipe.cookCount}×</span>}
        {lct&&<span className="text-stone-400">Last: {lct}</span>}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-5 gap-6 mb-6">
        <div className="md:col-span-2"><h3 className="font-display text-lg mb-2">Ingredients</h3><ul className="space-y-1">{(recipe.ingredients||[]).map((ing,i)=>{const bg=ingredientToGrams(ing),sg=bg!=null?bg*scale:null,gl=sg!=null?formatGrams(sg):null;return(<li key={i} className="text-sm text-stone-700 flex"><span className="font-medium text-stone-900 w-20 flex-shrink-0">{formatQuantity(ing.quantity*scale)}{ing.unit&&` ${ing.unit}`}</span><span className="flex-1">{ing.name}{gl&&<span className="text-stone-400 ml-1.5 text-xs">({gl})</span>}</span></li>);})}</ul></div>
        <div className="md:col-span-3"><h3 className="font-display text-lg mb-2">Instructions</h3><ol className="space-y-3">{(recipe.instructions||[]).map((step,i)=><li key={i} className="text-sm text-stone-700 flex gap-3"><span className="font-display text-lg text-orange-700 w-6 flex-shrink-0">{i+1}.</span><span className="leading-relaxed">{step}</span></li>)}</ol></div>
      </div>
      {(recipe.tags||[]).length>0&&<div className="flex flex-wrap gap-1.5 mb-5">{recipe.tags.map(t=><span key={t} className="text-xs px-2 py-0.5 bg-stone-100 text-stone-600 rounded-full">{t}</span>)}</div>}
      {recipe.source&&<p className="text-xs text-stone-500 mb-5">Source: {recipe.source}</p>}
      <div className="border-t border-stone-100 pt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2"><span className="text-xs uppercase tracking-wider text-stone-500 mr-1">Rating</span><button onClick={()=>onRate(recipe.rating==='up'?null:'up')} className={`p-1.5 rounded-full ${recipe.rating==='up'?'bg-emerald-50 text-emerald-700':'hover:bg-stone-100 text-stone-400'}`}><ThumbsUp className="w-4 h-4" fill={recipe.rating==='up'?'currentColor':'none'}/></button><button onClick={()=>onRate(recipe.rating==='down'?null:'down')} className={`p-1.5 rounded-full ${recipe.rating==='down'?'bg-red-50 text-red-600':'hover:bg-stone-100 text-stone-400'}`}><ThumbsDown className="w-4 h-4" fill={recipe.rating==='down'?'currentColor':'none'}/></button></div>
        <div className="flex items-center gap-2">
          <button onClick={handleShare} className={`px-3 py-2 rounded-full border text-sm flex items-center gap-1.5 ${copied?'border-emerald-300 bg-emerald-50 text-emerald-700':'border-stone-200 bg-white text-stone-600 hover:border-stone-400'}`}>{copied?<><Check className="w-3.5 h-3.5" strokeWidth={3}/> Copied!</>:<><Copy className="w-3.5 h-3.5"/> Share recipe</>}</button>
          <button onClick={()=>onCook()} className="px-4 py-2 rounded-full bg-orange-700 text-white text-sm hover:bg-orange-800 flex items-center gap-2"><ChefHat className="w-4 h-4"/> I made this</button>
        </div>
      </div>
    </Modal>
  );
}

function EditRecipeModal({recipe,onSave,onCancel}){return(<Modal onClose={onCancel} wide><h2 className="font-display text-2xl mb-4">Edit recipe</h2><RecipeForm initial={recipe} onSave={onSave} onCancel={onCancel}/></Modal>);}

// ---------- Main App ----------
export default function App(){
  const[state,setState,loaded,setLoaded,syncStatus,syncError,lastSynced,manualSync]=useAppState();
  const[view,setView]=useState('library');
  const[selectedRecipeId,setSelectedRecipeId]=useState(null);
  const[editingRecipe,setEditingRecipe]=useState(null);
  const[planTarget,setPlanTarget]=useState(null);
  const[currentWeek,setCurrentWeek]=useState(getWeekStart());
  const recipes=state.recipes;
  const recipeList=useMemo(()=>Object.values(recipes),[recipes]);

  function saveRecipe(recipe){const id=recipe.id||generateId(),now=Date.now(),existing=recipes[id];setState(s=>({...s,recipes:{...s.recipes,[id]:{cookCount:0,lastCooked:null,rating:null,createdAt:now,...existing,...recipe,id}}}));return id;}
  function deleteRecipe(id){setState(s=>{const{[id]:_,...rest}=s.recipes;return{...s,recipes:rest};});}
  function logCook(id){setState(s=>({...s,recipes:{...s.recipes,[id]:{...s.recipes[id],cookCount:(s.recipes[id].cookCount||0)+1,lastCooked:Date.now()}}}));}
  function setRating(id,rating){setState(s=>({...s,recipes:{...s.recipes,[id]:{...s.recipes[id],rating}}}));}
  function planMeal(week,day,meal,slotValue){setState(s=>{const wp=s.mealPlan[week]||{},slotKey=`${day}_${meal}`;const wc=s.cookedSlots[week]||{},newCooked={...wc};delete newCooked[slotKey];const newWeek={...wp};if(slotValue===null){const dp=newWeek[day]||{},nd={...dp};delete nd[meal];newWeek[day]=nd;for(const d of Object.keys(newWeek)){const dm=newWeek[d];if(!dm)continue;for(const m of Object.keys(dm)){const n=normalizeSlot(dm[m]);if(n?.leftoverFrom?.day===day&&n.leftoverFrom.meal===meal){const u={...newWeek[d]};delete u[m];newWeek[d]=u;delete newCooked[`${d}_${m}`];}}}}else{const ns=typeof slotValue==='string'?{recipeId:slotValue,multiplier:1}:{multiplier:1,...slotValue};newWeek[day]={...(newWeek[day]||{}),[meal]:ns};}return{...s,mealPlan:{...s.mealPlan,[week]:newWeek},cookedSlots:{...s.cookedSlots,[week]:newCooked}};});}
  function setSlotMultiplier(week,day,meal,multiplier){setState(s=>{const wp=s.mealPlan[week]||{},dp=wp[day]||{},slot=normalizeSlot(dp[meal]);if(!slot||slot.leftoverFrom)return s;return{...s,mealPlan:{...s.mealPlan,[week]:{...wp,[day]:{...dp,[meal]:{...slot,multiplier:Math.max(1,Math.min(6,multiplier))}}}}}});}
  function markSlotCooked(week,day,meal,recipeId,currentlyCooked){const slotKey=`${day}_${meal}`;setState(s=>{const wc=s.cookedSlots[week]||{},newCooked={...wc};if(currentlyCooked){delete newCooked[slotKey];return{...s,cookedSlots:{...s.cookedSlots,[week]:newCooked}};}newCooked[slotKey]={date:Date.now()};const r=s.recipes[recipeId];const ur=r?{...s.recipes,[recipeId]:{...r,cookCount:(r.cookCount||0)+1,lastCooked:Date.now()}}:s.recipes;return{...s,cookedSlots:{...s.cookedSlots,[week]:newCooked},recipes:ur};});}
  function addManualGroceryItem(week,item){setState(s=>{const l=s.manualGrocery[week]||[];return{...s,manualGrocery:{...s.manualGrocery,[week]:[...l,{...item,id:generateId()}]}};});}
  function removeManualGroceryItem(week,id){setState(s=>{const l=s.manualGrocery[week]||[];return{...s,manualGrocery:{...s.manualGrocery,[week]:l.filter(x=>x.id!==id)}};});}
  function togglePantry(item){const n=item.toLowerCase().trim();if(!n)return;setState(s=>({...s,pantry:s.pantry.includes(n)?s.pantry.filter(p=>p!==n):[...s.pantry,n]}));}
  function toggleGroceryCheck(week,key){setState(s=>{const wc=s.groceryChecks[week]||{},nc={...wc};if(nc[key])delete nc[key];else nc[key]=true;return{...s,groceryChecks:{...s.groceryChecks,[week]:nc}};});}

  if(!loaded)return<LoadingScreen onSkip={()=>setLoaded(true)}/>;

  const selectedRecipe=selectedRecipeId?recipes[selectedRecipeId]:null;
  const tabs=[{id:'library',label:'Library',icon:BookOpen},{id:'add',label:'Add Recipe',icon:Plus},{id:'week',label:'This Week',icon:Calendar},{id:'grocery',label:'Grocery',icon:ShoppingCart},{id:'insights',label:'Insights',icon:Sparkles},{id:'pantry',label:'Pantry',icon:Package}];
  const mobTabs=[{id:'library',label:'Library',icon:BookOpen},{id:'add',label:'Add',icon:Plus},{id:'week',label:'Week',icon:Calendar},{id:'grocery',label:'Grocery',icon:ShoppingCart},{id:'insights',label:'Insights',icon:Sparkles},{id:'pantry',label:'Pantry',icon:Package}];

  return(
    <div className="paper-bg min-h-screen text-stone-900">
      <header className="border-b border-stone-200 bg-stone-50/80 backdrop-blur sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5"><ChefHat className="w-6 h-6 text-orange-700" strokeWidth={1.75}/><h1 className="font-display text-2xl font-medium tracking-tight">Mise</h1></div>
          <div className="flex items-center gap-3"><SyncBadge status={syncStatus} lastSynced={lastSynced} onSync={manualSync}/><span className="text-xs text-stone-400 hidden sm:inline">{recipeList.length} {recipeList.length===1?'recipe':'recipes'}</span></div>
        </div>
        <nav className="hidden sm:flex max-w-6xl mx-auto px-5 pb-3 gap-1 overflow-x-auto">
          {tabs.map(tab=>{const Icon=tab.icon;const active=view===tab.id;return(<button key={tab.id} onClick={()=>setView(tab.id)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm whitespace-nowrap ${active?'bg-stone-900 text-stone-50':'text-stone-600 hover:bg-stone-200/60'}`}><Icon className="w-3.5 h-3.5" strokeWidth={2}/>{tab.label}</button>);})}
        </nav>
      </header>

      {syncStatus==='error'&&<div className="bg-amber-50 border-b border-amber-200 px-5 py-2 text-xs text-amber-800 flex items-center justify-between"><span>⚠️ Sync failed{syncError?`: ${syncError}`:''}.</span><button onClick={manualSync} className="font-medium underline ml-2">Retry</button></div>}

      <main className="max-w-6xl mx-auto px-4 sm:px-5 py-6 sm:py-8 pb-24 sm:pb-8">
        {view==='library'&&<LibraryView recipes={recipeList} onSelect={id=>setSelectedRecipeId(id)} onAdd={()=>setView('add')} onImport={imported=>{setState(s=>({...s,recipes:{...s.recipes,...Object.fromEntries(Object.entries(imported).map(([id,r])=>[id,{...r,id}]))}}));}}/>}
        {view==='add'&&<AddRecipeView onSave={recipe=>{saveRecipe(recipe);setView('library');}}/>}
        {view==='week'&&<WeekPlanView recipes={recipes} mealPlan={state.mealPlan} currentWeek={currentWeek} setCurrentWeek={setCurrentWeek} cookedSlots={state.cookedSlots[currentWeek]||{}} onPickSlot={(d,m)=>setPlanTarget({week:currentWeek,day:d,meal:m})} onClearSlot={(d,m)=>planMeal(currentWeek,d,m,null)} onSelectRecipe={id=>setSelectedRecipeId(id)} onMarkCooked={(d,m,rid,c)=>markSlotCooked(currentWeek,d,m,rid,c)} onSetMultiplier={(d,m,mul)=>setSlotMultiplier(currentWeek,d,m,mul)}/>}
        {view==='grocery'&&<GroceryView recipes={recipes} mealPlan={state.mealPlan} currentWeek={currentWeek} setCurrentWeek={setCurrentWeek} pantry={state.pantry} checks={state.groceryChecks[currentWeek]||{}} manualItems={state.manualGrocery[currentWeek]||[]} onToggleCheck={k=>toggleGroceryCheck(currentWeek,k)} onAddManualItem={item=>addManualGroceryItem(currentWeek,item)} onRemoveManualItem={id=>removeManualGroceryItem(currentWeek,id)}/>}
        {view==='insights'&&<InsightsView recipes={recipeList} onSaveRecipe={r=>saveRecipe(r)}/>}
        {view==='pantry'&&<PantryView pantry={state.pantry} onToggle={togglePantry}/>}
      </main>

      <nav className="sm:hidden fixed bottom-0 left-0 right-0 bg-stone-50/95 backdrop-blur border-t border-stone-200 z-30" style={{paddingBottom:'env(safe-area-inset-bottom,0)'}}>
        <div className="grid grid-cols-6">
          {mobTabs.map(tab=>{const Icon=tab.icon;const active=view===tab.id;return(<button key={tab.id} onClick={()=>setView(tab.id)} className={`flex flex-col items-center justify-center gap-0.5 py-2 px-1 ${active?'text-orange-700':'text-stone-500 hover:text-stone-700'}`}><Icon className="w-5 h-5" strokeWidth={active?2:1.75}/><span className="text-[10px] font-medium">{tab.label}</span></button>);})}
        </div>
      </nav>

      {selectedRecipe&&!editingRecipe&&<RecipeDetailModal recipe={selectedRecipe} onClose={()=>setSelectedRecipeId(null)} onEdit={()=>setEditingRecipe(selectedRecipe)} onDelete={()=>{if(confirm(`Delete "${selectedRecipe.name}"?`)){deleteRecipe(selectedRecipe.id);setSelectedRecipeId(null);}}} onCook={()=>logCook(selectedRecipe.id)} onRate={rating=>setRating(selectedRecipe.id,rating)}/>}
      {editingRecipe&&<EditRecipeModal recipe={editingRecipe} onSave={r=>{saveRecipe(r);setEditingRecipe(null);}} onCancel={()=>setEditingRecipe(null)}/>}
      {planTarget&&<RecipePickerModal recipes={recipeList} recipeMap={recipes} title={`${planTarget.day} ${planTarget.meal}`} currentWeekPlan={state.mealPlan[planTarget.week]||{}} targetSlot={{day:planTarget.day,meal:planTarget.meal}} onPick={id=>{planMeal(planTarget.week,planTarget.day,planTarget.meal,id);setPlanTarget(null);}} onPickLeftover={(od,om)=>{planMeal(planTarget.week,planTarget.day,planTarget.meal,{leftoverFrom:{day:od,meal:om}});setPlanTarget(null);}} onClose={()=>setPlanTarget(null)}/>}
    </div>
  );
}
