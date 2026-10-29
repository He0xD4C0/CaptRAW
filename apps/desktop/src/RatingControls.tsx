import {Star,Ban} from 'lucide-react';
import type {ReactNode} from 'react';
export const LABELS=[{value:'Red',name:'红色',color:'#d96b67',key:'6'},{value:'Yellow',name:'黄色',color:'#d9bd61',key:'7'},{value:'Green',name:'绿色',color:'#7eae7c',key:'8'},{value:'Blue',name:'蓝色',color:'#729dc8',key:'9'},{value:'Purple',name:'紫色',color:'#a88ac3',key:'⌘⇧0'}] as const;
export type LabelFilter='all'|'none'|'custom'|typeof LABELS[number]['value'];
export type PhotoSort='import'|'name'|'rating'|'label'|'iso';
export const labelColor=(label?:string)=>LABELS.find(v=>v.value.toLowerCase()===label?.toLowerCase());
export function labelText(label?:string){
 if(!label)return '无色标';const color=labelColor(label);
 return color?`${color.name}色标`:`自定义色标：${label}`;
}
export function matchesLabel(label:string|undefined,filter:LabelFilter){return filter==='all'||(filter==='none'?!label:filter==='custom'?!!label&&!labelColor(label):labelColor(label)?.value===filter);}
export function sortPhotos<T extends {image:{name:string;iso:number};rating?:number;label?:string}>(photos:T[],sort:PhotoSort,descending:boolean){
 if(sort==='import')return photos;
 const collator=new Intl.Collator(undefined,{numeric:true,sensitivity:'base'}),rank=(label?:string)=>{const color=labelColor(label),index=LABELS.findIndex(v=>v===color);return index>=0?index:label?5:6;};
 return photos.map((photo,index)=>({photo,index})).sort((a,b)=>{
  const left=a.photo,right=b.photo;
  if(sort==='iso'&&(left.image.iso>0)!==(right.image.iso>0))return left.image.iso>0?-1:1;
  const difference=sort==='name'?collator.compare(left.image.name,right.image.name):sort==='rating'?(left.rating??0)-(right.rating??0):sort==='iso'?(left.image.iso>0?left.image.iso:Infinity)-(right.image.iso>0?right.image.iso:Infinity):rank(left.label)-rank(right.label)||collator.compare(left.label??'',right.label??'');
  return (descending?-difference:difference)||a.index-b.index;
 }).map(item=>item.photo);
}
export function LabelControls({labels,change,disabled}:{labels:(string|undefined)[];change:(label:string)=>void;disabled:boolean}){
 const current=labels[0]??'',mixed=labels.some(label=>(label??'')!==current);
 return <div className="label-controls" role="group" aria-label="所选照片色标"><button aria-label="清除色标" title="清除色标" disabled={disabled} onClick={()=>change('')}>×</button>{LABELS.map(entry=><button key={entry.value} aria-label={`设为${entry.name}色标`} title={`${entry.name}色标${entry.key?' · '+entry.key:''}`} aria-pressed={!mixed&&labelColor(current)===entry} disabled={disabled} onClick={()=>change(entry.value)}><i style={{backgroundColor:entry.color}}/></button>)}<span role="status" aria-label="所选色标" title={!mixed?current:undefined}>{!labels.length?'未选择':mixed?'色标不一致':labelText(current)}</span></div>;
}
export type RatingFilter='all'|'unrated'|'rejected'|'1'|'2'|'3'|'4'|'5';
export function matchesRating(rating:number|undefined,filter:RatingFilter){return filter==='all'||(filter==='unrated'?(rating??0)===0:filter==='rejected'?rating===-1:(rating??0)>=Number(filter));}
export function ratingText(rating?:number){return rating===-1?'已拒绝':rating?`${rating} 星`:'未评分';}
export function RatingControls({ratings,rate,disabled,filter,setFilter,visible,total,activeHidden,children,filtered,clearFilters}:{ratings:(number|undefined)[];rate:(value:number)=>void;disabled:boolean;filter:RatingFilter;setFilter:(value:RatingFilter)=>void;visible:number;total:number;activeHidden:boolean;children?:ReactNode;filtered?:boolean;clearFilters?:()=>void}){
 const current=ratings[0]??0,mixed=ratings.some(value=>(value??0)!==current);
 return <div className="rating-bar" aria-label="评分与筛选">
  <div className="rating-controls" role="group" aria-label="所选照片评分"><button aria-label="清除评分" title="清除评分 · 0" disabled={disabled} onClick={()=>rate(0)}>0</button>{[1,2,3,4,5].map(value=><button key={value} aria-label={`评为 ${value} 星`} title={`${value} 星 · ${value}`} aria-pressed={!mixed&&current===value} disabled={disabled} onClick={()=>rate(value)}><Star size={15} fill={!mixed&&current>=value?'currentColor':'none'}/></button>)}<button aria-label="标记拒绝" title="标记拒绝，不删除原片" aria-pressed={!mixed&&current===-1} disabled={disabled} onClick={()=>rate(-1)}><Ban size={15}/></button><span role="status" aria-label="所选评分">{!ratings.length?'未选择照片':mixed?'评分不一致':ratingText(current)}</span></div>
  <label className="rating-filter">筛选<select aria-label="评分筛选" value={filter} onChange={event=>setFilter(event.target.value as RatingFilter)}><option value="all">全部照片</option><option value="unrated">未评分</option><option value="rejected">已拒绝</option>{[1,2,3,4,5].map(value=><option value={value} key={value}>{value} 星及以上</option>)}</select></label>
  {children}<span className="rating-count" role="status">显示 {visible} / {total} 张{activeHidden?' · 当前照片未通过筛选':''}</span>{(filter!=='all'||filtered)&&<button className="clear-rating-filter" onClick={()=>{setFilter('all');clearFilters?.();}}>清除筛选</button>}
 </div>;
}
