export type CategoryKey='tstm'|'mrgl'|'slgt'|'enh'|'mdt'|'high'|'unknown'|'spec'
export type Category={key:CategoryKey;code:string;name:string;rank:number;pattern:'none'|'hatch'|'cross'|'dense'|'spec';width:number;opacity:number}
export const CATEGORIES:Category[]=[
 // Spec §4's .12–.30 alpha cannot meet §8's 3:1 fill/land contrast.
 // These minima meet §8 against the brighter end of the unchanged land gradient.
 {key:'tstm',code:'TSTM',name:'General thunderstorms',rank:0,pattern:'none',width:1.25,opacity:.42},
 {key:'mrgl',code:'MRGL',name:'Marginal Risk (1 of 5)',rank:1,pattern:'none',width:1.5,opacity:.49},
 {key:'slgt',code:'SLGT',name:'Slight Risk (2 of 5)',rank:2,pattern:'none',width:2,opacity:.41},
 {key:'enh',code:'ENH',name:'Enhanced Risk (3 of 5)',rank:3,pattern:'hatch',width:2.5,opacity:.56},
 {key:'mdt',code:'MDT',name:'Moderate Risk (4 of 5)',rank:4,pattern:'cross',width:3,opacity:.65},
 {key:'high',code:'HIGH',name:'High Risk (5 of 5)',rank:5,pattern:'dense',width:3.5,opacity:.70},
 {key:'unknown',code:'?',name:'Unknown category',rank:-1,pattern:'none',width:1.5,opacity:.12},
 {key:'spec',code:'PATTERN SIGNAL',name:'Pattern signal · not an SPC risk',rank:-1,pattern:'spec',width:2,opacity:.10},
]
const byKey=(key:CategoryKey)=>CATEGORIES.find(c=>c.key===key)!
const labelCategory=(label:string)=>{
 const keys: [CategoryKey,RegExp][]=[['tstm',/\bTSTM\b|thunder/i],['mrgl',/\bMRGL\b|marginal/i],['slgt',/\bSLGT\b|slight|\b15\s*%/i],['enh',/\bENH\b|enhanced|\b30\s*%/i],['mdt',/\bMDT\b|moderate/i],['high',/\bHIGH\b/i]]
 return keys.find(([,re])=>re.test(label))?.[0]
}
// DN=2 is verified locally; DN=3/4/5/6/8 follow the inferred SPC table (Radar & Backend Addendum 3).
// This is not SetupTargetMap's tornado-probability risk_code.
export function categoryOf(row:{official_code?:number;label:string;day?:number}):Category {
 if((row.day??0)>=9)return byKey('spec')
 const codes:Record<number,CategoryKey>={2:'tstm',3:'mrgl',4:'slgt',5:'enh',6:'mdt',8:'high'}
 const coded=row.official_code===undefined?undefined:codes[row.official_code],named=labelCategory(row.label)
 if(coded&&named&&coded!==named)console.warn('Outlook category code/label disagree',{official_code:row.official_code,label:row.label})
 return byKey(coded??named??'unknown')
}
export const categoryLabel=(row:{label:string;day?:number;official_code?:number})=>{
 const cat=categoryOf(row)
 return /\b(?:15|30)\s*%/.test(row.label)?row.label:cat.key==='unknown'?row.label:cat.name
}
