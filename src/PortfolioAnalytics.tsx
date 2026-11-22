import { lazy, Suspense, useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import { formatIndianCompactAmount, parseIndianAmount } from "./lib/indian-amount.mjs";
import { ArrowUpRight, BarChart3, TrendingUp, CircleDollarSign, PieChart, Sparkles } from "lucide-react";
const PortfolioEChart=lazy(()=>import("./components/PortfolioEChart"));

type PropertyRow = { id: string; title: string; module: string; value: string; status: string };
type FinancialRow = { id: string; type: string; amount: string; date: string };
type TaskRow = { id: string; date: string; done: boolean; type: string };
type ModuleRow = { name: string; value: number; count: number };

type Props = {
  properties: PropertyRow[];
  financials: FinancialRow[];
  tasks: TaskRow[];
  modules: ModuleRow[];
  onOpenModule: (name: string) => void;
};

const PALETTE = ["#69b9ae","#7694bd","#b99a68","#8ba6a0","#9e8fad","#d17c79","#709aaf","#8f9c84"];
const INFLOW = new Set(["Sale", "Advance", "Loan Disbursal", "Receipt"]);
const OUTFLOW = new Set(["Purchase", "Loan Repayment", "Interest", "Instalment", "Brokerage", "Expense", "Settlement"]);
const compact = (value: number) => formatIndianCompactAmount(value) || "—";

type CItem={name:string;value:number;color:string;count?:number};type MFlow={key:string;name:string;fullName:string;inflow:number;outflow:number;net:number;count:number};
function buildPortfolioChartOption(focus:"allocation"|"pipeline"|"cashflow",type:"donut"|"bar"|"line",metric:"value"|"count",items:CItem[],months:MFlow[],selected:string,labels:boolean):EChartsOption{
 const axis={color:"#9aafbd",fontSize:11},grid="#294254",money=(v:number)=>formatIndianCompactAmount(v)||"0";
 const formatTooltipValue=(value:unknown)=>{
  const scalar=Array.isArray(value)?value[0]:value;
  const numeric=Number(scalar);
  if(!Number.isFinite(numeric))return String(scalar??"");
  return focus==="cashflow"||metric==="value"?money(numeric):numeric.toLocaleString("en-IN");
 };
 const common={backgroundColor:"transparent",animationDuration:240,textStyle:{color:"#c3d1da",fontFamily:"Inter,system-ui,sans-serif"},tooltip:{trigger:"item" as const,confine:true,valueFormatter:formatTooltipValue},aria:{enabled:true,decal:{show:true}}};
 if(focus==="cashflow"&&type==="donut"){const a=months.reduce((s,r)=>s+r.inflow,0),b=months.reduce((s,r)=>s+r.outflow,0);return {...common,color:["#69b9ae","#d17c79"],legend:{bottom:0,textStyle:axis},series:[{type:"pie",radius:["48%","74%"],center:["50%","44%"],label:{show:labels,color:"#c3d1da",formatter:"{b}: {d}%"},data:[{name:"Inflow",value:a},{name:"Outflow",value:b}]}]};}
 if(focus==="cashflow"){const st:"bar"|"line"=type==="bar"?"bar":"line";return {...common,color:["#69b9ae","#d17c79"],legend:{bottom:0,textStyle:axis},grid:{left:84,right:24,top:24,bottom:58},xAxis:{type:"category",data:months.map(x=>x.name),axisLabel:axis,axisLine:{lineStyle:{color:grid}},axisTick:{show:false}},yAxis:{type:"value",axisLabel:{...axis,formatter:(v:string|number)=>money(Number(v))},splitLine:{lineStyle:{color:grid,type:"dashed"}}},series:[{name:"Inflow",type:st,smooth:true,barMaxWidth:22,data:months.map(x=>x.inflow),itemStyle:{color:"#69b9ae"},lineStyle:{width:3},areaStyle:type==="line"?{opacity:.08}:undefined,label:{show:labels,position:"top"}},{name:"Outflow",type:st,smooth:true,barMaxWidth:22,data:months.map(x=>x.outflow),itemStyle:{color:"#d17c79"},lineStyle:{width:3},areaStyle:type==="line"?{opacity:.06}:undefined,label:{show:labels,position:"top"}}]};}
 if(type==="donut")return {...common,color:items.map(x=>x.color),legend:{bottom:0,type:"scroll",textStyle:axis},series:[{type:"pie",radius:["48%","74%"],center:["50%","44%"],label:{show:labels,color:"#c3d1da",formatter:"{b}: {d}%"},data:items.map(x=>({name:x.name,value:x.value,itemStyle:{opacity:(selected&&selected!==x.name)?0.32:1}}))}]};
 if(type==="bar")return {...common,grid:{left:150,right:48,top:18,bottom:28,containLabel:true},xAxis:{type:"value",axisLabel:{...axis,formatter:(v:string|number)=>metric==="value"?money(Number(v)):Number(v).toLocaleString("en-IN")},splitLine:{lineStyle:{color:grid,type:"dashed"}}},yAxis:{type:"category",inverse:true,data:items.map(x=>x.name),axisLabel:axis,axisLine:{show:false},axisTick:{show:false}},series:[{type:"bar",barMaxWidth:24,data:items.map(x=>({name:x.name,value:x.value,itemStyle:{color:x.color,opacity:(selected&&selected!==x.name)?0.38:1,borderRadius:[0,5,5,0]}})),label:{show:labels,position:"right",color:"#c3d1da"}}]};
 return {...common,grid:{left:72,right:24,top:26,bottom:58},xAxis:{type:"category",data:items.map(x=>x.name),axisLabel:{...axis,interval:0,rotate:items.length>5?18:0},axisLine:{lineStyle:{color:grid}},axisTick:{show:false}},yAxis:{type:"value",axisLabel:{...axis,formatter:(v:string|number)=>metric==="value"?money(Number(v)):Number(v).toLocaleString("en-IN")},splitLine:{lineStyle:{color:grid,type:"dashed"}}},series:[{type:"line",smooth:.28,symbol:"circle",symbolSize:8,data:items.map(x=>({name:x.name,value:x.value})),lineStyle:{color:"#69b9ae",width:3},itemStyle:{color:"#69b9ae",borderColor:"#0b1420",borderWidth:2},areaStyle:{color:"rgba(105,185,174,.08)"},label:{show:labels,position:"top",color:"#c3d1da"}}]};
}


export default function PortfolioAnalytics({ properties, financials, tasks, modules, onOpenModule }: Props) {
  const [focus, setFocus] = useState<"allocation" | "pipeline" | "cashflow">("allocation");
  const [chartType, setChartType] = useState<"donut" | "bar" | "line">("donut");
  const [metric, setMetric] = useState<"value" | "count">("value");
  const [period, setPeriod] = useState<3 | 6 | 12>(6);
  const [selected, setSelected] = useState("");
  const [showLabels, setShowLabels] = useState(true);

  const moduleRows = useMemo(() => modules.map((module, index) => {
    const items = properties.filter(property => property.module === module.name);
    return {
      ...module,
      count: items.length,
      value: items.reduce((sum, property) => sum + (parseIndianAmount(property.value) || 0), 0),
      color: PALETTE[index % PALETTE.length]
    };
  }).filter(row => row.count > 0 || row.value > 0), [modules, properties]);

  const stageRows = useMemo(() => {
    const map = new Map<string, { name: string; count: number }>();
    properties.forEach(property => {
      const name = String(property.status || "Unspecified").trim() || "Unspecified";
      const key = name.toLocaleLowerCase();
      const current = map.get(key);
      if (current) current.count += 1;
      else map.set(key, { name, count: 1 });
    });
    return Array.from(map.values())
      .map(({ name, count }, index) => ({ name, value: count, count, color: PALETTE[index % PALETTE.length] }))
      .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  }, [properties]);

  const cashflowRows = useMemo(() => {
    const now = new Date();
    return Array.from({ length: period }, (_, index) => {
      const month = new Date(now.getFullYear(), now.getMonth() - (period - 1 - index), 1);
      const key = month.getFullYear() + "-" + String(month.getMonth() + 1).padStart(2, "0");
      const rows = financials.filter(row => String(row.date || "").slice(0, 7) === key);
      const inflow = rows.filter(row => INFLOW.has(row.type)).reduce((sum, row) => sum + (parseIndianAmount(row.amount) || 0), 0);
      const outflow = rows.filter(row => OUTFLOW.has(row.type)).reduce((sum, row) => sum + (parseIndianAmount(row.amount) || 0), 0);
      return { key, name: month.toLocaleDateString("en-IN", { month: "short" }), fullName: month.toLocaleDateString("en-IN", { month: "long", year: "numeric" }), inflow, outflow, net: inflow - outflow, count: rows.length };
    });
  }, [financials, period]);

  const trackedValue = properties.reduce((sum, item) => sum + (parseIndianAmount(item.value) || 0), 0);
  const openRecords = properties.filter(row => !["completed", "closed"].includes(String(row.status || "").trim().toLocaleLowerCase())).length;
  const closedRecords = properties.length - openRecords;
  const recordsWithoutValue = properties.filter(row => parseIndianAmount(row.value) === null).length;
  const totalInflow = financials.filter(item => INFLOW.has(item.type)).reduce((sum, item) => sum + (parseIndianAmount(item.amount) || 0), 0);
  const totalOutflow = financials.filter(item => OUTFLOW.has(item.type)).reduce((sum, item) => sum + (parseIndianAmount(item.amount) || 0), 0);
  const openTasks = tasks.filter(task => !task.done).length;
  const overdueTasks = tasks.filter(task => !task.done && task.date < new Date().toISOString().slice(0, 10)).length;
  const chartItems = focus === "allocation" ? moduleRows.map(row => ({ name: row.name, value: metric === "value" ? row.value : row.count, count: row.count, color: row.color })) : stageRows;
  const visibleItems = chartItems.filter(item => item.value > 0);
  const title = focus === "allocation" ? metric === "value" ? "Recorded value / exposure by workspace" : "Records by workspace" : focus === "pipeline" ? "Portfolio status mix" : "Cashflow movement";
  const subtitle = focus === "allocation" ? "Select any segment to open that module." : focus === "pipeline" ? "Real status values from your saved records." : "Recorded inflows and outflows by month; no forecast is fabricated.";
  const activeModuleName = selected && moduleRows.some(row => row.name === selected) ? selected : "";
  const chartOption=useMemo(()=>buildPortfolioChartOption(focus,chartType,focus==="pipeline"?"count":metric,visibleItems,cashflowRows,selected,showLabels),[focus,chartType,metric,visibleItems,cashflowRows,selected,showLabels]);

  const setFocusView = (next: "allocation" | "pipeline" | "cashflow") => {
    setFocus(next);
    setSelected("");
    if (next === "cashflow") setChartType("bar");
  };

  const empty = focus === "allocation"
    ? properties.length === 0 || (metric === "value" && !moduleRows.some(row => row.value > 0))
    : focus === "pipeline"
      ? properties.length === 0
      : cashflowRows.every(row => row.count === 0);
  const emptyMessage = focus === "cashflow"
    ? financials.length
      ? `No transactions in the selected ${period}-month window. Choose a wider period to review more history.`
      : "Add financial transactions to compare monthly inflows and outflows."
    : focus === "pipeline" || properties.length === 0
      ? "Add your first property or deal record to activate interactive charts."
      : "No record values have been entered yet. Switch to Count to inspect saved records, or enter the relevant value or exposure in its workspace.";

  return <section className="ax-analytics-panel">
    <div className="ax-panel-topline"><span className="ax-kicker"><Sparkles size={13}/> AXIVESTRA INTELLIGENCE</span><span className="ax-live-status"><i/> LIVE FROM YOUR RECORDS</span></div>
    <div className="ax-analytics-heading">
      <div><h2>Portfolio intelligence</h2><p>Interactive views of your properties, capital flows and operational pipeline.</p></div>
      <div className="ax-chart-type" role="group" aria-label="Chart type">
        <button type="button" className={chartType === "donut" ? "active" : ""} aria-pressed={chartType === "donut"} onClick={() => setChartType("donut")} title="Ring chart" aria-label="Ring chart"><PieChart size={16}/></button>
        <button type="button" className={chartType === "bar" ? "active" : ""} aria-pressed={chartType === "bar"} onClick={() => setChartType("bar")} title="Bar chart" aria-label="Bar chart"><BarChart3 size={16}/></button>
        <button type="button" className={chartType === "line" ? "active" : ""} aria-pressed={chartType === "line"} onClick={() => setChartType("line")} title="Line chart" aria-label="Line chart"><TrendingUp size={16}/></button>
      </div>
    </div>
    <div className="ax-analytics-tabs" role="tablist" aria-label="Analytics view">
      <button type="button" className={focus === "allocation" ? "active" : ""} onClick={() => setFocusView("allocation")} role="tab" aria-selected={focus === "allocation"}>Recorded amounts</button>
      <button type="button" className={focus === "pipeline" ? "active" : ""} onClick={() => setFocusView("pipeline")} role="tab" aria-selected={focus === "pipeline"}>Pipeline health</button>
      <button type="button" className={focus === "cashflow" ? "active" : ""} onClick={() => setFocusView("cashflow")} role="tab" aria-selected={focus === "cashflow"}>Cashflow</button>
      {focus === "cashflow" && <select value={period} onChange={event => setPeriod(Number(event.target.value) as 3 | 6 | 12)} aria-label="Cashflow period"><option value={3}>3 months</option><option value={6}>6 months</option><option value={12}>12 months</option></select>}
      {focus === "allocation" && <div className="ax-metric-switch"><button className={metric === "value" ? "active" : ""} onClick={() => { setMetric("value"); setSelected(""); }}>Value</button><button className={metric === "count" ? "active" : ""} onClick={() => { setMetric("count"); setSelected(""); }}>Count</button></div>}
    </div>
    <div className="ax-analytics-grid">
      <div className="ax-chart-stage">
        <div className="ax-chart-mode-title"><strong>{title}</strong><p>{subtitle}</p></div>
        {empty ? <div className="ax-chart-empty"><PortfolioEmptyChartPreview type={chartType}/><strong>{focus === "cashflow" && financials.length ? "No activity in this period" : "Waiting for your data"}</strong><p>{emptyMessage}</p><small>Empty states are intentional—no sample data is counted as real.</small></div>
        : <Suspense fallback={<div className="ax-echart-loading" role="status">Loading interactive analytics…</div>}><PortfolioEChart option={chartOption} ariaLabel={title+". "+subtitle} onSelect={setSelected}/></Suspense>}
      </div>
      <aside className="ax-chart-inspector">
        <div className="ax-inspector-head"><span>LIVE SUMMARY</span><CircleDollarSign size={18}/></div>
        {focus === "cashflow" ? <>
          <strong className="ax-inspector-total">{compact(totalInflow - totalOutflow)}</strong><small>Net recorded cashflow · all time</small>
          <div className="ax-inspector-pair"><span><i className="inflow-dot"/> Total inflows</span><strong>{compact(totalInflow)}</strong></div>
          <div className="ax-inspector-pair"><span><i className="outflow-dot"/> Total outflows</span><strong>{compact(totalOutflow)}</strong></div>
          <div className="ax-inspector-pair"><span>Transactions</span><strong>{financials.length}</strong></div>
        </> : focus === "pipeline" ? <>
          <strong className="ax-inspector-total">{properties.length}</strong><small>Saved property / deal records</small>
          <div className="ax-inspector-pair"><span>Open records</span><strong>{openRecords}</strong></div>
          <div className="ax-inspector-pair"><span>Closed records</span><strong>{closedRecords}</strong></div>
          <div className="ax-inspector-pair"><span>Tasks open</span><strong>{openTasks}</strong></div><div className="ax-inspector-pair"><span>Overdue tasks</span><strong>{overdueTasks}</strong></div>
        </> : <>
          <strong className="ax-inspector-total">{compact(trackedValue)}</strong><small>Total recorded value / exposure</small>
          <div className="ax-inspector-pair"><span>Active modules</span><strong>{moduleRows.filter(row => row.count > 0).length}</strong></div>
          <div className="ax-inspector-pair"><span>Records without a value</span><strong>{recordsWithoutValue}</strong></div>
          <div className="ax-inspector-pair"><span>Modules available</span><strong>{modules.length}</strong></div>
        </>}
        <div className="ax-inspector-divider"/>
        <label className="ax-toggle-row"><input type="checkbox" checked={showLabels} onChange={event => setShowLabels(event.target.checked)}/> Show chart labels</label>
        <button className="ax-inspector-action" onClick={() => {
          if (focus === "cashflow") return;
          if (focus === "pipeline") { onOpenModule("All Properties"); return; }
          const name = selected || activeModuleName || visibleItems[0]?.name;
          if (name) onOpenModule(name);
        }} disabled={focus === "cashflow" || (focus === "allocation" && !visibleItems.length)}>Explore selected data <ArrowUpRight size={15}/></button>
      </aside>
    </div>
    {focus !== "cashflow" && <div className="ax-chart-legend">
      {visibleItems.slice(0, 8).map((item, index) => <button type="button" key={item.name} className={selected === item.name ? "selected" : ""} aria-pressed={selected === item.name} onClick={() => { setSelected(selected === item.name ? "" : item.name); if (focus === "allocation" && modules.some(module => module.name === item.name)) onOpenModule(item.name); }}>
        <i style={{ background: item.color || PALETTE[index % PALETTE.length] }}/><span>{item.name}</span><strong>{focus === "allocation" && metric === "value" ? compact(item.value) : item.value}</strong>
      </button>)}
      {visibleItems.length === 0 && <span className="ax-muted">No module allocation until you add records.</span>}
    </div>}
  </section>;
}

function PortfolioEmptyChartPreview({ type }: { type: "donut" | "bar" | "line" }) {
  if (type === "donut") return <svg className="ax-empty-chart-ring" viewBox="0 0 180 180" role="img" aria-label="Empty portfolio chart"><circle cx="90" cy="90" r="62" fill="none" stroke="#1a354a" strokeWidth="21" strokeDasharray="6 7"/><circle cx="90" cy="90" r="45" fill="#0b1d2d"/><text x="90" y="86" textAnchor="middle" fill="#69879c" fontSize="9" letterSpacing="1">NO DATA</text><text x="90" y="105" textAnchor="middle" fill="#89a7bb" fontSize="14" fontWeight="800">0</text></svg>;
  if (type === "bar") return <div className="ax-empty-chart-bars" aria-label="Empty bar chart preview">{[0,1,2,3].map(item=><span key={item}><i/><b/></span>)}</div>;
  return <svg className="ax-empty-chart-line" viewBox="0 0 220 150" role="img" aria-label="Empty trend chart preview">{[0,1,2,3].map(n=><line key={n} x1="24" x2="208" y1={18+n*32} y2={18+n*32} stroke="#1a354a" strokeDasharray="4 6"/>)}<polyline points="24,114 80,92 136,104 208,72" fill="none" stroke="#244b61" strokeWidth="2" strokeDasharray="5 7"/><text x="116" y="139" textAnchor="middle" fill="#6b8ca2" fontSize="9">EMPTY TREND PREVIEW</text></svg>;
}

