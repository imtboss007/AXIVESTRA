import {useEffect,useRef} from "react";
import {init,use,type EChartsType} from "echarts/core";
import {AriaComponent,GridComponent,LegendComponent,TooltipComponent} from "echarts/components";
import {BarChart,GraphChart,LineChart,PieChart} from "echarts/charts";
import {CanvasRenderer} from "echarts/renderers";
import type {EChartsOption} from "echarts";
use([AriaComponent,BarChart,GraphChart,GridComponent,LegendComponent,LineChart,PieChart,TooltipComponent,CanvasRenderer]);
type Props={option:EChartsOption;ariaLabel:string;onSelect?:(name:string)=>void};type ClickPayload={name?:string};
export default function PortfolioEChart({option,ariaLabel,onSelect}:Props){
 const host=useRef<HTMLDivElement>(null),instanceRef=useRef<EChartsType|null>(null),callbackRef=useRef(onSelect);callbackRef.current=onSelect;
 useEffect(()=>{const el=host.current;if(!el)return;const chart=init(el,undefined,{renderer:"canvas"});instanceRef.current=chart;const click=(event:ClickPayload)=>{if(typeof event?.name==="string")callbackRef.current?.(event.name);};chart.on("click",click);
 const resize=()=>chart.resize();let observer:ResizeObserver|undefined;if(typeof ResizeObserver!=="undefined"){observer=new ResizeObserver(resize);observer.observe(el);}else window.addEventListener("resize",resize);
 return ()=>{observer?.disconnect();if(!observer)window.removeEventListener("resize",resize);chart.off("click",click);chart.dispose();instanceRef.current=null;};},[]);
 useEffect(()=>{instanceRef.current?.setOption(option,true);},[option]);
 return <div ref={host} className="ax-echart-host" role="img" aria-label={ariaLabel}><span className="ax-echart-description">{ariaLabel}</span></div>;
}
