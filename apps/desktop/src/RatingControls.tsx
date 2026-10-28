import {Star,Ban} from 'lucide-react';
export type RatingFilter='all'|'unrated'|'rejected'|'1'|'2'|'3'|'4'|'5';
export function matchesRating(rating:number|undefined,filter:RatingFilter){return filter==='all'||(filter==='unrated'?(rating??0)===0:filter==='rejected'?rating===-1:(rating??0)>=Number(filter));}
export function ratingText(rating?:number){return rating===-1?'已拒绝':rating?`${rating} 星`:'未评分';}
export function RatingControls({ratings,rate,disabled,filter,setFilter,visible,total,activeHidden}:{ratings:(number|undefined)[];rate:(value:number)=>void;disabled:boolean;filter:RatingFilter;setFilter:(value:RatingFilter)=>void;visible:number;total:number;activeHidden:boolean}){
 const current=ratings[0]??0,mixed=ratings.some(value=>(value??0)!==current);
 return <div className="rating-bar" aria-label="评分与筛选">
  <div className="rating-controls" role="group" aria-label="所选照片评分"><button aria-label="清除评分" title="清除评分 · 0" disabled={disabled} onClick={()=>rate(0)}>0</button>{[1,2,3,4,5].map(value=><button key={value} aria-label={`评为 ${value} 星`} title={`${value} 星 · ${value}`} aria-pressed={!mixed&&current===value} disabled={disabled} onClick={()=>rate(value)}><Star size={15} fill={!mixed&&current>=value?'currentColor':'none'}/></button>)}<button aria-label="标记拒绝" title="标记拒绝，不删除原片" aria-pressed={!mixed&&current===-1} disabled={disabled} onClick={()=>rate(-1)}><Ban size={15}/></button><span role="status" aria-label="所选评分">{!ratings.length?'未选择照片':mixed?'评分不一致':ratingText(current)}</span></div>
  <label className="rating-filter">筛选<select aria-label="评分筛选" value={filter} onChange={event=>setFilter(event.target.value as RatingFilter)}><option value="all">全部照片</option><option value="unrated">未评分</option><option value="rejected">已拒绝</option>{[1,2,3,4,5].map(value=><option value={value} key={value}>{value} 星及以上</option>)}</select></label>
  <span className="rating-count" role="status">显示 {visible} / {total} 张{activeHidden?' · 当前照片未通过筛选':''}</span>{filter!=='all'&&<button className="clear-rating-filter" onClick={()=>setFilter('all')}>清除筛选</button>}
 </div>;
}
