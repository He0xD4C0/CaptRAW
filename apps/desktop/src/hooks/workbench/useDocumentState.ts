import {useRef,useState} from 'react';
import {historySnapshot,type DocumentState,type EditingState,type HistoryState} from './model';

export function useDocumentState(){
  const [documents,setDocumentState]=useState<DocumentState[]>([]);
  const [activeId,setActiveId]=useState('');
  const editEpoch=useRef(0),profileEpoch=useRef(0),historyClock=useRef(0);
  const targetsRef=useRef<string[]>([]);
  const docs=useRef(documents);docs.current=documents;
  const idRef=useRef(activeId);idRef.current=activeId;
  function setDocuments(change:DocumentState[]|((previous:DocumentState[])=>DocumentState[])){
    const next=typeof change==='function'?change(docs.current):change;docs.current=next;setDocumentState(next);
  }
  const active=documents.find(document=>document.image.id===activeId);
  const updateDocument=(id:string,change:(document:DocumentState)=>DocumentState)=>setDocuments(old=>old.map(document=>document.image.id===id?change(document):document));
  const nextHistorySnapshot=(document:EditingState,operationId:string=crypto.randomUUID()):HistoryState=>
    historySnapshot(document,operationId,++historyClock.current);
  function targetDocuments(paths=targetsRef.current){
    const byPath=new Map(docs.current.map(document=>[document.image.path,document]));
    return paths.flatMap(path=>{const document=byPath.get(path);return document?[document]:[];});
  }
  return {documents,setDocuments,docs,activeId,setActiveId,idRef,active,targetsRef,updateDocument,targetDocuments,editEpoch,profileEpoch,historyClock,nextHistorySnapshot};
}
