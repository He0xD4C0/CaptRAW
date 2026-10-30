// Differential reference: compile the pinned upstream Rust math, never the product engine.
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const commit='e0251f9da4b8b70678388f4ec357ba88f416ac32';
const sources={
 'rgb_table.rs':['camera_profiles/rgb_table.rs','08b66f0897f292350473c5bfb605246b828e9c91d8bffc30b8e1edbc479b2ba0'],
 'mod.rs':['camera_profiles/mod.rs','eae38d375e29661aff74158957ca8bd8ad819aa61c60e1436787241cdf36022d'],
};
export async function rustReference(directory){
 const loaded={};
 for(const [name,[path,sha]] of Object.entries(sources)){
  const bytes=process.env.CAPTRAW_ENHANCED_REFERENCE_SOURCE?await readFile(join(process.env.CAPTRAW_ENHANCED_REFERENCE_SOURCE,name)):Buffer.from(await(await fetch(`https://raw.githubusercontent.com/pch/rawmakase/${commit}/crates/rawmakase-model/src/${path}`)).arrayBuffer());
  if(createHash('sha256').update(bytes).digest('hex')!==sha)throw new Error('Pinned Rust reference SHA mismatch: '+name);
  loaded[name]=bytes.toString();
 }
 const rgb=loaded['rgb_table.rs'];
 // Retain upstream binary parser and arithmetic verbatim. Replace only dependency glue:
 // serde/anyhow and base85/zlib transport (the reference receives expanded hex bytes).
 const body=rgb.slice(rgb.indexOf('const PRO_TO_ADOBE:'),rgb.indexOf('/// The largest 3D'))
  .replaceAll('pub(super)','pub');
 const tetra=rgb.slice(rgb.indexOf('pub(super) fn tetrahedral'),rgb.indexOf('impl Serialize for RgbTable')).replace('pub(super)','pub');
 const matrices=loaded['mod.rs'].slice(loaded['mod.rs'].indexOf('pub const PRO_TO_RGB:'),loaded['mod.rs'].indexOf('#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]'));
 const model=loaded['mod.rs'];
 const hsv=model.slice(model.indexOf('impl Table {'),model.indexOf('impl CameraProfile {'));
 const source=`#![allow(dead_code)]
type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;
macro_rules! bail { ($($arg:tt)*) => { return Err(format!($($arg)*).into()) } }
macro_rules! ensure { ($condition:expr,$($arg:tt)*) => { if !$condition { bail!($($arg)*); } } }
type Matrix = [[f32;3];3];
${matrices}
fn mul(m: Matrix,p:[f32;3])->[f32;3] {m.map(|r|r[0]*p[0]+r[1]*p[1]+r[2]*p[2])}
fn matmul(a:Matrix,b:Matrix)->Matrix {std::array::from_fn(|i|std::array::from_fn(|j|(0..3).map(|k|a[i][k]*b[k][j]).sum()))}
fn srgb_decode(v:f32)->f32 {if v<=0.04045 {v/12.92} else {((v+0.055)/1.055).powf(2.4)}}
fn srgb_encode(v:f32)->f32 {if v<=0.0031308 {12.92*v} else {1.055*v.max(0.).powf(1./2.4)-0.055}}
fn decode(v:f32)->f32 {srgb_decode(v)}
#[derive(Clone)] struct Table {dims:[usize;3],data:Vec<[f32;3]>,srgb:bool}
${hsv}
mod tables {use super::*;
 pub mod enhanced {use super::*;pub fn expand(text:&str)->Result<Vec<u8>> {(0..text.len()).step_by(2).map(|i|u8::from_str_radix(&text[i..i+2],16).map_err(Into::into)).collect()}}
 pub mod rgb {use super::*;const MAX_3D:usize=64;const MAX_1D:usize=4096;
${body}
${tetra}
}}
fn main()->Result<()> {
 let args:Vec<String>=std::env::args().collect();
 let hex=std::fs::read_to_string(&args[1])?;let bytes=tables::enhanced::expand(&hex)?;
 let word=|i:usize|u32::from_le_bytes(bytes[i..i+4].try_into().unwrap()) as usize;
 let rgb=if word(0)==1 {Some(tables::rgb::RgbTable::decode(&hex)?)} else {None};
 let hsv=if word(0)==0 {let dims=[word(8),word(12),word(16)];let end=20+12*dims.iter().product::<usize>();let values=bytes[20..end].chunks_exact(12).map(|p|std::array::from_fn(|c|f32::from_le_bytes(p[c*4..c*4+4].try_into().unwrap()))).collect();let bounds=if word(4)==2 {[f64::from_le_bytes(bytes[end+4..end+12].try_into().unwrap()) as f32,(f64::from_le_bytes(bytes[end+12..end+20].try_into().unwrap()) as f32).min(2.)]} else {[1.,1.]};Some((Table{dims,data:values,srgb:word(end)==1},bounds))} else {None};
 for line in std::fs::read_to_string(&args[2])?.lines() {
  let v:Vec<f32>=line.split_whitespace().map(|s|s.parse().unwrap()).collect();
  let out=if let Some(table)=&rgb {let amount=table.amount(v[4],v[3]);table.apply([v[0],v[1],v[2]],amount)} else {let (table,bounds)=hsv.as_ref().unwrap();table.scaled(v[3].clamp(bounds[0],bounds[1])).apply([v[0],v[1],v[2]],None,0.)};
  println!("{:.9} {:.9} {:.9}",out[0],out[1],out[2]);
 } Ok(())
}
`;
 const path=join(directory,'reference.rs'),binary=join(directory,'reference');await writeFile(path,source);
 execFileSync(process.env.RUSTC||'/opt/homebrew/opt/rustup/bin/rustc',['--edition=2024','-O',path,'-o',binary],{stdio:'pipe'});
 return (bytes,cases)=>{
  const raw=join(directory,'reference.hex'),input=join(directory,'reference.inputs');
  return (async()=>{await writeFile(raw,bytes.toString('hex'));await writeFile(input,cases.map(p=>p.join(' ')).join('\n'));
   return execFileSync(binary,[raw,input],{encoding:'utf8'}).trim().split('\n').map(line=>line.split(' ').map(Number));})();
 };
}
if(process.argv[1]&&resolve(process.argv[1])===new URL(import.meta.url).pathname){
 const scratch=await mkdtemp(join(tmpdir(),'captraw-enhanced-rust-'));
 try{await rustReference(scratch);console.log('Pinned original Rust reference compiled');await rm(scratch,{recursive:true,force:true});}
 catch(error){console.error('Reference failure retained at '+scratch);throw error;}
}
