import {Copy,Eye,EyeOff,Plus,Trash2,ArrowUp,ArrowDown} from 'lucide-react';
import {Control} from './Panels';
import type {RepairSpot,SpotSettings} from '@captraw/contracts';
export function RepairPanel({spots,selected,settings,select,update,commit,remove,enable,rename,move,pickSource,newSpot,selectingSource,guides,setGuides}:{
 spots:RepairSpot[];selected?:RepairSpot;settings:SpotSettings;select:(id:string)=>void;
 update:(change:Partial<SpotSettings>,transient?:boolean)=>void;commit:()=>void;remove:(id:string)=>void;enable:(id:string)=>void;
 rename:(name:string)=>void;move:(direction:number)=>void;pickSource:()=>void;newSpot:()=>void;selectingSource:boolean;guides:boolean;setGuides:(value:boolean)=>void;
}){
 return <div className="repair-panel" aria-label="修复面板"><div className="panel-section"><div className="section-heading"><span>修复</span><small>{spots.length} 个点</small></div>
  <div className="repair-method"><button aria-pressed={settings.method==='heal'} onClick={()=>update({method:'heal',detail:0,retainTexture:false})}>修复</button><button aria-pressed={settings.method==='clone'} onClick={()=>update({method:'clone',detail:0,retainTexture:false})}><Copy size={13}/>仿制</button></div>
  <div className="repair-actions"><button aria-pressed={selectingSource} onClick={pickSource}>选择取样来源</button><button onClick={newSpot}><Plus size={13}/>新建点</button></div>
  <p className="hint">{selectingSource?'单击照片选择来源，再单击目标。':'单击目标创建修复点；⌥ 单击重新取样。'}拖动源点或目标点可重新定位。</p>
  <Control label="半径" value={settings.radius} min={2} max={200} unit="px" change={radius=>update({radius},true)} commit={commit}/>
  <Control label="羽化" value={settings.feather} min={0} max={100} unit="%" change={feather=>update({feather},true)} commit={commit}/>
  <Control label="不透明度" value={settings.opacity} min={0} max={100} unit="%" change={opacity=>update({opacity},true)} commit={commit}/>
  {settings.method==='heal'?<Control label="修复精细度" value={settings.detail} min={0} max={3} change={detail=>update({detail},true)} commit={commit}/>:<label className="check-control"><input type="checkbox" checked={settings.retainTexture||false} onChange={e=>update({retainTexture:e.target.checked})}/>保留目标细节</label>}
  <label className="check-control"><input type="checkbox" checked={guides} onChange={e=>setGuides(e.target.checked)}/>显示源点与目标点</label>
 </div><div className="panel-section"><div className="section-heading"><span>修复点</span></div><div className="repair-list" role="list" aria-label="修复点列表">
  {spots.map(s=><div key={s.id} role="listitem" className={selected?.id===s.id?'selected':''}><button className="repair-select" onClick={()=>select(s.id)}>{s.name}<small>{s.method==='heal'?'修复':'仿制'}</small></button><button title={s.enabled?'停用修复点':'启用修复点'} onClick={()=>enable(s.id)}>{s.enabled?<Eye size={14}/>:<EyeOff size={14}/>}</button><button aria-label={`删除 ${s.name}`} onClick={()=>remove(s.id)}><Trash2 size={14}/></button></div>)}
  {!spots.length&&<p className="hint">选择来源与目标后，修复点会显示在这里。</p>}
 </div>{selected&&<><input className="repair-name" aria-label="修复点名称" value={selected.name} onChange={e=>rename(e.target.value)} onBlur={commit}/><div className="repair-actions"><button title="上移修复点" disabled={spots[0]?.id===selected.id} onClick={()=>move(-1)}><ArrowUp size={13}/></button><button title="下移修复点" disabled={spots.at(-1)?.id===selected.id} onClick={()=>move(1)}><ArrowDown size={13}/></button><button onClick={()=>remove(selected.id)}><Trash2 size={13}/>删除修复点</button></div></>}
 </div></div>;
}
