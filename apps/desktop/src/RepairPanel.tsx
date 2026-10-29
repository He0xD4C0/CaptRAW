import {Copy,Eye,EyeOff,Plus,Trash2,ArrowUp,ArrowDown} from 'lucide-react';
import {Control} from './Panels';
import type {RepairSpot,SpotSettings} from '@captraw/contracts';
export function RepairPanel({spots,selected,settings,select,update,commit,remove,enable,rename,move,pickSource,newSpot,selectingSource,guides,setGuides,dustView}:{
 spots:RepairSpot[];selected?:RepairSpot;settings:SpotSettings;select:(id:string)=>void;
 update:(change:Partial<SpotSettings>,transient?:boolean)=>void;commit:()=>void;remove:(id:string)=>void;enable:(id:string)=>void;
 rename:(name:string)=>void;move:(direction:number)=>void;pickSource:()=>void;newSpot:()=>void;selectingSource:boolean;guides:boolean;setGuides:(value:boolean)=>void;
 dustView?:{enabled:boolean;threshold:number;setEnabled:(value:boolean)=>void;setThreshold:(value:number)=>void};
}){
 return <div className="repair-panel" aria-label="修复面板"><div className="panel-section"><div className="section-heading"><span>修复</span><small>{spots.length} 处修复</small></div>
  <div className="repair-method"><button aria-pressed={settings.method==='heal'} onClick={()=>update({method:'heal',detail:0,retainTexture:false})}>修复</button><button aria-pressed={settings.method==='clone'} onClick={()=>update({method:'clone',detail:0,retainTexture:false})}><Copy size={13}/>仿制</button></div>
  <div className="repair-actions"><button aria-pressed={selectingSource} onClick={pickSource}>选择取样来源</button><button onClick={newSpot} title="新建圆形或连续修复区域"><Plus size={13}/>新建修复</button></div>
  <label className="check-control"><input type="checkbox" checked={settings.sourceMode==='auto'} onChange={e=>update({sourceMode:e.target.checked?'auto':'manual'})}/>自动选择来源</label>
  <button disabled={!selected} onClick={()=>update({sourceMode:'auto',searchSeed:(settings.searchSeed||0)+1})}>重新搜索来源</button>
  <p className="hint">{selectingSource?'单击照片选择来源。':'单击创建圆点，拖动绘制连续修复区域；⌥ 单击改源。'}拖动目标移动整条轨迹，拖动源点改变取样位置。</p>
  <Control label="半径" value={settings.radius} min={2} max={200} unit="px" change={radius=>update({radius},true)} commit={commit}/>
  <Control label="羽化" value={settings.feather} min={0} max={100} unit="%" change={feather=>update({feather},true)} commit={commit}/>
  <Control label="不透明度" value={settings.opacity} min={0} max={100} unit="%" change={opacity=>update({opacity},true)} commit={commit}/>
  {settings.method==='heal'?<Control label="修复精细度" value={settings.detail} min={0} max={3} change={detail=>update({detail},true)} commit={commit}/>:!selected?.path&&<label className="check-control"><input type="checkbox" checked={settings.retainTexture||false} onChange={e=>update({retainTexture:e.target.checked})}/>保留目标细节</label>}
  <label className="check-control"><input type="checkbox" checked={guides} onChange={e=>setGuides(e.target.checked)}/>显示源点与目标点</label>
  {dustView&&<><label className="check-control"><input type="checkbox" checked={dustView.enabled} onChange={e=>dustView.setEnabled(e.target.checked)}/>灰尘可视化</label>{dustView.enabled&&<Control label="灰尘可视化阈值" value={dustView.threshold} min={0} max={100} change={dustView.setThreshold} commit={()=>{}}/>}</>}
 </div><div className="panel-section"><div className="section-heading"><span>修复区域</span></div><div className="repair-list" role="list" aria-label="修复列表">
  {spots.map(s=><div key={s.id} role="listitem" className={selected?.id===s.id?'selected':''}><button className="repair-select" onClick={()=>select(s.id)}>{s.name}<small>{s.method==='heal'?'修复':'仿制'}</small></button><button title={s.enabled?'停用修复':'启用修复'} onClick={()=>enable(s.id)}>{s.enabled?<Eye size={14}/>:<EyeOff size={14}/>}</button><button aria-label={`删除 ${s.name}`} onClick={()=>remove(s.id)}><Trash2 size={14}/></button></div>)}
  {!spots.length&&<p className="hint">单击或拖动照片创建修复，已创建的区域会显示在这里。</p>}
 </div>{selected&&<><input className="repair-name" aria-label="修复名称" value={selected.name} onChange={e=>rename(e.target.value)} onBlur={commit}/><div className="repair-actions"><button title="上移修复" disabled={spots[0]?.id===selected.id} onClick={()=>move(-1)}><ArrowUp size={13}/></button><button title="下移修复" disabled={spots.at(-1)?.id===selected.id} onClick={()=>move(1)}><ArrowDown size={13}/></button><button onClick={()=>remove(selected.id)}><Trash2 size={13}/>删除修复</button></div></>}
 </div></div>;
}
